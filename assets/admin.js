(() => {
  'use strict';
  const K=window.KTT;
  const loginPanel=document.getElementById('loginPanel');
  const dashboard=document.getElementById('dashboard');
  const loginForm=document.getElementById('loginForm');
  const loginFeedback=document.getElementById('loginFeedback');
  const adminFeedback=document.getElementById('adminFeedback');
  const logoutBtn=document.getElementById('logoutBtn');
  const body=document.getElementById('bookingRows');
  const moveDialog=document.getElementById('moveDialog');
  const moveDay=document.getElementById('moveDay');
  const moveSlot=document.getElementById('moveSlot');
  const moveForm=document.getElementById('moveForm');
  let data=[], editing=null;
  const statusOptions={pending_payment:'입금 확인 대기',pending:'예약 확인 대기',confirmed:'예약 확정',completed:'레슨 완료',no_show:'노쇼',cancelled:'취소'};
  const typeOptions={trial:'무료 체험',regular:'정기 레슨'};
  if(!K.ready) document.getElementById('adminConfigNotice').hidden=false;

  function message(el,text,ok=false){el.hidden=false;el.className='form-feedback '+(ok?'success':'error');el.textContent=text;}
  function td(text,cls){const el=document.createElement('td');if(cls)el.className=cls;el.textContent=text??'—';return el;}
  function small(parent,text){const n=document.createElement('small');n.textContent=text;parent.appendChild(n);}
  function strong(parent,text){const n=document.createElement('strong');n.textContent=text;parent.appendChild(n);}
  function showSignedIn(){loginPanel.hidden=true;dashboard.hidden=false;logoutBtn.hidden=false;}
  function showLoggedOut(){loginPanel.hidden=false;dashboard.hidden=true;logoutBtn.hidden=true;}
  function displayedRows(){
    const kind=document.getElementById('filterType').value;
    const status=document.getElementById('filterStatus').value;
    const day=document.getElementById('filterDate').value;
    return data.filter(r=>(kind==='all'||r.kind===kind)&&(status==='all'||r.status===status)&&(!day||r.day===day));
  }
  async function refresh(){
    try{
      data=await K.adminList();
      if(!Array.isArray(data))throw new Error('예약 목록 형식이 올바르지 않습니다.');
      showSignedIn();render();
    }catch(e){message(adminFeedback,e.message); if(/로그인|권한|JWT/i.test(e.message))showLoggedOut();throw e;}
  }
  function stat(id,filter){document.getElementById(id).textContent=data.filter(filter).length.toLocaleString('ko-KR');}
  function render(){
    stat('statAll',()=>true);stat('statPayment',r=>r.status==='pending_payment');
    stat('statPending',r=>r.status==='pending');stat('statConfirmed',r=>r.status==='confirmed');
    body.replaceChildren();const rows=displayedRows();
    if(!rows.length){const tr=document.createElement('tr');const cell=td('조회된 예약이 없습니다.','table-empty');cell.colSpan=7;tr.append(cell);body.append(tr);return;}
    for(const r of rows){
      const tr=document.createElement('tr');
      tr.appendChild(td(`#${r.id.slice(0,8).toUpperCase()}`,'id-mono'));
      const schedule=td('');schedule.textContent='';strong(schedule,r.day);small(schedule,r.slot+' · 30분');tr.appendChild(schedule);
      tr.appendChild(td(typeOptions[r.kind]||r.kind));
      const person=td('');person.textContent='';strong(person,r.name);small(person,r.phone);tr.appendChild(person);
      const lvl=td('');lvl.textContent='';strong(lvl,r.level);const exp=document.createElement('div');exp.className='exp-text';exp.textContent=r.experience||'경험 입력 없음';lvl.appendChild(exp);tr.appendChild(lvl);
      const state=td('');const badge=document.createElement('span');badge.className='status-badge status-'+r.status;badge.textContent=statusOptions[r.status]||r.status;state.appendChild(badge);tr.appendChild(state);
      const actionTd=td('');const actions=document.createElement('div');actions.className='row-actions';
      const selector=document.createElement('select');selector.setAttribute('aria-label',`${r.name} 예약 상태 변경`);
      for(const [value,label] of Object.entries(statusOptions)){
        const o=document.createElement('option');o.value=value;o.textContent=label;if(value===r.status)o.selected=true;selector.appendChild(o);
      }
      const save=document.createElement('button');save.type='button';save.textContent='상태 저장';
      save.addEventListener('click',async()=>{
        if(selector.value===r.status)return;
        if(!confirm(`${r.name}님의 예약을 '${statusOptions[selector.value]}' 상태로 변경하시겠습니까?\n\n※ 실제 환불 및 문자 발송은 자동으로 이루어지지 않습니다.`)){selector.value=r.status;return;}
        save.disabled=true;
        try{await K.adminStatus(r.id,selector.value);message(adminFeedback,'예약 상태가 변경되었습니다. 필요한 경우 회원에게 직접 안내해 주세요.',true);await refresh();}
        catch(e){message(adminFeedback,e.message);selector.value=r.status;}finally{save.disabled=false;}
      });
      const move=document.createElement('button');move.type='button';move.className='move-btn';move.textContent='시간 변경';
      move.disabled=['cancelled','completed','no_show'].includes(r.status);
      move.addEventListener('click',()=>openMove(r));
      actions.append(selector,save,move);
      if(r.status==='confirmed'){
        const copy=document.createElement('button');copy.type='button';copy.className='move-btn';copy.textContent='확정 안내문 복사';
        copy.addEventListener('click',async()=>{
          const start=`${r.day} ${r.slot}`;
          const note = r.kind==='trial'
            ? `[K탁구클럽]\n${r.name}님, 장소사용료 10,000원 입금을 확인했습니다.\n30분 무료 체험 레슨 예약이 확정되었습니다.\n일시: ${start} (30분)\n장소: 서울시 노원구 동일로207길 23 지하1층\n※ 노쇼 시 장소사용료 환불 불가. 변경은 레슨 24시간 전까지 연락해 주세요.\n문의: 010-6357-8180`
            : `[K탁구클럽]\n${r.name}님, 정기 레슨 예약이 확정되었습니다.\n일시: ${start} (30분)\n장소: 서울시 노원구 동일로207길 23 지하1층\n예약 변경은 레슨 24시간 전까지 문의해 주세요.\n문의: 010-6357-8180`;
          try { await navigator.clipboard.writeText(note);message(adminFeedback,'예약 확정 안내문을 복사했습니다. 회원에게 직접 문자로 보내 주세요.',true); }
          catch {message(adminFeedback,'문자 복사를 지원하지 않는 환경입니다. HTTPS에서 다시 이용해 주세요.');}
        });
        actions.append(copy);
      }
      actionTd.appendChild(actions);tr.appendChild(actionTd);
      body.appendChild(tr);
    }
  }
  function csvEscape(text){
    let value=String(text??'');
    // CSV 수식 인젝션 완화: 스프레드시트 수식 접두 문자 이스케이프
    if(/^[\s\t\r]*[=+\-@]/.test(value))value="'"+value;
    return '"'+value.replaceAll('"','""')+'"';
  }
  document.getElementById('csvBtn').addEventListener('click',()=>{
    const fields=[['예약번호','날짜','시간','레슨유형','이름','연락처','탁구실력','레슨경험','상태','접수일시'],
      ...displayedRows().map(r=>[r.id,r.day,r.slot,typeOptions[r.kind],r.name,"'"+r.phone,r.level,r.experience||'',statusOptions[r.status],r.created_at])];
    const content='\uFEFF'+fields.map(row=>row.map(csvEscape).join(',')).join('\r\n');
    const blob=new Blob([content],{type:'text/csv;charset=utf-8;'});
    const objectUrl=URL.createObjectURL(blob);const link=document.createElement('a');
    link.href=objectUrl;link.download='K탁구클럽_예약목록.csv';document.body.append(link);link.click();link.remove();URL.revokeObjectURL(objectUrl);
  });
  loginForm.addEventListener('submit',async e=>{
    e.preventDefault();loginFeedback.hidden=true;
    if(!K.ready){message(loginFeedback,'데이터베이스 설정을 먼저 완료해 주세요.');return;}
    const b=loginForm.querySelector('button[type="submit"]');b.disabled=true;
    const f=new FormData(loginForm);
    try{await K.login(String(f.get('email')),String(f.get('password')));loginForm.reset();await refresh();}
    catch(e){message(loginFeedback,e.message);showLoggedOut();}
    finally{b.disabled=false;}
  });
  logoutBtn.addEventListener('click',()=>{K.logout();data=[];showLoggedOut();adminFeedback.hidden=true;});
  document.getElementById('refreshBtn').addEventListener('click',()=>{refresh().catch(()=>{});});
  document.getElementById('applyFilters').addEventListener('click',render);
  document.getElementById('resetFilters').addEventListener('click',()=>{
    document.getElementById('filterDate').value='';
    document.getElementById('filterType').value='all';
    document.getElementById('filterStatus').value='all';render();
  });
  function openMove(r){
    editing=r;
    document.getElementById('moveDetails').textContent=`${r.name} / ${typeOptions[r.kind]} / 기존 예약 ${r.day} ${r.slot}`;
    const today=K.seoulToday();moveDay.min=today;moveDay.max=K.addDays(today,60);
    moveDay.value=r.day>=today?r.day:today;
    document.getElementById('moveFeedback').hidden=true;
    loadMoveSlots().then(()=>moveDialog.showModal());
  }
  async function loadMoveSlots(){
    const r=editing;if(!r)return;
    moveSlot.replaceChildren();const p=document.createElement('option');p.value='';p.textContent='시간 확인 중…';moveSlot.appendChild(p);
    if(!K.schedules(r.kind,moveDay.value).length){p.textContent='해당 레슨 운영일이 아닙니다';return;}
    try{
      const records=await K.availableSlots(r.kind,moveDay.value);
      moveSlot.replaceChildren();const blank=document.createElement('option');blank.value='';blank.textContent='시간을 선택해 주세요';moveSlot.appendChild(blank);
      for(const rec of records){const opt=document.createElement('option');opt.value=rec.slot;opt.textContent=rec.slot+(rec.available?'':' (예약 불가)');opt.disabled=!rec.available;moveSlot.appendChild(opt);}
    }catch(e){moveSlot.replaceChildren();const o=document.createElement('option');o.textContent=e.message;moveSlot.appendChild(o);}
  }
  moveDay.addEventListener('change',loadMoveSlots);
  moveForm.addEventListener('submit',async(e)=>{
    e.preventDefault();const f=new FormData(moveForm),feedback=document.getElementById('moveFeedback');feedback.hidden=true;
    const day=String(f.get('day')||''),slot=String(f.get('slot')||'');
    if(!day||!slot){message(feedback,'변경할 날짜와 시간을 선택해 주세요.');return;}
    const button=moveForm.querySelector('button[type="submit"]');button.disabled=true;
    try{await K.adminMove(editing.id,day,slot);moveDialog.close();message(adminFeedback,'예약 시간이 변경되었습니다. 회원에게 변경 내용을 직접 안내해 주세요.',true);await refresh();}
    catch(err){message(feedback,err.message);}finally{button.disabled=false;}
  });
  moveDialog.querySelectorAll('[data-close-dialog]').forEach(b=>b.addEventListener('click',()=>moveDialog.close()));
  moveDialog.addEventListener('click',event=>{if(event.target===moveDialog)moveDialog.close();});
  if(K.readSession())refresh().catch(()=>{showLoggedOut();});
})();
