-- ============================================================
-- K탁구클럽 / GitHub Pages + Supabase 예약 DB
-- Supabase Dashboard > SQL Editor에서 전체를 한 번 실행합니다.
-- 공개된 GitHub 저장소에 비밀번호·서비스 시크릿을 넣지 마세요.
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists public.ktt_bookings (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('trial','regular')),
  lesson_day date not null,
  start_at time without time zone not null,
  name text not null,
  phone text not null,
  level text not null check (level in ('완전초보','초보','입문','중급','상급')),
  experience text not null default '',
  status text not null check (status in ('pending_payment','pending','confirmed','completed','no_show','cancelled')),
  privacy_accepted_at timestamptz not null default now(),
  policy_accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 같은 강사/동시간대: 체험과 정기 레슨 사이에도 중복 예약 금지
create unique index if not exists ktt_booking_active_slot_unique
  on public.ktt_bookings (lesson_day,start_at)
  where status in ('pending_payment','pending','confirmed');

-- 전화번호 1개당 무료 체험은 활성/완료/노쇼까지 통틀어 1회
-- 관리자가 취소 처리한 신청은 다시 신청할 수 있습니다.
create unique index if not exists ktt_trial_active_phone_unique
  on public.ktt_bookings (phone)
  where kind='trial' and status in ('pending_payment','pending','confirmed','completed','no_show');

create index if not exists ktt_booking_day_idx on public.ktt_bookings (lesson_day);

-- Supabase Auth 사용자 중 관리자만 등록하는 별도 테이블
create table if not exists public.ktt_admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);

-- 직접 테이블 조회/수정 불가. 노출은 권한 검사 기능(RPC)에만 허용.
alter table public.ktt_bookings enable row level security;
alter table public.ktt_admin_users enable row level security;
revoke all on table public.ktt_bookings from anon, authenticated;
revoke all on table public.ktt_admin_users from anon, authenticated;

-- 분 단위 일정 규칙. 월=1, 화=2, 수=3, 목=4, 금=5, 토=6, 일=7
create or replace function public.ktt_slot_valid(p_kind text,p_day date,p_at time without time zone)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(
    p_day is not null
    and p_at is not null
    and extract(second from p_at) = 0
    and extract(minute from p_at) in (0,30)
    and (
      (p_kind='trial'
        and extract(isodow from p_day) in (1,2,4,5)
        and (
          (p_at >= time '10:00' and p_at < time '12:00')
          or (p_at >= time '14:00' and p_at < time '16:00')
          or (p_at >= time '19:00' and p_at < time '22:00')
        )
      )
      or (p_kind='regular'
        and (
          (extract(isodow from p_day) in (2,4) and p_at >= time '19:00' and p_at < time '22:00')
          or (extract(isodow from p_day) in (6,7) and p_at >= time '15:00' and p_at < time '19:00')
        )
      )
    ), false
  );
$$;

-- 공개: 개인정보 없이 예약 시간대의 가능 여부만 반환
create or replace function public.ktt_available_slots(p_kind text,p_day date)
returns table(slot text, available boolean)
language sql stable security definer set search_path = '' as $$
  select to_char(s.start_at,'HH24:MI') as slot,
         (
           (p_day > (now() at time zone 'Asia/Seoul')::date
            or s.start_at > (now() at time zone 'Asia/Seoul')::time)
           and not exists (
             select 1 from public.ktt_bookings b
              where b.lesson_day=p_day and b.start_at=s.start_at
                and b.status in ('pending_payment','pending','confirmed')
           )
         ) as available
  from (
    select make_time((m.minute_num / 60)::int,(m.minute_num % 60)::int,0) as start_at
      from generate_series(0, 1410, 30) as m(minute_num)
  ) s
  where p_day between (now() at time zone 'Asia/Seoul')::date
                  and (now() at time zone 'Asia/Seoul')::date + 60
    and public.ktt_slot_valid(p_kind,p_day,s.start_at)
  order by s.start_at;
$$;

-- 공개: 신청 기록은 DB에 저장되지만 신청자에게는 접수번호만 반환
create or replace function public.ktt_book(
  p_kind text, p_day date, p_slot text,
  p_name text, p_phone text, p_level text, p_experience text,
  p_privacy_agree boolean, p_policy_agree boolean
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_at time without time zone;
  v_phone text;
  v_name text;
  v_exp text;
  v_id uuid;
  v_now timestamp without time zone := now() at time zone 'Asia/Seoul';
  v_status text;
begin
  if p_privacy_agree is distinct from true or p_policy_agree is distinct from true then
    raise exception '개인정보 및 예약·환불 규정에 동의해 주세요.';
  end if;
  if p_kind is null or p_kind not in ('trial','regular') then
    raise exception '레슨 유형을 다시 선택해 주세요.';
  end if;
  if p_slot is null or p_slot !~ '^([01][0-9]|2[0-3]):(00|30)$' then
    raise exception '올바른 30분 단위 예약 시간을 선택해 주세요.';
  end if;
  v_at:=p_slot::time;
  if p_day is null or p_day < v_now::date or p_day > v_now::date + 60
     or (p_day=v_now::date and v_at<=v_now::time)
     or not public.ktt_slot_valid(p_kind,p_day,v_at) then
    raise exception '선택하신 날짜·시간은 예약할 수 없습니다.';
  end if;
  v_name:=btrim(coalesce(p_name,''));
  v_phone:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
  v_exp:=btrim(coalesce(p_experience,''));
  if char_length(v_name)<2 or char_length(v_name)>40 then
    raise exception '이름을 2~40자로 입력해 주세요.';
  end if;
  if v_phone !~ '^0[0-9]{9,10}$' then
    raise exception '연락처를 다시 확인해 주세요.';
  end if;
  if p_level is null or p_level not in ('완전초보','초보','입문','중급','상급') then
    raise exception '탁구 실력을 선택해 주세요.';
  end if;
  if char_length(v_exp)>1000 then
    raise exception '레슨 경험은 1,000자 이내로 작성해 주세요.';
  end if;
  if p_kind='trial' and exists (
      select 1 from public.ktt_bookings b where b.kind='trial' and b.phone=v_phone
        and b.status in ('pending_payment','pending','confirmed','completed','no_show')
  ) then
    raise exception '해당 연락처로 무료 체험 신청 내역이 있습니다. 무료 체험은 최초 1회만 신청할 수 있습니다.';
  end if;
  v_status:=case when p_kind='trial' then 'pending_payment' else 'pending' end;
  insert into public.ktt_bookings(kind,lesson_day,start_at,name,phone,level,experience,status)
    values(p_kind,p_day,v_at,v_name,v_phone,p_level,v_exp,v_status)
    returning id into v_id;
  return jsonb_build_object('booking_no',v_id,'status',v_status);
exception
  when unique_violation then
    raise exception '이미 예약된 시간이거나 해당 연락처로 무료 체험 신청 내역이 있습니다. 다른 시간 또는 클럽에 문의해 주세요.';
end;
$$;

-- 관리자 전용: 예약 목록 조회
create or replace function public.ktt_admin_list(
  p_kind text default 'all',p_status text default 'all',p_day date default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_records jsonb;
begin
  if not exists(select 1 from public.ktt_admin_users where user_id=auth.uid()) then
    raise exception '관리자 권한이 없습니다.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',b.id,'kind',b.kind,'day',to_char(b.lesson_day,'YYYY-MM-DD'),
    'slot',to_char(b.start_at,'HH24:MI'),'name',b.name,'phone',b.phone,
    'level',b.level,'experience',b.experience,'status',b.status,
    'created_at',b.created_at,'updated_at',b.updated_at
  ) order by b.lesson_day,b.start_at,b.created_at),'[]'::jsonb)
    into v_records from public.ktt_bookings b
   where (p_kind='all' or b.kind=p_kind)
     and (p_status='all' or b.status=p_status)
     and (p_day is null or b.lesson_day=p_day);
  return v_records;
end;
$$;

-- 관리자 전용: 입금 확인 및 완료/노쇼/취소 상태 처리
create or replace function public.ktt_admin_status(p_id uuid,p_status text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_old public.ktt_bookings%rowtype;
begin
  if not exists(select 1 from public.ktt_admin_users where user_id=auth.uid()) then
    raise exception '관리자 권한이 없습니다.';
  end if;
  if p_status is null or p_status not in ('pending_payment','pending','confirmed','completed','no_show','cancelled') then
    raise exception '올바른 예약 상태를 선택해 주세요.';
  end if;
  select * into v_old from public.ktt_bookings where id=p_id for update;
  if not found then raise exception '예약 내역을 찾지 못했습니다.';end if;
  if v_old.status='cancelled' and p_status<>'cancelled' then
    raise exception '취소한 예약은 복원할 수 없습니다. 새로 신청해 주세요.';
  end if;
  if p_status='pending_payment' and v_old.kind<>'trial' then
    raise exception '입금 확인 대기는 무료 체험 예약에만 적용합니다.';
  end if;
  update public.ktt_bookings set status=p_status,updated_at=now() where id=p_id;
  return jsonb_build_object('ok',true,'status',p_status);
exception
  when unique_violation then
    raise exception '다른 예약과 충돌하거나 무료 체험 횟수가 중복됩니다.';
end;
$$;

-- 관리자 전용: 원래 레슨 시작시각 기준 24시간 전까지만 변경
create or replace function public.ktt_admin_move(p_id uuid,p_day date,p_slot text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_old public.ktt_bookings%rowtype;
  v_at time without time zone;
  v_today timestamp without time zone := now() at time zone 'Asia/Seoul';
begin
  if not exists(select 1 from public.ktt_admin_users where user_id=auth.uid()) then
    raise exception '관리자 권한이 없습니다.';
  end if;
  select * into v_old from public.ktt_bookings where id=p_id for update;
  if not found then raise exception '예약 내역을 찾지 못했습니다.';end if;
  if v_old.status not in ('pending_payment','pending','confirmed') then
    raise exception '취소·완료·노쇼 예약은 시간을 변경할 수 없습니다.';
  end if;
  if (v_old.lesson_day+v_old.start_at) < v_today+interval '24 hours' then
    raise exception '예약 변경은 기존 레슨 시작 최소 24시간 전에만 가능합니다.';
  end if;
  if p_slot is null or p_slot !~ '^([01][0-9]|2[0-3]):(00|30)$' then
    raise exception '30분 단위 시간을 선택해 주세요.';
  end if;
  v_at:=p_slot::time;
  if p_day is null or p_day < v_today::date or p_day > v_today::date+60
      or (p_day=v_today::date and v_at<=v_today::time)
      or not public.ktt_slot_valid(v_old.kind,p_day,v_at) then
    raise exception '변경할 수 없는 날짜와 시간입니다.';
  end if;
  update public.ktt_bookings set lesson_day=p_day,start_at=v_at,updated_at=now() where id=p_id;
  return jsonb_build_object('ok',true);
exception
  when unique_violation then
    raise exception '해당 시간대는 이미 예약되었습니다. 다른 시간을 선택해 주세요.';
end;
$$;

-- RPC만 접근 허용: 공개 기능은 anon, 관리자 기능은 로그인한 authenticated
revoke execute on function public.ktt_slot_valid(text,date,time without time zone) from public,anon,authenticated;
revoke execute on function public.ktt_available_slots(text,date) from public,anon,authenticated;
revoke execute on function public.ktt_book(text,date,text,text,text,text,text,boolean,boolean) from public,anon,authenticated;
revoke execute on function public.ktt_admin_list(text,text,date) from public,anon,authenticated;
revoke execute on function public.ktt_admin_status(uuid,text) from public,anon,authenticated;
revoke execute on function public.ktt_admin_move(uuid,date,text) from public,anon,authenticated;

grant execute on function public.ktt_available_slots(text,date) to anon,authenticated;
grant execute on function public.ktt_book(text,date,text,text,text,text,text,boolean,boolean) to anon;
grant execute on function public.ktt_admin_list(text,text,date) to authenticated;
grant execute on function public.ktt_admin_status(uuid,text) to authenticated;
grant execute on function public.ktt_admin_move(uuid,date,text) to authenticated;

-- Supabase REST schema cache 갱신
notify pgrst,'reload schema';

-- ============================================================
-- 관리자 최초 등록 (SQL 실행 후, Supabase > Authentication에서
-- 관리자 계정 Email/Password 생성 후 아래 두 줄을 별도 실행하세요.)
--
-- select id,email from auth.users;
-- insert into public.ktt_admin_users(user_id)
-- select id from auth.users where email='관리자이메일@example.com'
-- on conflict (user_id) do nothing;
-- ============================================================
