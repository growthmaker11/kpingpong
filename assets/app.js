(() => {
  'use strict';
  const K=window.KTT;
  const form=document.getElementById('bookingForm');
  const dateField=document.getElementById('bookingDate');
  const slotField=document.getElementById('bookingSlot');
  const slots=document.getElementById('slots');
  const feedback=document.getElementById('formFeedback');
  const submit=document.getElementById('submitBooking');
  const hint=document.getElementById('bookingHint');
  const bank=document.getElementById('bankCard');
  let kind='trial', loadingSeq=0;
  dateField.min=K.seoulToday();
  dateField.max=K.addDays(K.seoulToday(),60);
  document.getElementById('currentYear').textContent=new Date().getFullYear();
  if (!K.ready) document.getElementById('configNotice').hidden=false;

  function showMessage(message, ok=false){
    feedback.hidden=false;
    feedback.className='form-feedback '+(ok?'success':'error');
    feedback.textContent=message;
  }
  function clearMessage(){feedback.hidden=true;feedback.textContent='';}
  function setKind(next){
    kind=next;dateField.value='';slotField.value='';clearMessage();
    slots.innerHTML='<p class="slots-empty">날짜를 선택하면 예약 가능한 시간이 나타납니다.</p>';
    document.querySelectorAll('[data-type]').forEach(button=>{
      const selected=button.dataset.type===kind;
      button.classList.toggle('active',selected);
      button.setAttribute('aria-pressed',String(selected));
    });
    hint.textContent=kind==='trial'
      ? '첫 방문 30분 레슨비 무료 · 장소사용료 10,000원 별도'
      : '정기 레슨: 화·목 19~22시 / 토·일 15~19시 · 30분 단위';
    bank.hidden=kind!=='trial';
  }
  document.querySelectorAll('[data-type]').forEach(b=>b.addEventListener('click',()=>setKind(b.dataset.type)));
  document.querySelectorAll('[data-pick]').forEach(a=>a.addEventListener('click',()=>setKind(a.dataset.pick)));

  function explainInvalidDate(day){
    if(day<K.seoulToday() || day>K.addDays(K.seoulToday(),60)) return '오늘부터 60일 이내의 날짜를 선택해 주세요.';
    return kind==='trial' ? '무료 체험은 월·화·목·금에 운영합니다.' : '정기 레슨은 화·목·토·일에 운영합니다.';
  }
  async function loadSlots(){
    const day=dateField.value; const seq=++loadingSeq;slotField.value='';
    slots.replaceChildren();
    if (!day) {slots.innerHTML='<p class="slots-empty">예약 날짜를 먼저 선택해 주세요.</p>';return;}
    if (!K.schedules(kind,day).length){slots.innerHTML=`<p class="slots-empty">${explainInvalidDate(day)}</p>`;return;}
    slots.innerHTML='<p class="slots-empty">시간대를 확인하고 있습니다…</p>';
    try{
      const items=await K.availableSlots(kind,day);
      if(seq!==loadingSeq)return;
      slots.replaceChildren();
      if(!items.length){slots.innerHTML='<p class="slots-empty">해당 날짜에 신청 가능한 레슨 시간이 없습니다.</p>';return;}
      for (const {slot,available} of items){
        const b=document.createElement('button');b.type='button';b.className='slot-button';b.textContent=slot;
        b.disabled=!available;b.setAttribute('aria-pressed','false');
        b.addEventListener('click',()=>{
          slotField.value=slot;
          slots.querySelectorAll('.slot-button').forEach(x=>{
            const selected=x===b;x.classList.toggle('selected',selected);
            x.setAttribute('aria-pressed',String(selected));
          });
        });
        slots.appendChild(b);
      }
    }catch(e){
      if(seq===loadingSeq){slots.replaceChildren();const p=document.createElement('p');p.className='slots-empty';p.textContent=e.message;slots.appendChild(p);}
    }
  }
  dateField.addEventListener('change',loadSlots);

  document.getElementById('copyAccount').addEventListener('click',async(event)=>{
    const button=event.currentTarget;
    try{await navigator.clipboard.writeText('79423893156');button.textContent='복사 완료 ✓';}
    catch{button.textContent='복사 불가';}
    setTimeout(()=>{button.textContent='계좌 복사';},2200);
  });
  const dialog=document.getElementById('privacyDialog');
  document.getElementById('privacyDetails').addEventListener('click',()=>dialog.showModal());
  dialog.querySelectorAll('[data-close-dialog]').forEach(b=>b.addEventListener('click',()=>dialog.close()));
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});

  form.addEventListener('submit',async event=>{
    event.preventDefault();clearMessage();
    const f=new FormData(form);
    const data={kind,day:dateField.value,slot:slotField.value,
      name:String(f.get('name')||'').trim(),phone:String(f.get('phone')||'').trim(),
      level:String(f.get('level')||''),experience:String(f.get('experience')||'').trim(),
      privacy:f.has('privacy'),policy:f.has('policy')};
    if (!data.day || !data.slot){showMessage('예약 날짜와 시간을 선택해 주세요.');return;}
    if (data.name.length<2){showMessage('이름을 2자 이상 입력해 주세요.');return;}
    const phone=data.phone.replace(/\D/g,'');
    if (!/^0\d{9,10}$/.test(phone)){showMessage('휴대전화 번호를 정확하게 입력해 주세요.');return;}
    if (!K.levelNames.includes(data.level)){showMessage('탁구 실력을 선택해 주세요.');return;}
    if(!data.privacy || !data.policy){showMessage('개인정보 수집 및 예약·환불 규정에 모두 동의해 주세요.');return;}
    if(!K.ready){showMessage('현재는 홈페이지 미리보기 상태입니다. 예약 신청은 저장되지 않습니다. 연결 설정 전에는 010-6357-8180으로 문의해 주세요.');return;}
    submit.disabled=true;submit.textContent='예약 접수 중…';
    try{
      const result=await K.booking(data);
      const no=String(result?.booking_no || '').slice(0,8).toUpperCase();
      const confirmation=kind==='trial'
        ? `신청이 접수되었습니다! (접수번호: ${no})\n\n카카오뱅크 79423893156 · 박성욱\n장소사용료 10,000원을 입금해 주세요.\n관리자가 실제 입금 내역을 확인한 후 예약이 확정됩니다.\n\n※ 노쇼 시 장소사용료는 환불되지 않습니다. 예약 변경은 레슨 시작 24시간 전까지 문의해 주세요.`
        : `정기 레슨 신청이 접수되었습니다! (접수번호: ${no})\n\n관리자 확인 후 예약이 확정됩니다.\n문의: 010-6357-8180`;
      showMessage(confirmation,true);
      const oldKind=kind;form.reset();setKind(oldKind);showMessage(confirmation,true);
      feedback.scrollIntoView({behavior:'smooth',block:'nearest'});
    }catch(e){showMessage(e.message||'예약을 접수하지 못했습니다.');await loadSlots();}
    finally{submit.disabled=false;submit.innerHTML='예약 신청하기 <span aria-hidden="true">↗</span>';}
  });
})();
