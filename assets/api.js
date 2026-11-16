/* K탁구클럽 - 정적 사이트용 Supabase REST 연결 모듈.
   공개 키(anon/publishable)는 클라이언트에만 존재합니다. 접근 통제는 database.sql에서 담당합니다. */
(() => {
  'use strict';
  const conf = window.KTT_CONFIG || {};
  const url = String(conf.supabaseUrl || '').trim().replace(/\/$/, '');
  const key = String(conf.supabaseAnonKey || '').trim();
  const ready = /^https:\/\/[^\s]+\.supabase\.co$/i.test(url) && key.length > 15;
  const storageKey = 'ktt_admin_auth_v1';
  const levelNames = ['완전초보', '초보', '입문', '중급', '상급'];

  async function request(path, options = {}, token) {
    if (!ready) throw new Error('예약 저장 서비스 연결 전입니다. 관리자에게 문의해 주세요.');
    const res = await fetch(`${url}${path}`, {
      ...options,
      headers: { 'apikey': key, ...(token ? {'Authorization': `Bearer ${token}`} : {}),
        'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const value = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = value.message || value.msg || value.error_description || value.error || '요청을 처리하지 못했습니다.';
      throw new Error(String(msg));
    }
    return value;
  }
  function rpc(name, data, token) {
    return request(`/rest/v1/rpc/${encodeURIComponent(name)}`, {method:'POST', body:JSON.stringify(data)}, token);
  }
  function seoulToday() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit'
    }).formatToParts(new Date());
    const get = t => parts.find(p => p.type === t)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }
  function addDays(ymd, n) {
    const d = new Date(`${ymd}T12:00:00.000Z`);
    d.setUTCDate(d.getUTCDate()+n);
    return d.toISOString().slice(0,10);
  }
  function dayOfWeek(day) { return new Date(`${day}T12:00:00.000Z`).getUTCDay(); }
  function schedules(kind, day) {
    const dow = dayOfWeek(day);
    const hours = kind === 'trial'
      ? ([1,2,4,5].includes(dow) ? [[10,12],[14,16],[19,22]] : [])
      : ([2,4].includes(dow) ? [[19,22]] : [0,6].includes(dow) ? [[15,19]] : []);
    return hours.flatMap(([from,to]) => {
      const a=[];
      for (let mins=from*60; mins<to*60; mins+=30)
        a.push(`${String(Math.floor(mins/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`);
      return a;
    });
  }
  function localSlotOpen(day, slot) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone:'Asia/Seoul', hour:'2-digit', minute:'2-digit', hourCycle:'h23'
    }).formatToParts(new Date());
    const hh=parts.find(p=>p.type==='hour')?.value || '00';
    const mm=parts.find(p=>p.type==='minute')?.value || '00';
    return day > seoulToday() || (day === seoulToday() && slot > `${hh}:${mm}`);
  }
  function previewSlots(kind, day) {
    if (day < seoulToday() || day > addDays(seoulToday(),60)) return [];
    return schedules(kind,day).map(slot => ({slot, available:localSlotOpen(day,slot)}));
  }
  async function availableSlots(kind, day) {
    if (!ready) return previewSlots(kind,day);
    return rpc('ktt_available_slots', {p_kind:kind, p_day:day});
  }
  function booking(form) {
    return rpc('ktt_book', {
      p_kind:form.kind,p_day:form.day,p_slot:form.slot,p_name:form.name,
      p_phone:form.phone,p_level:form.level,p_experience:form.experience,
      p_privacy_agree:form.privacy,p_policy_agree:form.policy
    });
  }
  function saveSession(value) { sessionStorage.setItem(storageKey, JSON.stringify(value)); }
  function readSession() {
    try { return JSON.parse(sessionStorage.getItem(storageKey) || 'null'); } catch { return null; }
  }
  function clearSession() { sessionStorage.removeItem(storageKey); }
  async function login(email,password) {
    const value=await request('/auth/v1/token?grant_type=password', {
      method:'POST',body:JSON.stringify({email,password})
    });
    const next={access_token:value.access_token,refresh_token:value.refresh_token,
      expires_at:Date.now()+(value.expires_in || 3600)*1000};
    saveSession(next);
    // 로그인은 인증만 수행합니다. 관리자 권한은 DB 함수 내부에서 반드시 다시 검사합니다.
    try { await adminList('all','all',null); }
    catch (error) { clearSession(); throw new Error('관리자 권한이 없습니다. '+error.message); }
    return next;
  }
  async function adminToken() {
    const session=readSession();
    if(!session?.access_token) throw new Error('관리자 로그인이 필요합니다.');
    if (session.expires_at-Date.now() > 70000) return session.access_token;
    try {
      const next=await request('/auth/v1/token?grant_type=refresh_token', {
        method:'POST',body:JSON.stringify({refresh_token:session.refresh_token})
      });
      saveSession({access_token:next.access_token,refresh_token:next.refresh_token,
        expires_at:Date.now()+(next.expires_in || 3600)*1000});
      return next.access_token;
    } catch(e) {clearSession();throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.');}
  }
  async function adminList(kind='all', status='all', day=null) {
    return rpc('ktt_admin_list', {p_kind:kind,p_status:status,p_day:day}, await adminToken());
  }
  async function adminStatus(id, status) {
    return rpc('ktt_admin_status', {p_id:id,p_status:status}, await adminToken());
  }
  async function adminMove(id, day, slot) {
    return rpc('ktt_admin_move', {p_id:id,p_day:day,p_slot:slot}, await adminToken());
  }
  function logout() { clearSession(); }
  window.KTT = {ready,seoulToday,addDays,schedules,previewSlots,availableSlots,booking,
    login,readSession,adminList,adminStatus,adminMove,logout,levelNames};
})();
