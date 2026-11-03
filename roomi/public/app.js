// ============================================================
// 루미(RooMi) — frontend (vanilla JS)
// ============================================================
const API = '';
// ★ P1-5 quests 초기값을 실제 구조({list,done})와 일치시킨다.
//   예전에는 [] 였는데 renderQuests 가 state.quests.done 을 바로 읽어
//   네트워크가 느릴 때 TypeError 가 날 수 있었다.
let state = { user:null, robot:null, template:'roundy', palette:{}, color:'#e74c3c', recolor:false,
              quests:{ list:[], done:[] }, parts:[], decors:[], skins:[], shards:[],
              itemQty:{}, shardProgress:null, shardTargets:[], overLimit:false, playMinutes:0,
              growth:{ level:1, exp:0, expNeeded:100, stage:1, streak:0 } };

const COLORABLE = ['antenna','head','body','arms','legs'];
const PALETTE = ['#e74c3c','#ff8c42','#f1c40f','#ffd93d','#2ecc71','#8bc34a',
                 '#1abc9c','#3498db','#9b59b6','#c39bd3','#e91e8c','#34495e'];
// ★ P2-2 기본 팔레트를 단일 진실 공급원으로 정의(2D robotSVG / 3D effectiveColors 공용).
//   예전에는 DEFAULT_PAL 이 app.js 에 두 번 정의돼 한쪽만 고치면 2D/3D 색이 어긋났다.
// ★ V3 재수정: PAL_BASE 를 여기(모듈 최상단)로 옮긴다.
//   원래 robotSVG() 함수 안(L26)에 있었는데, 중복 정의를 지우며 effectiveColors()
//   쪽 사본만 남기고 원본을 그대로 두었다 → effectiveColors 가 함수 밖 변수를 참조해
//   ReferenceError: PAL_BASE is not defined → startBabylon 이 catch → 3D 방이 안 뜨고
//   2D SVG 로 강등됐다.
  // 교훈: 상수 정의 개수만 세지 말고 어느 스코프에 있는지도 확인한다.
const PAL_BASE = {
  doro:   {body:'#5cae7f', head:'#93d6bc', antenna:'#2e7d4f', arms:'#2e7d4f', legs:'#2e7d4f'},
  roundy: {body:'#f2a65a', head:'#ffd9a8', antenna:'#c77b3a', arms:'#c77b3a', legs:'#b06a30'},
  boxy:   {body:'#6f9fd8', head:'#a8c8ec', antenna:'#3f6ea5', arms:'#3f6ea5', legs:'#3f6ea5'},
  tally:  {body:'#b585d6', head:'#d9b8e8', antenna:'#8a54ad', arms:'#8a54ad', legs:'#7a4699'},
};
const DEFAULT_PAL = { antenna:'#ffb020', head:'#9fb7d8', body:'#5c86c7', belly:'#e8f0fb', arms:'#5c86c7', legs:'#44618f' };

// ---------- 세션 키(브랜드 변경에 맞춰 roomi_ 로 통일) ----------
const SK = { uid:'roomi_uid', nick:'roomi_nick', token:'roomi_token', consent:'roomi_consent' };

// ---------- SVG 로봇 (3종 템플릿, 부위별 data-part) ----------
function robotSVG(template, pal){
  // PAL_BASE / DEFAULT_PAL 은 파일 최상단(모듈 스코프)에 정의되어 있다.
  const c = Object.assign({}, DEFAULT_PAL, PAL_BASE[template]||{}, pal||{});
  const eye='#25324a', cheek='#f7b2c1';
  // 통일 카와이이 얼굴(루미과 같은 스타일): 큰 타원 눈+하이라이트 / 미소 / 볼터치
  const face = (cx, ey, gap, s=1)=>{
    return `<ellipse cx="${cx-gap}" cy="${ey}" rx="${5*s}" ry="${8*s}" fill="${eye}"/><circle cx="${cx-gap+2*s}" cy="${ey-3*s}" r="${1.8*s}" fill="#fff"/>
      <ellipse cx="${cx+gap}" cy="${ey}" rx="${5*s}" ry="${8*s}" fill="${eye}"/><circle cx="${cx+gap-2*s}" cy="${ey-3*s}" r="${1.8*s}" fill="#fff"/>
      <path d="M${cx-8*s} ${ey+13*s} Q${cx} ${ey+21*s} ${cx+8*s} ${ey+13*s}" stroke="${eye}" stroke-width="${3.2*s}" fill="none" stroke-linecap="round"/>
      <circle cx="${cx-gap-13*s}" cy="${ey+13*s}" r="${5.5*s}" fill="${cheek}" opacity="0.8"/>
      <circle cx="${cx+gap+13*s}" cy="${ey+13*s}" r="${5.5*s}" fill="${cheek}" opacity="0.8"/>`;
  };
  const shine = (cx,cy,rx,ry)=>`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#fff" opacity="0.25"/>`;
  const groundShadow = (cy,rx)=>`<ellipse cx="100" cy="${cy}" rx="${rx}" ry="9" fill="#000" opacity="0.10"/>`;
  const antenna = `<g data-part="antenna"><line x1="100" y1="14" x2="100" y2="34" stroke="${c.antenna}" stroke-width="5" stroke-linecap="round"/>
    <circle cx="100" cy="12" r="9" fill="${c.antenna}"/><circle cx="97" cy="9" r="2.2" fill="#fff" opacity="0.7"/></g>`;
  const legs = (y)=>`<g data-part="legs"><rect x="74" y="${y}" width="18" height="22" rx="8" fill="${c.legs}"/>
    <rect x="108" y="${y}" width="18" height="22" rx="8" fill="${c.legs}"/></g>`;
  const arms = (x1,x2,y,h,w)=>`<g data-part="arms"><rect x="${x1}" y="${y}" width="${w}" height="${h}" rx="${w/2}" fill="${c.arms}"/>
    <rect x="${x2}" y="${y}" width="${w}" height="${h}" rx="${w/2}" fill="${c.arms}"/></g>`;

  let s='';
  if(template==='roundy'){
    // 둥근이: 2단 구조(밝은 주황 머리 + 어두운 주황 둥근 몸), 배 패널 없음, 같은 계열 안테나/팔다리
    s = `${groundShadow(234,52)}
      ${antenna}
      ${arms(28,156,148,44,18)}
      <ellipse data-part="body" cx="100" cy="174" rx="46" ry="42" fill="${c.body}"/>
      <ellipse cx="100" cy="202" rx="30" ry="9" fill="#000" opacity="0.06"/>
      <ellipse data-part="head" cx="100" cy="80" rx="56" ry="50" fill="${c.head}"/>
      ${shine(74,64,12,26)}
      ${face(100,72,22,1.15)}
      ${legs(214)}`;
  } else if(template==='boxy'){
    // 네모이: 2단 구조(밝은 파란 사각 머리 + 어두운 파란 둥근 모서리 몸), 배 패널 없음
    s = `${groundShadow(236,50)}
      ${antenna}
      ${arms(22,158,140,56,16)}
      <rect data-part="body" x="58" y="124" width="84" height="90" rx="24" fill="${c.body}"/>
      <ellipse cx="100" cy="204" rx="30" ry="9" fill="#000" opacity="0.06"/>
      <rect data-part="head" x="46" y="28" width="108" height="94" rx="28" fill="${c.head}"/>
      ${shine(70,50,10,22)}
      ${face(100,74,24,1.1)}
      ${legs(214)}`;
  } else if(template==='doro'){
    // 공식 스타일: 마이룸 3D로 살아난 콩나물 캐릭터 — 2단 캡슐 바디(위 밝게/아래 어둡게) + 가는 콩나물 안테나 + 어두운 짧은 팔다리
    s = `<ellipse cx="100" cy="234" rx="48" ry="8" fill="#000" opacity="0.10"/>
      ${arms(30,152,150,44,15)}
      ${legs(210)}
      <rect data-part="body" x="56" y="128" width="88" height="86" rx="30" fill="${c.body}"/>
      <ellipse cx="100" cy="206" rx="30" ry="9" fill="#000" opacity="0.06"/>
      <rect data-part="head" x="54" y="52" width="92" height="96" rx="44" fill="${c.head}"/>
      <path d="M60 132 Q100 142 140 132 L140 150 Q100 158 60 150 Z" fill="#000" opacity="0.05"/>
      <ellipse cx="74" cy="86" rx="9" ry="24" fill="#fff" opacity="0.28"/>
      <ellipse cx="84" cy="100" rx="5" ry="8" fill="${eye}"/><circle cx="86" cy="96" r="1.6" fill="#fff"/>
      <ellipse cx="116" cy="100" rx="5" ry="8" fill="${eye}"/><circle cx="114" cy="96" r="1.6" fill="#fff"/>
      <circle cx="70" cy="114" r="5.5" fill="${cheek}" opacity="0.8"/><circle cx="130" cy="114" r="5.5" fill="${cheek}" opacity="0.8"/>
      <path d="M95 120 Q100 125 105 120" stroke="${eye}" stroke-width="3" fill="none" stroke-linecap="round"/>
      <g data-part="antenna"><path d="M100 52 L100 18" stroke="${c.antenna}" stroke-width="4.5" stroke-linecap="round"/>
      <path d="M88 52 Q100 44 112 52 L112 58 Q100 50 88 58 Z" fill="${c.antenna}"/>
      <circle cx="100" cy="14" r="7.5" fill="${c.antenna}"/><circle cx="97.5" cy="11.5" r="2" fill="#fff" opacity="0.7"/></g>`;
  } else { // tally
    // 키다리: 2단 구조(밝은 보라 둥근 머리 + 어두운 보라 긴 캡슐 몸), 배 패널 없음
    s = `${groundShadow(238,44)}
      ${antenna}
      ${arms(34,152,112,72,13)}
      <rect data-part="body" x="70" y="104" width="60" height="114" rx="26" fill="${c.body}"/>
      <ellipse cx="100" cy="208" rx="24" ry="8" fill="#000" opacity="0.06"/>
      <ellipse data-part="head" cx="100" cy="60" rx="46" ry="42" fill="${c.head}"/>
      ${shine(80,46,9,20)}
      ${face(100,54,19,1)}
      ${legs(216)}`;
  }
  return `<svg viewBox="0 0 200 250" xmlns="http://www.w3.org/2000/svg">${s}</svg>`;
}

// ---------- 유틸 ----------
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// ============================================================
// ★ V11 신규: 효과음 · 자랑하기 · 랭킹 · 온보딩 · 저사양 자동조정
// ============================================================

// ---------- 효과음 (WebAudio, 에셋 0바이트) ----------
// 초등 대상에서 청각 피드백은 재미의 큰 부분인데 지금까지 소리가 전혀 없었다.
// 오디오 파일을 받지 않고 오실레이터로 만들므로 로딩 지연이 0 이다.
// 브라우저 정책상 AudioContext 는 '사용자 제스처' 이후에만 열리므로 첫 클릭에 함께 열린다.
const SFX = (()=>{
  let ctx = null;
  let on = true;
  try{ on = localStorage.getItem('roomi_sfx') !== '0'; }catch(e){}
  const ac = ()=>{
    if(!on) return null;
    try{
      if(!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if(ctx.state === 'suspended') ctx.resume();
      return ctx;
    }catch(e){ return null; }
  };
  // 짧은 음 하나 — 주파수·길이·파형·볼륨·지연
  const tone = (freq, dur, type, vol, delay)=>{
    const c = ac(); if(!c) return;
    try{
      const t0 = c.currentTime + (delay || 0);
      const osc = c.createOscillator(), g = c.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.07, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g); g.connect(c.destination);
      osc.start(t0); osc.stop(t0 + dur + 0.03);
    }catch(e){}
  };
  const seq = notes => notes.forEach(n => tone(n[0], n[1], 'triangle', 0.06, n[2]));
  return {
    get on(){ return on; },
    toggle(){
      on = !on;
      try{ localStorage.setItem('roomi_sfx', on ? '1' : '0'); }catch(e){}
      if(on){ const c = ac(); if(c) tone(880, 0.12, 'triangle', 0.07); }
      return on;
    },
    click(){ tone(620, 0.06, 'square', 0.03); },
    coin(){ seq([[880,0.09,0],[1320,0.14,0.07]]); },       // 셀 획득
    levelup(){ seq([[660,0.10,0],[880,0.10,0.09],[1175,0.22,0.18]]); },
    correct(){ seq([[740,0.08,0],[988,0.12,0.06]]); },
    wrong(){ seq([[300,0.14,0],[220,0.20,0.10]]); },
    start(){ seq([[520,0.08,0],[700,0.10,0.07]]); },
  };
})();

// 모든 버튼 클릭에 가벼운 소리(캡처 단계라 기존 핸들러를 방해하지 않는다)
document.addEventListener('click', e=>{
  const t = e.target;
  const b = t && t.closest ? t.closest('.btn, .navbtn, .tpl, .sw, .pad, [data-close]') : null;
  if(b) SFX.click();
}, true);

$('#btn-sfx').addEventListener('click', ()=>{
  const on = SFX.toggle();
  $('#btn-sfx').textContent = on ? '소리' : '음소거';
  $('#btn-sfx').title = on ? '소리 끄기' : '소리 켜기';
});
(function initSfxIcon(){
  const b = $('#btn-sfx'); if(!b) return;
  b.textContent = SFX.on ? '' : '';
  b.title = SFX.on ? '소리 끄기' : '소리 켜기';
})();

function show(id){ $$('.screen').forEach(e=>e.classList.add('hidden')); $('#screen-'+id).classList.remove('hidden');
  $('#topbar').classList.toggle('hidden', id==='start'); }
function setBalance(v){
  // ★ V11: 셀이 '늘어난' 순간에만 보상음을 낸다(단일 지점이라 모든 보상 경로를 잡는다).
  //   로딩·화면 전환처럼 값이 그대로일 때는 울리지 않는다.
  const prev = state._lastBalance;
  state._lastBalance = v;
  $('#cell-balance').textContent = v;
  if(prev != null && v> prev) SFX.coin();
}
function bubble(text){ const b=$('#bubble'); b.textContent=text; b.classList.remove('hidden');
  clearTimeout(b._t); b._t=setTimeout(()=>b.classList.add('hidden'), 4500); }
async function api(path, body, timeoutMs){
  const o = { headers:{} };
  if(body){ o.method='POST'; o.headers['Content-Type']='application/json'; o.body=JSON.stringify(body); }
  const tk = localStorage.getItem(SK.token); // 세션 토큰 — uid 위조 방지
  if(tk) o.headers['X-Token'] = tk;
  const ac = new AbortController(); o.signal = ac.signal;
  const t = setTimeout(()=>ac.abort(), timeoutMs||25000);
  try{
    const r = await fetch(API+path,o);
    const txt = await r.text();
    let j;
    try{ j = JSON.parse(txt); }
    catch{ // HTML이 온다 = 서버가 없는 페이지(미리보기 창)에서 실행한 경우
      throw new Error('서버에 연결할 수 없어요. 미리보기 창이 아니라 실제 주소(localhost:3000 또는 온라인 주소)에서 열어주세요'); }
    if(!r.ok) throw new Error(j.error||'오류');
    return j;
  }catch(e){
    if(e.name==='AbortError') throw new Error('서버 응답이 늦어요. 잠시 후 다시 시도해주세요');
    throw e;
  }finally{ clearTimeout(t); }
}

// ---------- 내비게이션 ----------
$$('.navbtn').forEach(b=>b.addEventListener('click',()=>goNav(b.dataset.nav)));

// ============================================================
// ★ V15 공작소 / 우편함 / 수업 출석 (실행방안 P0-1 · P0-4 · P0-3)
// ============================================================

// ----- 공작소 (P0-1) -----
async function loadWorkshop(){
  const box = $('#ws-robot');
  const list = $('#ws-owned-list');
  let j;
  try{ j = await api('/api/workshop/status'); }
  catch(e){ box.innerHTML = `<span class="hint">${esc(e.message)}</span>`; return; }
  // 로봇 미리보기(2D SVG — 3D 로딩 실패와 무관하게 항상 보이게 한다)
  if(j.hasRobot){
    const pal = (state.robot && state.robot.palette) || {};
    box.innerHTML = `<div class="ws-preview">${robotSVG(state.robot.template, effectiveColors(state.robot.template, state.robot.palette))}</div>
      <div class="ws-meta"><b>${esc(j.robot.name)}</b>
      <span class="pers">성격 · ${esc(j.robot.personality)}</span>
      <span class="greet">"${esc(j.robot.greeting||'')}"</span></div>`;
  } else {
    box.innerHTML = '<span class="hint">아직 로봇이 없어요. 먼저 로봇을 만들어주세요!</span>';
  }
  $('#ws-recolor-limit').textContent = j.canRecolor ? '오늘 1회 가능' : '오늘은 완료 · 내일 다시';
  $('#ws-regen-limit').textContent = j.canRegenerate ? '오늘 1회 가능' : '오늘은 완료 · 내일 다시';
  $('#ws-recolor').disabled = !j.canRecolor || !j.hasRobot;
  $('#ws-regen').disabled = !j.canRegenerate || !j.hasRobot;
  $('#ws-ask-left').textContent = `오늘 ${j.askLeft}번 더 물어볼 수 있어요 (하루 5번)`;
  $('#ws-ask-btn').disabled = j.askLeft <= 0;
  list.innerHTML = (j.owned && j.owned.length)
    ? j.owned.map(o=>`<span class="ws-own">${esc(o.name)} <b>×${o.qty}</b></span>`).join('')
    : '<span class="hint">아직 없어요. 상점에서 부품을 사보세요!</span>';
}

// 색칠 다시 하기 — 로봇 생성 화면(캔버스·팔레트)을 '수정 모드'로 그대로 재사용한다.
//   같은 UI 를 두 번 만들면 2D/3D 색이 어긋나는 사고가 재발하므로 흐름을 공유한다.
function openRecolor(){
  const r = state.robot;
  if(!r) return;
  state.recolor = true;                       // 완성 버튼을 '저장' 으로 분기
  state.template = r.template;                // 템플릿은 유지(색만 바꾼다)
  state.palette = Object.assign({}, effectiveColors(r.template, r.palette));
  renderPicker();
  // 수정 모드 안내 + 템플릿 선택 숨김(템플릿은 못 바꾸므로 오해 방지)
  const tp = $('#template-picker');
  if(tp){ tp.classList.add('hidden'); }
  const card = $('#screen-create .card') || $('#screen-create');
  if(card && !$('#recolor-note')){
    const n = document.createElement('p');
    n.id = 'recolor-note'; n.className = 'hint recolor-note';
    n.textContent = ' 색칠 고치기 — 마음에 들면 아래 저장 버튼을 눌러요!';
    card.insertBefore(n, card.firstChild);
  }
  $('#btn-done').textContent = '저장! ';
  show('create');
}
// 수정 모드 종료(원래 만들기 화면 상태로 되돌린다)
function exitRecolor(){
  state.recolor = false;
  const tp = $('#template-picker'); if(tp) tp.classList.remove('hidden');
  const n = $('#recolor-note'); if(n) n.remove();
  $('#btn-done').textContent = '완성! ';
}
async function submitRecolor(){
  try{
    await api('/api/workshop/recolor', { palette: state.palette });
    const jr = await api('/api/robots/me');
    absorbRobotMe(jr);
    if(bjs.ready && state.robot) rebuildRobot(state.robot);
    exitRecolor();
    bubble(' 색칠을 바꿨어요!');
    goNav('workshop');
  }catch(e){ alert(e.message); }
}
// 탭 전환을 코드에서도 쓸 수 있게 한 곳에 모은다(버튼 클릭과 동일 동작)
function goNav(name){
  $$('.navbtn').forEach(x=>x.classList.toggle('on', x.dataset.nav===name));
  show(name);
  if(name==='shop') loadShop();
  if(name==='board') loadBoard();
  if(name==='workshop') loadWorkshop();
  if(name==='mail') loadMailbox();
  if(name==='myroom' && state.robot) renderMyroom();
}
async function regeneratePersonality(){
  const b = $('#ws-regen');
  b.disabled = true;
  try{
    const r = await api('/api/workshop/regenerate', {}, 30000);
    if(state.robot){ state.robot.personality = r.personality; state.robot.greeting = r.greeting; }
    bubble(` 새 성격: ${r.personality}`);
    loadWorkshop();
    if(state.robot) renderMyroom();
  }catch(e){ alert(e.message); }
  finally{ b.disabled = false; }
}
async function askRobot(){
  const q = $('#ws-q').value.trim();
  if(q.length <2) return alert('무엇이 궁금한지 한 줄로 적어줄래?');
  const b = $('#ws-ask-btn');
  b.disabled = true; b.textContent = '생각하는 중…';
  const ans = $('#ws-answer');
  ans.classList.remove('hidden');
  ans.textContent = ' ...';
  try{
    const r = await api('/api/workshop/ask', { question:q }, 30000);
    ans.innerHTML = `<b> 로봇의 대답</b><br>${esc(r.answer)}`;
    $('#ws-q').value = '';
    $('#ws-ask-left').textContent = `오늘 ${r.left}번 더 물어볼 수 있어요 (하루 5번)`;
    if(r.left <= 0) b.disabled = true;
  }catch(e){
    ans.innerHTML = `<span style="color:#c92a2a">${esc(e.message)}</span>`;
  }finally{ b.textContent = '물어보기'; }
}

// 공작소 버튼 바인딩(로봇이 있을 때만 동작)
$('#ws-recolor').addEventListener('click', openRecolor);
$('#ws-regen').addEventListener('click', regeneratePersonality);
$('#ws-ask-btn').addEventListener('click', askRobot);
$('#ws-q').addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); askRobot(); } });
$('#mail-claim-all').addEventListener('click', async ()=>{
  try{
    const r = await api('/api/mailbox/claim-all', {});
    if(!r.count) return bubble('받을 선물이 없어요');
    setBalance(r.balance);
    bubble(` ${r.count}통에서 ${r.cell}셀${r.items.length?' + '+r.items.join(', '):''} 받았어요!`);
    loadMailbox();
  }catch(e){ alert(e.message); }
});

// ----- 우편함 (P0-4) -----
async function loadMailbox(){
  let j;
  try{ j = await api('/api/mailbox'); }
  catch(e){ $('#mail-list').innerHTML = `<span class="hint">${esc(e.message)}</span>`; return; }
  setMailBadge(j.unread);
  const claimable = j.mails.filter(m=>!m.claimed && (m.cell>0 || m.item));
  $('#mail-summary').textContent = claimable.length ? `받을 선물 ${claimable.length}개` : '받을 선물이 없어요';
  $('#mail-claim-all').disabled = claimable.length === 0;
  $('#mail-list').innerHTML = j.mails.length ? j.mails.map(m=>{
    const gift = [m.cell?` ${m.cell}셀`:'', m.item?` ${esc(m.item)}`:''].filter(Boolean).join(' · ');
    const state_ = m.claimed ? '<span class="done"> 받음</span>'
      : (gift ? `<button class="btn primary sm" data-claim="${m.id}"> 받기</button>` : '<span class="read">읽음</span>');
    return `<div class="mail ${m.claimed?'is-done':''}">
      <div class="mail-head"><b>${esc(m.title)}</b><span class="ts">${esc(String(m.ts||'').slice(0,16))}</span></div>
      ${m.body?`<div class="mail-body">${esc(m.body)}</div>`:''}
      ${gift?`<div class="mail-gift">${gift}</div>`:''}
      <div class="mail-act">${state_}</div>
    </div>`;
  }).join('') : '<p class="hint">아직 편지가 없어요. 과제를 하면 선물이 도착해요!</p>';
  $$('#mail-list [data-claim]').forEach(b=>b.addEventListener('click', async ()=>{
    b.disabled = true;
    try{
      const r = await api('/api/mailbox/claim', { id: Number(b.dataset.claim) });
      setBalance(r.balance);
      bubble(` ${r.cell?`+${r.cell}셀 `:''}${r.item?`[${r.item}] `:''}받았어요!`);
      loadMailbox();
    }catch(e){ alert(e.message); b.disabled = false; }
  }));
}
async function refreshMailBadge(){
  try{ const j = await api('/api/mailbox'); setMailBadge(j.unread); }catch(e){}
}
function setMailBadge(n){
  const el = $('#mail-badge');
  if(!el) return;
  el.textContent = n;
  el.classList.toggle('hidden', !n);
}

// ----- 수업 출석 (P0-3) -----
async function loadClassCard(){
  const box = $('#class-card');
  if(!box) return;
  let j;
  try{ j = await api('/api/class/status'); }catch(e){ return; }
  if(j.attended){
    box.innerHTML = `<span class="em"></span>
      <div class="cc-body"><b>이번 주 수업 출석 완료!</b>
      <span>${esc(j.weekLabel)} · +${j.reward}셀 받았어요</span></div>
      <span class="cc-done"></span>`;
    return;
  }
  box.innerHTML = `<span class="em"></span>
    <div class="cc-body"><b>이번 주 수업 출석하기</b>
    <span>${esc(j.hint)}</span></div>
    <div class="cc-act">
      <input id="class-code" inputmode="numeric" maxlength="4" placeholder="코드">
      <button class="btn primary sm" id="class-go">출석 (+${j.reward}셀)</button>
    </div>`;
  $('#class-go').addEventListener('click', async ()=>{
    const code = $('#class-code').value.trim();
    if(!code) return alert('선생님이 알려준 코드를 넣어주세요');
    const b = $('#class-go');
    b.disabled = true; b.textContent = '확인 중…';
    try{
      const r = await api('/api/class/attend', { code });
      setBalance(r.balance);
      if(r.growth && r.growth.leveledUp) bubble(` Lv.${r.growth.level} 달성!`);
      setTimeout(()=> bubble(` 수업 출석 완료! +${r.reward}셀`), 300);
      loadClassCard();
      if(state.user) state.user.cell_balance = r.balance;
    }catch(e){ alert(e.message); b.disabled = false; b.textContent = `출석 (+100셀)`; }
  });
}

// ---------- ★ V16 개인정보 · 보호자 동의 ----------
// 미성년자 대상 서비스이므로: (1) 수집 항목을 시작 화면에서 항상 볼 수 있게 하고,
// (2) 첫 이용 1회 보호자 동의를 받는다. 이미 동의한 브라우저는 다시 묻지 않는다.
function showPrivacy(){ $('#privacy-modal').classList.remove('hidden'); }
function checkConsent(){
  if(localStorage.getItem(SK.consent)) return true;
  $('#consent-modal').classList.remove('hidden');
  return false;
}
$('#link-privacy').addEventListener('click', e=>{ e.preventDefault(); showPrivacy(); });
$('#link-privacy-2').addEventListener('click', e=>{ e.preventDefault(); showPrivacy(); });
$('#consent-check').addEventListener('change', e=>{
  $('#consent-go').disabled = !e.target.checked;
});
// 동의 완료 → 저장 후 시작 화면으로
$('#consent-go').addEventListener('click', ()=>{
  localStorage.setItem(SK.consent, String(Date.now()));
  $('#consent-modal').classList.add('hidden');
  bubble('보호자 동의가 완료되었어요. 이제 시작해 볼까요?');
});
// 데모 버튼은 발표용이므로 동의 절차를 거치지 않는다(대신 시작 화면에 안내 링크는 항상 보인다)

// ---------- 시작 ----------
$('#btn-start').addEventListener('click', async ()=>{
  if(!checkConsent()) return;   // ★ V16 미동요 시 진입 차단
  const nick = $('#nickname').value.trim();
  if(!nick) return alert('닉네임을 입력해주세요!');
  try{
    const j = await api('/api/user',{nickname:nick});
    state.user = j.user; state.quests = j.quests;
    localStorage.setItem(SK.uid, j.user.id);
    localStorage.setItem(SK.nick, nick);
    localStorage.setItem(SK.token, j.user.token);
    if(j.streakBonus) setTimeout(()=> bubble(` ${j.streakBonus}일 연속 방문 보상 +${j.streakBonus}셀!`), 800);
    // ★ P0-4 오버플레이: 서버가 오늘의 누적 플레이 시간을 알려준다.
    //   한도를 넘었으면 마이룸으로 보내지 않고 보호자 확인 화면을 띄운다.
    //   (서버가 play_minutes 를 직접 세므로 브라우저에서 조작할 수 없다)
    if(j.play && j.play.overLimit){
      showOverplay({ minutes: j.play.minutes });
      return;
    }
    startPlayTimer();
    await enter();
  }catch(e){ alert(e.message); }
});
async function enter(){
  setBalance(state.user.cell_balance);
  // ★ V3: 예전에 이 api 호출이 실패하면(서버 일시 오류 등) enter() 가 그대로 reject 되어
  //   호출부에서 아무 처리를 하지 않으므로 화면이 시작 페이지에 멈췄다(무음 실패).
  //   이제는 실패를 화면에 알리고 다시 시도할 수 있게 한다.
  let j;
  try{ j = await api('/api/robots/me'); }
  catch(e){
    console.error('[enter]', e);
    bubble(e.message || '로봇 정보를 불러오지 못했어요');
    show('start');
    return;
  }
  state.robot = j.robot; state.quests = j.quests; state.parts = j.parts||[];
  state.decors = j.decors||[]; state.skins = j.skins||[]; state.shards = j.shards||[];
  state.itemQty = j.qty || state.itemQty || {};
  state.shardProgress = j.shardProgress || null;
  // ★ P0-2 성장 상태 로드(상단 Lv 표시용). 실패해도 나머지 흐름은 진행한다.
  try{ const g = await api('/api/growth/me'); state.growth = g; }catch(e){}
  if(state.robot){
    show('myroom'); renderMyroom();
    $('.navbtn[data-nav=myroom]').classList.add('on');
    // ★ P0-3 마이룸 진입 = 진짜 "접속 1회". 예전엔 로그인할 때마다 세어
    //   새로고침 횟수가 접속 횟수가 되어 재접속률이 왜곡됐다.
    markVisit();
  }
  else { renderPicker(); show('create'); }
}

// ---------- 부모 승인 게이트 + 오버플레이 방지 (P0-4) ----------
// ★ V2-6: 예전에 서버 엔드포인트만 있고 클라이언트 호출이 0건 이었다(죽은 코드).
//   이제 실제 화면에서 동작시킨다.
//   - 게이트: 곱셈 문제로 부모 확인(토큰은 서버 HMAC 이라 답을 볼 수 없다)
//   - 시간 초과: 하루 40분 초과 시 잠금, 부모 승인 시에만 추가 플레이 허용
let _gate = { a:0, b:0, token:null };
let _playTick = null;

async function openParentGate(){
  const modal = $('#parent-gate');
  const msg = $('#gate-msg');
  msg.textContent = '';
  msg.style.color = '#c92a2a';
  $('#gate-a').value = '';
  // 오버플레이 창이 깔려 있으면 먼저 닫는다(두 창이 겹쳐 보이지 않도록)
  const ov = $('#overplay');
  if(ov && !ov.classList.contains('hidden')) ov.classList.add('hidden');
  modal.classList.remove('hidden');
  // 문제 요청(실패하면 살리�� 않고 모달만 닫는다 — 게임을 못 하게 만들지 않는다)
  try{
    const q = await api('/api/parent/quiz', null, 8000);
    _gate = { a:q.a, b:q.b, token:q.token };
    $('#gate-q').textContent = `${q.a} × ${q.b} = ?`;
  }catch(e){
    // 서버가 잠깐 응답하지 않아도 아이를 막지 않는다(신중한 실패 처리)
    msg.textContent = '문제를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';
    return;
  }
}
function closeParentGate(){
  $('#parent-gate').classList.add('hidden');
  $('#gate-a').value = '';
}
async function verifyParent(){
  const msg = $('#gate-msg');
  const ans = Number($('#gate-a').value);
  if(!ans){ msg.textContent = '정답을 입력해 주세요.'; return; }
  try{
    await api('/api/parent/verify', { a:_gate.a, b:_gate.b, token:_gate.token, answer:ans });
    msg.textContent = ''; msg.style.color = '#2b8a3e';
    closeParentGate();
    bubble('부모 승인 완료! 오늘도 조금 더 놀자 ');
    // 잠금 해제 → 계속 진행
    if($('#overplay').classList.contains('hidden') === false) $('#overplay').classList.add('hidden');
    state.overLimit = false;
    startPlayTimer();
  }catch(e){
    msg.textContent = e.message || '정답이 아니에요.';
    // 시간 초과 상태였다면, 보호자가 틀렸을 때 다시 초과 창으로 돌아간다
    // (그래야 '내일 다시 올게요' 선택지가 사라지지 않는다)
    if(state.overLimit) showOverplay({ minutes: (state.playMinutes||0) });
  }
}
// 시간 초과 안내를 띄운다
function showOverplay(info){
  state.overLimit = true; state.playMinutes = info.minutes || 0;
  stopPlayTimer();
  const st = $('#overplay-stat');
  if(st) st.textContent = `오늘 ${info.minutes}분 플레이`;
  const m = $('#overplay-msg');
  if(m) m.innerHTML = '오늘 플레이 시간이 끝났어요.<br>눈이 피곤하니 쉬어가요!';
  $('#overplay').classList.remove('hidden');
}
// 실제 플레이 시간을 주기적으로 서버에 보고한다(시간 초과 판단 근거)
function startPlayTimer(){
  stopPlayTimer();
  if(state.overLimit) return;
  // 60초마다 60초 치를 보고 → 서버가 play_minutes 를 누적한다
  _playTick = setInterval(async ()=>{
    if(!state.user) return;
    try{
      const r = await api('/api/visit/playtime', { seconds:60 }, 8000);
      if(r && r.over) showOverplay({ minutes: r.playMinutes });
    }catch(e){ /* 네트워크 실패는 무시 — 다음 주기에 다시 보낸다 */ }
  }, 60000);
}
function stopPlayTimer(){
  if(_playTick){ clearInterval(_playTick); _playTick = null; }
}

// ---------- 방문 기록 + 체류시간 (P0-3 효과 검증 데이터 소스) ----------
// 마이룸 진입 시 "접속 1회" 를 기록하고, 페이지가 닫힐 때 누적 시간을 보낸다.
let _sessionStart = Date.now();
function markVisit(){
  _sessionStart = Date.now();
  api('/api/visit', {}).catch(()=>{});
}
// sendBeacon 은 unload 시에도 요청이 확실히 전송된다(navigator.sendBeacon).
// fetch keepalive 도 보조로 시도한다.
// ★ 수정: 예전에 sendBeacon 과 fetch 를 둘 다 쏘고 pagehide/beforeunload 에도
//   둘 다 걸어 두었다. 한 세션이 최대 4회 기록되어 체류시간이 2~4배로 부풀었다
//   (실측 확인 — 100초가 200초로 누적됨).
//   ① 전송 1회만 하도록 _reported 가드로 막고
//   ② 전송 수단도 sendBeacon 우선, 실패 시에만 fetch 로 물러나게 한다.
let _durationReported = false;
function reportDuration(){
  if(_durationReported) return;                     // ★ 한 세션 1회만 전송
  const sec = Math.round((Date.now() - _sessionStart) / 1000);
  if(sec <3) return;                               // 3초 미만은 실측 오류
  _durationReported = true;
  const payload = Math.min(sec, 7200);
  const tk = localStorage.getItem(SK.token);
  let sent = false;
  try{
    if(navigator.sendBeacon){
      // sendBeacon 은 커스텀 헤더를 못 붙여 토큰을 본문에 함께 실어 보낸다
      sent = navigator.sendBeacon('/api/visit/duration',
        new Blob([JSON.stringify({ seconds:payload, token:tk })], {type:'application/json'}));
    }
  }catch(e){ sent = false; }
  // sendBeacon 이 실패했을 때만 보조로 시도한다(이중 전송 방지)
  if(!sent){
    try{ fetch('/api/visit/duration', { method:'POST', headers:{'Content-Type':'application/json','X-Token':tk},
      body: JSON.stringify({ seconds:payload }), keepalive:true }); }catch(e){}
  }
}
// pagehide 만 사용한다. beforeunload 를 함께 걸면 두 이벤트가 연달아 발화한다.
addEventListener('pagehide', reportDuration);

// ---------- P1-5 상태 구조 보강 ----------
// robots/me 응답을 상태에 반영할 때 사용(parts + decors + 성장)
function absorbRobotMe(j){
  state.robot = j.robot; state.quests = j.quests || { list:[], done:[] };
  state.parts = j.parts||[]; state.decors = j.decors||[];
  state.skins = j.skins||[]; state.shards = j.shards||[];
  // ★ 보유 수량 + 조각 교환 진행도(V2-1 / V2-10)
  state.itemQty = j.qty || {};
  state.shardProgress = j.shardProgress || null;
}

// ---------- 만들기 ----------
function renderPicker(){
  // ★ P1-6 세계관 연결: 템플릿명에 DOROLAND 세계관 캐릭터 이름을 부여
  const NAMES = { roundy:'코엑스', boxy:'네모이', tally:'리코', doro:'루미' };
  $('#template-picker').innerHTML = ['doro','roundy','boxy','tally'].map(t=>
    `<div class="tpl ${state.template===t?'on':''}" data-tpl="${t}">${robotSVG(t,{})}<br>${NAMES[t]}</div>`).join('');
  $$('#template-picker .tpl').forEach(el=>el.addEventListener('click',()=>{
    state.template = el.dataset.tpl; state.palette = {}; renderPicker(); renderCanvas();
  }));
  renderCanvas(); renderPalette();
}
function renderPalette(){
  $('#palette').innerHTML = PALETTE.map(c=>`<div class="sw ${c===state.color?'on':''}" data-c="${c}" style="background:${c}"></div>`).join('');
  $$('#palette .sw').forEach(el=>el.addEventListener('click',()=>{ state.color=el.dataset.c; renderPalette(); }));
}
function renderCanvas(){
  $('#paint-canvas').innerHTML = robotSVG(state.template, state.palette);
  $$('#paint-canvas [data-part]').forEach(el=>el.addEventListener('click',()=>{
    if(!COLORABLE.includes(el.dataset.part)) return;
    state.palette[el.dataset.part] = state.color;
    renderCanvas();
  }));
}
$('#btn-done').addEventListener('click', async ()=>{
  if($('#btn-done').disabled) return;
  // ★ V15 공작소 수정 모드: 새로 만들지 않고 색칠만 저장한다
  if(state.recolor) return submitRecolor();
  const name = $('#bot-name').value.trim();
  if(!name) return alert('로봇 이름을 지어주세요!');
  if(Object.keys(state.palette).length===0) return alert('색칠을 한 번 해보세요!');
  const btn = $('#btn-done');
  btn.disabled = true; btn.textContent = ' AI가 성격을 만드는 중...';
  try{
    const j = await api('/api/robots',{ name, template:state.template, palette:state.palette}, 45000);
    // ★ P0-2 레벨업 표시(첫 로봇 완성 = 가장 강한 " 성장" 신호)
    const up = j.growth && j.growth.leveledUp;
    $('#modal-body').innerHTML = `
      <h2>${esc(name)} 완성! </h2>
      <div style="margin:12px 0">${robotSVG(state.template, state.palette)}</div>
      <p><b style="color:var(--primary)">성격: ${esc(j.personality)}</b></p>
      <p class="desc">${esc(j.desc)}</p>
      <p class="desc">"${esc(j.greeting)}"</p>
      <div class="reward"> +${esc(j.reward.cell)} 셀 ·  부품 [${esc(j.reward.part)}] 획득!${up?` ·  Lv.${esc(j.growth.level)} 달성!`:''}</div>`;
    $('#modal').classList.remove('hidden');
    state.robot = { name, template:state.template, palette:state.palette, personality:j.personality, greeting:j.greeting };
    // ★ P1-2 잔액은 서버가 준 실제 값을 사용(예전엔 +50 하드코딩이라 어긋났음)
    if(typeof j.balance === 'number'){ state.user.cell_balance = j.balance; setBalance(j.balance); }
    // ★ 성장 정보 병합: /api/robots 응답의 growth 에는 level/exp/stage 만 있으므로
    //   partBonus 등 나머지 필드는 기존 값을 유지해야 한다(덮어쓰면 보너스가 사라짐).
    if(j.growth) state.growth = { ...state.growth, ...j.growth, partBonus: state.growth.partBonus||0 };
    // 부품이 방금 지급되었으니 보너스를 다시 계산한다(0 이면 정상 — 아직 부품이 없을 수도)
    try{ state.growth = await api('/api/growth/me'); }catch(e){}
  }catch(e){ alert(e.message); }
  btn.disabled = false; btn.textContent = '완성! ';
});
$('#modal-ok').addEventListener('click', async ()=>{
  $('#modal').classList.add('hidden');
  try{ const j = await api('/api/robots/me'); absorbRobotMe(j); }catch(e){ /* 조회 실패해도 로컬 상태로 진입 */ }
  if(state.robot){ show('myroom'); renderMyroom(); markVisit(); }
});

// ---------- 마이룸 ----------
// ★ V9 연속 방문 달력 — '예고된 보상'으로 내일 다시 오게 만든다.
//   예전엔 7일 보상표가 서버에만 있어서 아이는 받고 나서야 얼마인지 알 수 있었다.
function renderStreakCal(){
  const el = $('#streak-cal');
  if(!el) return;
  const g = state.growth || {};
  const table = g.streakTable;
  if(!table){ el.innerHTML = ''; return; }
  const cyc = g.streakCycle || 7;
  const done = g.streakDoneSlot || 0;
  const next = g.streakNextSlot || 1;
  const cells = [];
  for(let i=1;i<=cyc;i++){
    const rew = table[i] || 0;
    // 7일을 다 채운 날에는 next(1일차)가 done 과 겹친다 → next 를 우선해
    // "내일부터 새 주기 시작"이 항상 보이도록 한다
    const isNext = (i === next);
    const cls = isNext ? 'next' : (i <= done ? 'done' : '');
    const mark = isNext ? '▲' : (i <= done ? '✓' : '');
    cells.push(`<span class="sc-cell ${cls}"><b>${rew}</b><i>${mark}</i></span>`);
  }
  const head = g.streak
    ? ` <b>${esc(g.streak)}일</b> 연속${g.streakNextReward ? ` · 내일 <b>+${esc(g.streakNextReward)}셀</b>` : ''}`
    : ` 오늘 시작! 내일 <b>+${esc(table[2]||0)}셀</b>`;
  el.innerHTML = `<div class="sc-head">${head}</div><div class="sc-row">${cells.join('')}</div>`;
}

// ★ V9 성장 수치를 다시 읽고, 단계가 바뀌었으면 3D 로봇을 다시 만든다.
//   라벨만 바뀌고 로봇은 그대로이던 것을 '눈앞에서 자라는' 경험으로 연결하는 지점.
async function refreshGrowth(){
  const prev = (state.growth && state.growth.stage) || 1;
  try{ state.growth = await api('/api/growth/me'); }catch(e){ return; }
  const now = state.growth.stage || 1;
  if(now !== prev && bjs.ready && state.robot){
    rebuildRobot(state.robot);
    setTimeout(()=>bubble(` ${({1:'아기',2:'청소년',3:'성체'})[now]} 로 자랐어!`), 700);
  }
  return state.growth;
}

// ★ V12 이번 주 주제 배너 — AI 과제가 수업/세계관과 이어져 있음을 화면으로 보여준다.
function renderTopic(){
  const el = $('#topic-banner');
  if(!el) return;
  const t = (state.growth && state.growth.topic) || null;
  if(!t){ el.innerHTML = ''; return; }
  el.innerHTML = `<span class="tp-ch">CH.${esc(t.chapter)}</span><span class="tp-name">${esc(t.topic)}</span>`;
  el.title = t.keywords ? `이번 주 주제: ${t.topic} (${t.keywords})` : `이번 주 주제: ${t.topic}`;
}

function renderMyroom(){
  loadClassCard();          // ★ V15 수업 출석 카드(회사 기대효과 ②)
  refreshMailBadge();       // ★ V15 우편함 미수령 배지
  const r = state.robot; if(!r) return;
  const g = state.growth || {};
  // ★ P0-2 성장 표시(레벨/단계/스트릭) — "어제보다 나아졌다" 를 child's 눈으로 보이게
  const stageKo = { 1:'아기', 2:'청소년', 3:'성체' }[g.stage||1] || '아기';
  // ★ 부품 보너스 표시: 부품을 산 이유를 수치로 보여준다(내일 다시 켜게 만드는 핵심)
  const bonusLine = g.partBonus ? `<span class="pbonus" title="보유 부품이 오늘 과제 보상을 올려줘요"> 과제 +${esc(g.partBonus)}셀</span>` : '';
  const growthBar = g.level ? `
    <div class="growth">
      <span class="lv">Lv.${esc(g.level)}</span>
      <span class="stage">${esc(stageKo)}</span>
      ${g.streak?`<span class="streak"> ${esc(g.streak)}일 연속</span>`:''}
      ${bonusLine}
      <div class="expbar"><i style="width:${Math.min(100, Math.round((g.exp||0)/(g.expNeeded||100)*100))}%"></i></div>
    </div>` : '';
  // ★ P0-1 구입한 장식은 방에서 보이도록(최소한의 보상 안내)
  const decorLine = state.decors.length
    ? `<div class="owned-decor">보유 장식: ${state.decors.map(d=>esc(d)).join(' · ')}</div>` : '';
  $('#robot-info').innerHTML = `<b>${esc(r.name)}</b> · 성격 <b>${esc(r.personality)}</b><br><span style="color:var(--sub);font-size:13px">"${esc(r.greeting)}"</span>${growthBar}${decorLine}`;
  renderQuests(); setBalance(state.user.cell_balance);
  try{ renderStreakCal(); }catch(e){ console.error('[renderStreakCal]', e); }
  try{ renderTopic(); }catch(e){ console.error('[renderTopic]', e); }
  // 오늘의 진행 단계 표시 — 다른 렌더링이 실패해도 이건 반드시 뜨도록 try 로 감싼다
  try{ renderSteps(); }catch(e){ console.error('[renderSteps]', e); }
  mountRoom3D(r);                 // 3D 우선, 실패 시 SVG 폴백
  bubble(r.greeting);
  setTimeout(()=>{ if(bjs.ready) bubble('드래그로 돌려 보고, 휠로 확대해 보세요'); }, 4600);
}

// ============================================================
// 3D 마이룸 (Babylon.js) — 아이가 칠한 색을 입체 로봇으로 매핑
// ============================================================
let bjs = { engine:null, scene:null, root:null, bob:null, model:null, ready:false, _t:0, wanderTimer:null };
let boosterFlames = null;   // 로켓 부스터 화염 메시(재빌드 때마다 교체됨)

// robotSVG 와 동일한 색 병합 규칙 (2D 미리보기와 3D 가 일치하도록)
// ★ 색칠 스킨: 구매하면 실제 로봇 색이 바뀐다 (V2-2).
//   예전에는 상점에서 파는 스킨이 renderOwned 에서 이름만 출력되고
//   어떤 렌더 경로에도 참여하지 않았다 = 돈을 내도 보이지 않는 구조였다.
//   스킨 = '정해진 팔레트 한 벌'이라 robot.palette 위에 덮어 쓰는 방식으로 구현한다.
//   사용자가 직접 고른 색(바디)을 skin 이 덮어쓰므로, 살 때마다 다른 인상.
const SKIN_PALETTES = {
  '파란 포커 스킨': { body:'#5c86c7', head:'#9fb7d8', antenna:'#ffb020', arms:'#44618f', legs:'#2f4a6b' },
  '핑크 포커 스킨': { body:'#e88fb0', head:'#f7c9d8', antenna:'#ffd54f', arms:'#c96b8c', legs:'#a85170' },
  '민트 포커 스킨': { body:'#5cc9a7', head:'#a8e6d0', antenna:'#ff9f43', arms:'#3d9e80', legs:'#2a7a63' },
  '노랑 포커 스킨': { body:'#f2c94c', head:'#fae08a', antenna:'#eb5757', arms:'#d1a53a', legs:'#a8842b' },
  '보라 포커 스킨': { body:'#9b7fe0', head:'#cbbaf2', antenna:'#56ccf2', arms:'#7a5fc0', legs:'#5d4795' },
};
// 스킨 적용 대상: 사용자가 '팔레트'로 고른 색만 건드린다.
// 고르지 않은 부위(팔/다리/안테나)는 원래 공용 색을 유지한다.
function skinOf(robot){
  if(!robot) return null;
  const list = (state.skins||[]).filter(n=>SKIN_PALETTES[n]);
  if(!list.length) return null;
  return SKIN_PALETTES[list[list.length-1]];   // 최근 구매한 스킨이 우선
}
function effectiveColors(template, palette){
  // ★ V3 수정: PAL_BASE / DEFAULT_PAL 의 두 번째 정의를 제거했다.
  //   파일 상단(L26/L18)이 유일한 진실 공급원이며, 여기에도 동일 내용을
  //   다시 적어 두면 언젠가 한쪽만 고쳐 두 렌더링(2D/3D)이 어긋난다.
  const base = Object.assign({}, DEFAULT_PAL, PAL_BASE[template]||{}, palette||{});
  // 스킨이 있으면 '사용자가 직접 칠한 부위'만 스킨 색으로 덮는다
  const sk = skinOf(state.robot);
  if(sk && palette){
    ['body','head','antenna','arms','legs'].forEach(part=>{
      if(palette[part] && sk[part]) base[part] = sk[part];
    });
  }
  return base;
}

// 상점 부품 → 이름/설명 매핑 (3D 클릭 설명 + 미리보기 설명에 사용)
const PART_INFO = {
  '안테나 리본': { emoji:'', desc:'머리끝에 매달린 분홍 리본. 로봇이 한층 귀여워져요!' },
  '로켓 부스터': { emoji:'', desc:'등 뒤에 달린 추진기! "최고 속도"를 자랑해요.' },
  '나사 장식':   { emoji:'', desc:'몸판에 박힌 은색 나사 4개. 튼튼한 로봇 느낌!' },
  '별 스티커':   { emoji:'', desc:'방을 꾸미는 별 스티커예요 (로봇에 직접 입히진 않아요).' },
  '선물 상자':   { emoji:'', desc:'특별한 선물 상자예요 (장식품).' },
};
const ITEM_EMOJI = {'안테나 리본':'','로켓 부스터':'','나사 장식':'','별 스티커':'','선물 상자':''};

// 미세 입자(점토 질감) 노멀맵 — 씬마다 1장만 만들고 모든 재질이 공유 (순색 플라스틱 느낌 제거)
// 주의: 구/캡슐 메시에 일반 UV 로 붙이면 UV 늘림으로 세로 줄무늬가 생긴다
//       → triplanar(u/v/y 축 3벌)을 씌워 어느 각도에서도 늘림이 없다
function getGrainNormalMap(scene){
  if(scene.__grainTex) return scene.__grainTex;
  const size = 128;
  const dt = new BABYLON.DynamicTexture('grainN', {width:size, height:size}, scene, true);
  const g = dt.getContext();
  const img = g.createImageData(size, size);
  for(let i=0;i<img.data.length;i+=4){
    const v = 128 + Math.floor(Math.random()*18);   // 0.5 부근의 미세 그레인(플랫 노멀맵)
    img.data[i] = img.data[i+1] = img.data[i+2] = v; img.data[i+3] = 255;
  }
  g.putImageData(img,0,0);
  dt.update(false);
  dt.uScale = dt.vScale = 9;                        // 반복
  scene.__grainTex = dt;
  return dt;
}
// 재질 팩토리: PBR(점토 질감 + 클리어코트) 또는 Standard(폴백)
function makeMatFactory(scene, usePBR){
  let n=0;
  return hex=>{
    const col = BABYLON.Color3.FromHexString(hex);
    let m;
    if(usePBR && BABYLON.PBRMaterial){
      m = new BABYLON.PBRMaterial('m'+(++n), scene);
      m.albedoColor = col; m.metallic = 0; m.roughness = 0.72;
      // 색 충정도 유지: 환경광(푸른 하늘빛) 의존을 줄이고 자기발광으로 고유색 보강
      m.emissiveColor = col.scale(0.16); m.environmentIntensity = 0.24;
      const nm = getGrainNormalMap(scene);
      m.bumpTexture = nm; m.bumpTexture.level = 0.06;             // 미세 표면 요철
      m.bumpTexture.coordinatesIndex = 1;                        // triplanar → 구면 늘림 방지
      m.invertNormalMapX = m.invertNormalMapY = false;
      m.clearCoat.isEnabled = true; m.clearCoat.intensity = 0.07; m.clearCoat.roughness = 0.4; // 은은한 니스 질감
    } else {
      m = new BABYLON.StandardMaterial('m'+(++n), scene);
      m.diffuseColor = col; m.specularColor = new BABYLON.Color3(0.08,0.08,0.08);
      m.emissiveColor = col.scale(0.16);
      const nm = getGrainNormalMap(scene);
      m.bumpTexture = nm; m.bumpTexture.level = 0.04;
      m.bumpTexture.coordinatesIndex = 1;
    }
    return m;
  };
}
// Babylon 공식 환경 텍스처 로드 (2.5초 제한, 실패 시 Standard 폴백)
function tryLoadEnvironment(scene){
  return new Promise(res=>{
    let done=false;
    const finish = ok=>{ if(done) return; done=true; window.__envOk=ok; res(ok); };
    const t = setTimeout(()=>finish(false), 2500);
    try{
      const env = BABYLON.CubeTexture.CreateFromPrefilteredData(
        'https://assets.babylonjs.com/environments/environmentSpecular.env', scene);
      if(env.onLoadObservable) env.onLoadObservable.addOnce(()=>{ clearTimeout(t); finish(true); });
      if(env.onErrorObservable) env.onErrorObservable.addOnce(()=>{ clearTimeout(t); finish(false); });
      env.onError = ()=>{ clearTimeout(t); finish(false); };
    }catch(e){ clearTimeout(t); finish(false); }
  });
}
// 카툰 잉크 외곽선 — 박스(각진 면)에만 적용 (구면은 UV 봉합선이 드러나므로 제외)
function applyOutlines(meshes){
  meshes.forEach(m=>{
    m.enableEdgesRendering(0.95);
    m.edgesWidth = 3.0;
    m.edgesColor = new BABYLON.Color4(0.15,0.2,0.3,0.55);
  });
}

// 3D 로봇 본체 생성 (매핑 색 + 귀여운 얼굴)
// 현재 성장 단계(1 아기 / 2 청소년 / 3 성체) — 3D 외형에 반영된다
function curStage(){ return (state.growth && state.growth.stage) || 1; }

function buildRobotModel(scene, parent, c, template, extraParts, matFactory, stage){
  const mat = matFactory || makeMatFactory(scene, false);
  const headMat=mat(c.head), bodyMat=mat(c.body), antMat=mat(c.antenna), armMat=mat(c.arms), legMat=mat(c.legs);
  const eyeMat=mat('#25324a'), cheekMat=mat('#f7b2c1');
  const hiMat=mat('#ffffff'); hiMat.emissiveColor=new BABYLON.Color3(1,1,1); // 눈 하이라이트는 항상 밝게
  const add=(mesh,material)=>{ mesh.material=material; mesh.metadata={robot:true}; mesh.parent=parent; mesh.applyFog=false; return mesh; }; // 안개는 바닥에만 적용(로봇 색 보존)

  // 비율 규격(docs/캐릭터-비율-규격.md): 머리 1.05~1.15W · 팔 .45~.55H
  // 팔 뿌리 x 는 0.50~0.60W(반폭) 안쪽 → 몸에 묻혀야 자연스럽다
  let head, body, frontZ, backZ, fz, armX, armY, armTilt, armLen, bodyRx, bodyRy, bodyCy;
  const outlineMeshes = []; // 잉크 외곽선은 박스에만
  if(template==='doro'){
    // 루미: 캡슐 2단 바디 — 2D 와 같은 "머리가 몸보다 살짝 큰" 큐트 비율
    head = add(BABYLON.MeshBuilder.CreateCapsule('head',{radius:0.54,height:1.15,tessellation:32,capSubdivisions:12},scene), headMat); head.position.y=2.27;
    body = add(BABYLON.MeshBuilder.CreateCapsule('body',{radius:0.5,height:1.2,tessellation:32,capSubdivisions:12},scene), bodyMat); body.position.y=0.95;
    frontZ=0.5; backZ=0.5; fz=0.5;
    armX=0.50; armY=1.00; armTilt=0.22; armLen=0.55;
    bodyRx=0.5; bodyRy=0.6; bodyCy=0.95;
  } else if(template==='boxy'){
    head = add(BABYLON.MeshBuilder.CreateBox('head',{width:1.1,height:1.05,depth:0.95},scene), headMat); head.position.y=2.15;
    body = add(BABYLON.MeshBuilder.CreateBox('body',{width:0.95,height:1.25,depth:0.9},scene), bodyMat); body.position.y=0.95;
    outlineMeshes.push(head, body);
    frontZ=0.45; backZ=0.45; fz=0.43;
    armX=0.52; armY=1.10; armTilt=0.10; armLen=0.66;
    bodyRx=0.475; bodyRy=0.625; bodyCy=0.95;
  } else if(template==='roundy'){
    head = add(BABYLON.MeshBuilder.CreateSphere('head',{diameter:1.20,segments:32},scene), headMat); head.position.y=2.06; head.scaling.y=0.95;
    body = add(BABYLON.MeshBuilder.CreateSphere('body',{diameter:1.15,segments:32},scene), bodyMat); body.position.y=0.92; body.scaling.set(1.05,0.9,1.05);
    frontZ=0.604; backZ=0.604; fz=0.55;
    armX=0.62; armY=1.00; armTilt=0.16; armLen=0.55;
    bodyRx=0.604; bodyRy=0.5175; bodyCy=0.92;
  } else { // tally
    head = add(BABYLON.MeshBuilder.CreateSphere('head',{diameter:1.15,segments:32},scene), headMat); head.position.y=2.3;
    body = add(BABYLON.MeshBuilder.CreateSphere('body',{diameter:0.9,segments:32},scene), bodyMat); body.position.y=0.95; body.scaling.set(1,1.5,1);
    const neck = add(BABYLON.MeshBuilder.CreateCylinder('neck',{height:0.24,diameter:0.24,tessellation:20},scene), legMat); neck.position.y=1.675;
    frontZ=0.45; backZ=0.45; fz=0.48;
    armX=0.50; armY=1.12; armTilt=0.14; armLen=0.72;
    bodyRx=0.45; bodyRy=0.675; bodyCy=0.95;
  }
  const hy = head.position.y;
  // 안테나
  const antRod = add(BABYLON.MeshBuilder.CreateCylinder('ant',{height:0.45,diameterTop:0.045,diameterBottom:0.085,tessellation:20},scene), antMat); antRod.position.y = hy+0.62;
  const antBase = add(BABYLON.MeshBuilder.CreateCylinder('antBase', {height:0.06, diameter:0.15, tessellation:16}, scene), mat(BABYLON.Color3.FromHexString(c.antenna).scale(0.85).toHexString()));
  antBase.position.y = hy + 0.40;
  const glowMat = mat(c.antenna); glowMat.emissiveColor = BABYLON.Color3.FromHexString(c.antenna).scale(0.55); // 에너지 볼 빛
  const antBall = add(BABYLON.MeshBuilder.CreateSphere('antb',{diameter:0.2,segments:20},scene), glowMat); antBall.position.y = hy+0.92;
  // 팔: 몸에 붙은 캡슐 팔 (위쪽이 몸쪽으로 살짝 기울어짐) / boxy 는 어깨 축 바 유지
  if(template==='boxy'){
    const axle = add(BABYLON.MeshBuilder.CreateCylinder('axle',{height:1.45,diameter:0.16,tessellation:20},scene), armMat);
    axle.rotation.z = Math.PI/2; axle.position.set(0,1.55,0);
  }
  // boxy 는 각진 기둥, 나머지는 둥근 캡슐 (몸통 형태와 재질감을 맞춘다)
  const armGeo = template === 'boxy'
    ? n => { const b = BABYLON.MeshBuilder.CreateBox(n, {width:0.22, height:armLen, depth:0.22}, scene); return add(b, armMat); }
    : n => { const c = BABYLON.MeshBuilder.CreateCapsule(n,{radius:0.12,height:armLen,tessellation:24,capSubdivisions:8},scene); return add(c, armMat); };
  const armL = armGeo('armL');
  armL.position.set(-armX,armY,0); armL.rotation.z = -armTilt;
  const armR = armGeo('armR');
  armR.position.set(armX,armY,0); armR.rotation.z = armTilt;
  // 다리: 캡슐 — 2D 의 둥근 다리처럼 지면까지 (별도 발 없음 = 박스+타원 어긋남 제거)
  const legGeo = template === 'boxy'
    ? n => add(BABYLON.MeshBuilder.CreateBox(n, {width:0.20, height:0.34, depth:0.20}, scene), legMat)
    : n => add(BABYLON.MeshBuilder.CreateCapsule(n,{radius:0.13,height:0.34,tessellation:24,capSubdivisions:8},scene), legMat);
  const legL = legGeo('legL'); legL.position.set(-0.27,0.30,0);
  const legR = legGeo('legR'); legR.position.set(0.27,0.30,0);
  // 얼굴: 머리 표면에 "붙인" 렌즈형 부품 — 옆에서 봐도 돌출되지 않게 z 축 납작 + 표면 안쪽 매립
  let surfZ; // 머리 중심 기준 (dx,dy) → 표면 z
  if(template==='boxy'){ surfZ = ()=>0.475; }
  else {
    const hr = template==='roundy' ? 0.60 : template==='tally' ? 0.575 : 0.54; // x/z 반경
    const hyr = template==='roundy' ? 0.570 : hr;                             // y 반경
    surfZ = (dx,dy)=> hr*Math.sqrt(Math.max(0.04, 1-(dx/hr)**2-(dy/hyr)**2));
  }
  const eyeD=0.22, chD=0.18;
  const eZ  = surfZ(0.23, 0.08) - (eyeD*0.35)/2 + 0.02;   // 눈: 납작 렌즈, 0.02 돌출
  const cZ  = surfZ(0.34, -0.06) - (chD*0.4)/2 + 0.016;   // 볼
  const eyeL = add(BABYLON.MeshBuilder.CreateSphere('eyeL',{diameter:eyeD,segments:20},scene), eyeMat);
  eyeL.position.set(-0.23, hy+0.08, eZ); eyeL.scaling.z = 0.35;
  const eyeR = add(BABYLON.MeshBuilder.CreateSphere('eyeR',{diameter:eyeD,segments:20},scene), eyeMat);
  eyeR.position.set(0.23, hy+0.08, eZ); eyeR.scaling.z = 0.35;
  const hiL = add(BABYLON.MeshBuilder.CreateSphere('hiL',{diameter:0.08,segments:10},scene), hiMat);
  hiL.position.set(-0.195, hy+0.135, eZ+0.0365); hiL.scaling.z = 0.15;
  const hiR = add(BABYLON.MeshBuilder.CreateSphere('hiR',{diameter:0.08,segments:10},scene), hiMat);
  hiR.position.set(0.195, hy+0.135, eZ+0.0365); hiR.scaling.z = 0.15;
  const chL  = add(BABYLON.MeshBuilder.CreateSphere('chL',{diameter:chD,segments:16},scene), cheekMat);
  chL.position.set(-0.34, hy-0.06, cZ); chL.scaling.z = 0.4;
  const chR  = add(BABYLON.MeshBuilder.CreateSphere('chR',{diameter:chD,segments:16},scene), cheekMat);
  chR.position.set(0.34, hy-0.06, cZ); chR.scaling.z = 0.4;
  // 미소: 평면 토러스 대신 머리 곡면을 따라가는 튜브 — 옆에서 봐도 돌출 없음
  const sPts = [];
  for(let i=0;i<=12;i++){
    const a = i/6 - 1;                 // -1..1
    const dx = a*0.15;
    const dy = -0.14 + 0.06*a*a;       // 가운데가 아래로 = 웃는 ∜ 곡선
    sPts.push(new BABYLON.Vector3(dx, hy+dy, surfZ(dx,dy)+0.008));
  }
  const smile = BABYLON.MeshBuilder.CreateTube('smile',{path:sPts, radius:0.013, tessellation:12, cap:BABYLON.Mesh.CAP_ALL},scene);
  smile.material = eyeMat; smile.metadata = {robot:true}; smile.parent = parent; smile.applyFog = false;

  // ── 디테일 패스: 목·손·발·귀·눈테두리 ──
  //   네 템플릿이 같은 규칙을 쓰고, 치수만 표에서 가져온다.
  //   (doro 만 적용되던 시절엔 나머지 셋이 '막대 다리'로 남아 완성도가 달라 보였다)
  const mixHex = (hex, k) => BABYLON.Color3.FromHexString(hex).scale(k).toHexString();
  const P = {
    doro:   { neck:{shape:'cyl', h:0.24, top:0.36, bot:0.46, y:1.585}, hand:0.29,
              foot:{shape:'round', d:0.32, x:0.27, y:0.11, z:0.06, heel:0.24, hx:0.27, hz:-0.09},
              ear:{shape:'cyl', d:0.24, x:0.545, y:-0.10}, rim:0.26 },
    roundy: { neck:{shape:'cyl', h:0.20, top:0.30, bot:0.40, y:1.46}, hand:0.28,
              foot:{shape:'round', d:0.30, x:0.30, y:0.105, z:0.05, heel:0.22, hx:0.30, hz:-0.08},
              ear:{shape:'cyl', d:0.22, x:0.575, y:-0.08}, rim:0.26 },
    boxy:   { neck:{shape:'box', w:0.52, h:0.18, d:0.46, y:1.60}, hand:0.28,
              foot:{shape:'box', w:0.36, h:0.15, d:0.48, x:0.28, y:0.075, z:0.06},
              ear:{shape:'box', w:0.07, h:0.26, d:0.26, x:0.575, y:-0.02, dark:true}, rim:0 },
    tally:  { neck:null, hand:0.24,
              foot:{shape:'round', d:0.24, x:0.22, y:0.105, z:0.05, heel:0.18, hx:0.22, hz:-0.07},
              ear:{shape:'cyl', d:0.18, x:0.46, y:-0.10}, rim:0.20 }
  }[template] || null;

  if (P) {
    const neckMat  = mat(mixHex(c.body, 0.80));
    const jointMat = mat(mixHex(c.arms, 0.92));
    const capMat   = mat('#2A3A4B');

    // 목
    if (P.neck) {
      if (P.neck.shape === 'box') {
        const nb = add(BABYLON.MeshBuilder.CreateBox('neck', {width:P.neck.w, height:P.neck.h, depth:P.neck.d}, scene), neckMat);
        nb.position.y = P.neck.y;
      } else {
        const nc = add(BABYLON.MeshBuilder.CreateCylinder('neck', {height:P.neck.h, diameterTop:P.neck.top, diameterBottom:P.neck.bot, tessellation:24}, scene), neckMat);
        nc.position.y = P.neck.y;
      }
    }

    // 손 (팔 끝을 둥글게 마감)
    [-1, 1].forEach(function(side){
      const hand = template === 'boxy'
        ? add(BABYLON.MeshBuilder.CreateBox('hand'+side, {size:P.hand*0.92}, scene), armMat)
        : add(BABYLON.MeshBuilder.CreateSphere('hand'+side, {diameter:P.hand, segments:20}, scene), armMat);
      hand.position.set(side*(armX + Math.sin(armTilt)*(armLen/2)), armY - Math.cos(armTilt)*(armLen/2) - 0.01, 0);
      hand.scaling.set(1, 0.92, 1);
    });

    // 발
    [-1, 1].forEach(function(side){
      if (P.foot.shape === 'box') {
        const fb = add(BABYLON.MeshBuilder.CreateBox('foot'+side, {width:P.foot.w, height:P.foot.h, depth:P.foot.d}, scene), legMat);
        fb.position.set(side*P.foot.x, P.foot.y, P.foot.z);
      } else {
        const foot = add(BABYLON.MeshBuilder.CreateSphere('foot'+side, {diameter:P.foot.d, segments:22}, scene), legMat);
        foot.position.set(side*P.foot.x, P.foot.y, P.foot.z);
        foot.scaling.set(1.0, 0.62, 1.5);
        const heel = add(BABYLON.MeshBuilder.CreateSphere('heel'+side, {diameter:P.foot.heel, segments:16}, scene), legMat);
        heel.position.set(side*P.foot.hx, P.foot.y - 0.005, P.foot.hz);
        heel.scaling.set(0.92, 0.55, 0.9);
      }
    });

    // 귀
    [-1, 1].forEach(function(side){
      const e = P.ear;
      const earMat = e.dark ? neckMat : jointMat;
      if (e.shape === 'box') {
        const eb = add(BABYLON.MeshBuilder.CreateBox('ear'+side, {width:e.w, height:e.h, depth:e.d}, scene), earMat);
        eb.position.set(side*e.x, hy + e.y, 0);
      } else {
        const ear = add(BABYLON.MeshBuilder.CreateCylinder('ear'+side, {height:0.10, diameter:e.d, tessellation:22}, scene), earMat);
        ear.rotation.z = Math.PI/2;
        ear.position.set(side*e.x, hy + e.y, 0);
        const earCap = add(BABYLON.MeshBuilder.CreateCylinder('earCap'+side, {height:0.11, diameter:e.d*0.55, tessellation:18}, scene), capMat);
        earCap.rotation.z = Math.PI/2;
        earCap.position.set(side*(e.x + 0.007), hy + e.y, 0);
      }
    });

    // 눈 테두리 (평면 얼굴인 boxy 는 제외)
    if (P.rim > 0) {
      [-1, 1].forEach(function(side){
        const rim = add(BABYLON.MeshBuilder.CreateTorus('eyeRim'+side, {diameter:P.rim, thickness:0.022, tessellation:22}, scene), capMat);
        rim.rotation.x = Math.PI/2;
        rim.position.set(side*0.23, hy + 0.08, eZ + 0.012);
      });
    }

    // 눈 보조 하이라이트
    [-1, 1].forEach(function(side){
      const h2 = add(BABYLON.MeshBuilder.CreateSphere('hi2'+side, {diameter:0.045, segments:10}, scene), hiMat);
      h2.position.set(side*0.265, hy + 0.035, eZ + 0.04); h2.scaling.z = 0.2;
    });
  }


  // ★ V9 성장 단계 반영 — 아기(1) / 청소년(2) / 성체(3)
  //   라벨만 바뀌고 로봇은 그대로이던 문제를 고친다(회사 기대효과 ① '성장 경험').
  //    주의: model.scaling.y 는 updateIdle 의 '호흡'이 매 프레임 다시 쓴다.
  //     두 곳이 같은 값을 쓰면 반드시 깨진다(root.position.y 에서 겪은 문제).
  //     → 배율 G.s 를 여기서 x/y/z 모두 초기화하고,
  //       updateIdle 은 growthScale 을 곱한 값으로 '호흡만' 더한다(합의된 단일 공식).
  //       y 를 비워 두면 호흡이 한 번 돌기 전까지 세로 성장이 0 이 된다(실측으로 확인).
  const G = { 1:{s:0.86,eye:1.18,ant:0.62}, 2:{s:1.00,eye:1.00,ant:1.00}, 3:{s:1.10,eye:0.92,ant:1.38} }[stage]
         || { s:1, eye:1, ant:1 };
  parent.scaling.x = parent.scaling.y = parent.scaling.z = G.s;
  // 안테나 길이 — 에너지 볼이 로드 끝에 붙어 있도록 함께 이동시킨다
  antRod.scaling.y = G.ant;
  antBall.position.y = hy + 0.62 + 0.225*G.ant + 0.075;
  // 눈 크기(가로만) — 깜빡임은 scaling.y 를 쓰므로 서로 충돌하지 않는다
  eyeL.scaling.x = eyeR.scaling.x = G.eye;

  // 상점에서 구매한 부품 3D 부착 (extraParts 가 있으면 그 부품만, 없으면 보유 부품 전체)
  // 몸통 표면 z — 부품이 몸 크기와 무관하게 항상 표면에 붙도록
  const bodySurfZ = (x,dy)=> template==='boxy' ? 0.45
    : bodyRx*Math.sqrt(Math.max(0.02, 1-(dy/bodyRy)**2-(x/bodyRx)**2));
  attachParts(scene, parent, (extraParts||state.parts),
    { topY: hy+1.02, bodyY: body.position.y, frontZ, backZ, bodyRx, bodyRy, bodyCy, bodySurfZ }, matFactory);
  // 카툰 잉크 외곽선 (박스만)
  applyOutlines(outlineMeshes);
  // 대기 모션용 참조 반환 (마이룸/미리보기 공용)
  return { model: parent, eyeL, eyeR, antBall, mouth: smile,
           armL, armR, baseArmL: -armTilt, baseArmR: armTilt,
           growthScale: G.s,   // 호흡이 scaling.y 에 곱한다(성장 배율 보존)
           antBase: BABYLON.Color3.FromHexString(c.antenna).scale(0.55) };
}

// 디버그 훅: 네 템플릿을 한 장면에서 비교 렌더할 때만 사용 (동작 영향 없음)
window.__buildRobotModel = buildRobotModel;
window.__makeMatFactory = typeof makeMatFactory === "function" ? makeMatFactory : null;

// 대기 모션: 호흡 · 깜빡임 · 안테나 발광 펄스 · 팔 미세 흔들 · 말할 때 입 벌리기
function updateIdle(refs, t, talk){
  if(!refs) return;
  if(refs.model) refs.model.scaling.y = (refs.growthScale||1) * (1 + Math.sin(t*1.6)*0.013);  // 호흡 × 성장배율
  const cycle = 4.2, p = (t % cycle)/cycle;                             // 3~4초 간격 깜빡임
  const blink = p <0.045 ? Math.abs(Math.sin(p/0.045*Math.PI)) : 0;
  const eyeS = 1 - 0.88*blink;
  if(refs.eyeL) refs.eyeL.scaling.y = eyeS;
  if(refs.eyeR) refs.eyeR.scaling.y = eyeS;
  if(refs.antBall && refs.antBall.material)                              // 안테나 에너지 펄스
    refs.antBall.material.emissiveColor = refs.antBase.scale(0.42 + 0.26*Math.sin(t*3));
  if(refs.armL) refs.armL.rotation.z = refs.baseArmL + Math.sin(t*1.1)*0.05;
  if(refs.armR) refs.armR.rotation.z = refs.baseArmR - Math.sin(t*1.1)*0.05;
  if(refs.mouth){ refs.mouth.scaling.y = 1 + talk*0.95; refs.mouth.scaling.x = 1 + talk*0.22; }
  // 추진기 화염 맥동 — 절대 시간 t 기준이라 프레임레이트가 변해도 속도/위상이 동일하다.
  // flames 가 Owned scene 과 다르면(미리보기 등) 건너뛴다 → 다른 장면 메시를 건드려 생기는 흔들림 방지.
  const fl = boosterFlames;
  if(fl && fl.length && fl[0] && !fl[0].isDisposed()){
    // 두 화염에 위상 차를 주어 동시에 켜지지 않게 한다(동기화 깜빡임 방지)
    fl.forEach((f,i)=>{
      if(!f || f.isDisposed()) return;
      const pulse = 0.72 + 0.28*Math.sin(t*7.5 + i*1.9);
      f.scaling.y = pulse;                                // 화염 길이 맥동
      f.scaling.x = f.scaling.z = 0.9 + 0.1*pulse;        // 폭도 미세하게 연동
    });
  }
}

// 상점 부품 → 3D 액세서리 매핑 (안테나 리본 / 로켓 부스터 / 나사 장식)
function attachParts(scene, parent, parts, refs, matFactory){
  boosterFlames = null;   //_parts 없으면 애니메이션 참조가 남지 않도록 먼저 초기화
  if(!parts || !parts.length) return;
  const mkMat = matFactory || (hex=>{ const m=new BABYLON.StandardMaterial('pm'+Math.random().toString(36).slice(2),scene);
    m.diffuseColor=BABYLON.Color3.FromHexString(hex); m.specularColor=new BABYLON.Color3(0.1,0.1,0.1);
    m.emissiveColor=BABYLON.Color3.FromHexString(hex).scale(0.15); return m; });
  // partName 을 metadata 에 태그 → 3D 에서 클릭하면 부품 설명 표시
  const add=(mesh,material,partName)=>{ mesh.material=material; mesh.metadata={robot:true, part:partName||undefined}; mesh.parent=parent; mesh.applyFog=false; return mesh; };
  const has = n => parts.includes(n);
  const fzP = refs.frontZ!=null ? refs.frontZ : 0.525;   // 몸 앞면 z (템플릿별)
  const bzP = refs.backZ!=null ? refs.backZ : 0.525;    // 몸 뒷면 z

  // 안테나 리본: 실크 리본 (접힌 날개 4장 + 가운데 매듭 + 짧은 꼬리 2가닥)
  if(has('안테나 리본')){
    const bowMat = mkMat('#ff5fa2'), knotMat = mkMat('#e64b8d');
    // 좌우 날개: ��접힌 겹겹 2장씩
    [-1,1].forEach(side=>{
      const outer = add(BABYLON.MeshBuilder.CreateSphere('bow'+side,{diameter:0.19,segments:14},scene), bowMat,'안테나 리본');
      outer.position.set(side*0.115, refs.topY, 0);
      outer.scaling.set(1.45,0.8,0.55); outer.rotation.z = side*0.52;
      const inner = add(BABYLON.MeshBuilder.CreateSphere('bowIn'+side,{diameter:0.13,segments:12},scene), knotMat,'안테나 리본');
      inner.position.set(side*0.072, refs.topY-0.022, 0.022);
      inner.scaling.set(1.3,0.62,0.45); inner.rotation.z = side*0.72;
    });
    add(BABYLON.MeshBuilder.CreateSphere('bowKnot',{diameter:0.085,segments:12},scene), knotMat,'안테나 리본')
      .position.set(0, refs.topY-0.012, 0.01);
    // 아래로 늘어진 꼬리 2가닥
    [-1,1].forEach(side=>{
      const tail = add(BABYLON.MeshBuilder.CreateCylinder('bowTail'+side,{height:0.13,diameterTop:0.05,diameterBottom:0.085,tessellation:10},scene), bowMat,'안테나 리본');
      tail.position.set(side*0.045, refs.topY-0.085, 0.01);
      tail.rotation.z = side*0.42;
    });
  }
  // 로켓 부스터: 등 뒤 추진기 2개 (몸 실루엣 안쪽 · 표면 z 정확 계산)
  // 로켓 부스터: 등 뒤 추진기 2개 (몸 실루엣 안쪽 · 표면 z 정확 계산)
  // 이전 버그: bx = bodyRx + 0.14 로 두어 팔(x≈0.6)과 거의 같은 선 → 항상 충돌.
  //           또한 |x| 가 bodyRx 에 가까우면 구면 z 가 0 으로 수렴해 옆면에 붙어버림.
  // 수정: 추진기는 배면(x 가 몸 반폭 이내)에 두고, 해당 x 의 실제 표면 z 에 밀착.
  if(has('로켓 부스터')){
    const rMat = mkMat('#e05a3a'), darkMat = mkMat('#8a3a22'), tipMat = mkMat('#ffd54f');
    const bRx = refs.bodyRx || 0.5, bRy = refs.bodyRy || 0.55, bCy = refs.bodyCy != null ? refs.bodyCy : 1.0;
    const bSurf = refs.bodySurfZ || ((x,dy)=> Math.sqrt(Math.max(0.02, bRx*bRx*(1-(dy/bRy)**2) - x*x )));
    // 팔 반경(0.12) 을 피해 몸 안쪽으로 — 팔 축보다 확실히 안쪽
    const bx = Math.max(0.12, bRx*0.5);
    const dy = bRy*0.12;                                  // 몸 중심보다 약간 위
    const surfZ = bSurf(bx, dy);                          // 이 x 에서 몸 표면 z
    const bz = -(surfZ + 0.03);                           // 표면 바로 뒤에 밀착
    const yc = bCy + dy;                                   // 추진기 축 높이
    const flames = [];
    [-bx,bx].forEach((x,side)=>{
      // 본체(위쪽 둥근 통)
      const th = add(BABYLON.MeshBuilder.CreateCylinder('boost'+side,{height:0.34,diameter:0.19,tessellation:20},scene), rMat,'로켓 부스터');
      th.position.set(x, yc+0.12, bz);
      // 강화환(본체 아래)
      const ring = add(BABYLON.MeshBuilder.CreateTorus('boostRing'+side,{diameter:0.22,thickness:0.04,tessellation:18},scene), darkMat,'로켓 부스터');
      ring.position.set(x, yc-0.04, bz); ring.rotation.x = Math.PI/2;
      // 노즐(아래쪽 넓어지는 깔때기)
      const tip = add(BABYLON.MeshBuilder.CreateCylinder('boostTip'+side,{height:0.14,diameterTop:0.19,diameterBottom:0.09,tessellation:20},scene), darkMat,'로켓 부스터');
      tip.position.set(x, yc-0.13, bz);
      // 화염(노즐 아래 발광)
      const flame = add(BABYLON.MeshBuilder.CreateCylinder('boostFlame'+side,{height:0.1,diameterTop:0.02,diameterBottom:0.1,tessellation:16},scene), tipMat,'로켓 부스터');
      flame.position.set(x, yc-0.24, bz);
      flames.push(flame);
      // 몸쪽 연결 브래킷(표면과 추진기 사이를 가로로 잇는 어깨)
      const armLen = Math.max(0.08, bx*0.9);
      const arm = add(BABYLON.MeshBuilder.CreateBox('boostArm'+side,{width:armLen,height:0.08,depth:0.1},scene), darkMat,'로켓 부스터');
      arm.position.set(x - Math.sign(x)*armLen*0.5, yc+0.12, bz);
    });
    // 화염은 매 프레임 갱신(updateBoosterFlame)
    boosterFlames = flames;
  }
  // 나사 장식: 몸 패널 나사 4개 (몸 표면 위, 몸 크기 비례, 십자 홈 표현)
  if(has('나사 장식')){
    const sMat = mkMat('#cfd8e3'), slotMat = mkMat('#8a95a5');
    const bRx = refs.bodyRx || 0.5, bRy = refs.bodyRy || 0.55, bCy = refs.bodyCy != null ? refs.bodyCy : 1.0;
    const bSurf = refs.bodySurfZ || ((x,dy)=> Math.sqrt(Math.max(0.02, bRx*bRx*(1-(dy/bRy)**2) - x*x )));
    [[-0.55,0.3],[0.55,0.3],[-0.55,-0.28],[0.55,-0.28]].forEach(([fx,fy],i)=>{
      const x = fx*bRx, dy = fy*bRy;
      const z = bSurf(x,dy)+0.012;
      // 머리(살짝 돌출) + 십자 홈 2줄
      // 주의: Babylon 옵션 키는 diameterTop/diameterBottom 이다 (topDiameter 는 무시되어 기본값 1.0 이 됨)
      const head = add(BABYLON.MeshBuilder.CreateCylinder('screw'+i,{height:0.05,diameterTop:0.082,diameterBottom:0.105,tessellation:16},scene), sMat,'나사 장식');
      head.position.set(x, bCy+dy, z); head.rotation.x = Math.PI/2;
      const slotA = add(BABYLON.MeshBuilder.CreateBox('screwSlotA'+i,{width:0.078,height:0.014,depth:0.016},scene), slotMat,'나사 장식');
      slotA.position.set(x, bCy+dy, z+0.03);
      const slotB = add(BABYLON.MeshBuilder.CreateBox('screwSlotB'+i,{width:0.014,height:0.078,depth:0.016},scene), slotMat,'나사 장식');
      slotB.position.set(x, bCy+dy, z+0.03);
    });
  }
  // 별 스티커: 발광 5각 별(테두리 5개 조합) + 작은 위성 별 2개 (공중 부유)
  if(has('별 스티커')){
    const starMat = mkMat('#ffd54f'); starMat.emissiveColor = BABYLON.Color3.FromHexString('#ffd54f').scale(0.5);
    // 다면체(3D) 는 정면이 어둡고 옆면만 보여 단독 전시에 부적합 →
    // 테두리 실린더 5개로 5각 별 모양을 구성(earcut 없이 오려낸 효과)
    const makeStar = (name, cx, cy, cz, R, thick, fill)=>{
      // 꼭짓점 5개(중심에서 R, 각도 -90°부터 72° 간격)
      const P = [];
      for(let i=0;i<5;i++){ const a = -Math.PI/2 + i*Math.PI*2/5; P.push(new BABYLON.Vector3(cx+Math.cos(a)*R, cy+Math.sin(a)*R, cz)); }
      const lay = (a,b,dn,dv)=>{
        const len = BABYLON.Vector3.Distance(a,b);
        const bar = add(BABYLON.MeshBuilder.CreateCylinder(name+'_'+dn,{height:len, diameter:dv, tessellation:8},scene), starMat,'별 스티커');
        bar.position = BABYLON.Vector3.Center(a,b);
        const dir = b.subtract(a).normalize();
        const axis = BABYLON.Vector3.Cross(BABYLON.Axis.Y, dir);
        const ang = Math.acos(Math.max(-1, Math.min(1, BABYLON.Vector3.Dot(BABYLON.Axis.Y, dir))));
        bar.rotationQuaternion = axis.length()<0.001 ? BABYLON.Quaternion.Identity()
          : BABYLON.Quaternion.RotationAxis(axis.normalize(), ang);
      };
      for(let i=0;i<5;i++) lay(P[i], P[(i+1)%5], 'b'+i, thick);
      if(fill){                                   // 내부가 비어 보이면 방사형+중앙 원판으로 채운다
        const C=new BABYLON.Vector3(cx,cy,cz);
        for(let i=0;i<5;i++) lay(C, P[i], 's'+i, thick*2.1);
        const core=add(BABYLON.MeshBuilder.CreateSphere(name+'_core',{diameter:R*0.85,segments:12},scene), starMat,'별 스티커');
        core.position.set(cx,cy,cz); core.scaling.z=0.42;
      }
    };
    makeStar('star', 1.02, 1.95, 0.1, 0.2, 0.05, true);
    // 반사광(십자 광선)
    [[0,0.46],[1,0.28]].forEach(([ri,len])=>{
      const ray = add(BABYLON.MeshBuilder.CreateBox('starRay'+ri,{width:0.016,height:len,depth:0.012},scene), starMat,'별 스티커');
      ray.position.set(1.02, 1.95, 0.06); ray.rotation.z = ri? Math.PI/4 : 0;
      const ray2 = add(BABYLON.MeshBuilder.CreateBox('starRay2_'+ri,{width:len,height:0.016,depth:0.012},scene), starMat,'별 스티커');
      ray2.position.set(1.02, 1.95, 0.06); ray2.rotation.z = ri? Math.PI/4 : 0;
    });
    // 작은 위성 별
    makeStar('starS0', 0.78, 2.32, 0.24, 0.075, 0.028);
    makeStar('starS1', 1.3, 1.6, 0.16, 0.05, 0.022);
  }
  // 선물 상자: 종이 상자 + 크로스 리본 + 리본 매듭 + 뚜껑 경계선
  if(has('선물 상자')){
    const boxMat = mkMat('#e05a5a'), ribMat = mkMat('#ffd54f'), edgeMat = mkMat('#b84646');
    const gx=0.92, gy=0.17, gz=0.55;
    const gift = add(BABYLON.MeshBuilder.CreateBox('gift',{width:0.44,height:0.34,depth:0.44},scene), boxMat,'선물 상자');
    gift.position.set(gx,gy,gz);
    // 뚜껑 분할선
    const lid = add(BABYLON.MeshBuilder.CreateBox('giftLid',{width:0.46,height:0.05,depth:0.46},scene), edgeMat,'선물 상자');
    lid.position.set(gx, gy+0.19, gz);
    // 크로스 리본 2줄
    const rib1 = add(BABYLON.MeshBuilder.CreateBox('rib1',{width:0.11,height:0.4,depth:0.46},scene), ribMat,'선물 상자');
    rib1.position.set(gx, gy, gz);
    const rib2 = add(BABYLON.MeshBuilder.CreateBox('rib2',{width:0.46,height:0.4,depth:0.11},scene), ribMat,'선물 상자');
    rib2.position.set(gx, gy, gz);
    // 매듭 + 2갈래 노리
    const knot = add(BABYLON.MeshBuilder.CreateSphere('giftKnot',{diameter:0.13,segments:12},scene), ribMat,'선물 상자');
    knot.position.set(gx, gy+0.24, gz); knot.scaling.y = 0.8;
    [[-1,0.5],[1,-0.5]].forEach(([s,r],i)=>{
      const loop = add(BABYLON.MeshBuilder.CreateTorus('giftLoop'+i,{diameter:0.17,thickness:0.05,tessellation:14},scene), ribMat,'선물 상자');
      loop.position.set(gx + s*0.1, gy+0.26, gz);
      loop.rotation.set(Math.PI/2, 0, r);
    });
  }
}

// 점프 애니메이션
// 점프 애니메이션
// ★ 수정: 예전에 root.position.y 를 애니메이션했다. 그런데 root.position.y 는
//   updateWalk 가 매 프레임 직접 대입하는 값이라 서로 덮어써서
  //   몸통과 입이 서로 다른 높이에 있는 깨짐이 생겼다.
//   root 는 '걸어다니는 위치' 전용으로 두고, 점프는 그 아래 bob 에 건다.
//   root 의 y 를 건드리지 않으므로 이동과 점프가 완전히 독립된다.
function jumpRobot(){
  if(!bjs.ready || !bjs.root || !bjs.bob) return;
  const bob = bjs.bob, fps=30, f=24;
  const y0 = bob.position.y || 0;
  const a=new BABYLON.Animation('jump','position.y',fps,BABYLON.Animation.ANIMATIONTYPE_FLOAT,BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
  a.setKeys([{frame:0,value:y0},{frame:7,value:y0+0.5},{frame:14,value:y0},{frame:24,value:y0}]);
  // stopAnimation 을 먼저 호출해 앞선 점프 애니메이션이 겹치지 않게 한다
  // V3 수정: 예전에 `bob.animation && bob.animation.stop()` 였는데
  //   TransformNode 에는 .animation 속성이 없어서(Animator 가 아니라) 항상 undefined →
  //   연속 점프 시 애니메이션이 쌓이는 것을 막지 못했다.
  //   정석 API 인 scene.stopAnimation(노드) 을 쓴다.
  try{ bjs.scene.stopAnimation(bob); }catch(e){}
  bjs._jumping = true;            // 렌더 루프가 숨 흔들림을 멈추도록 플래그
  bjs.scene.beginDirectAnimation(bob,[a],0,f,false,()=>{ bjs._jumping = false; });
}

// 로봇 클릭 → 말하기 + 점프 (입 벌림 애니메이션 포함)
  function talkToRobot(robot){
  bjs.talkUntil = Date.now() + 1100;
  walkTo([0, -0.2], 0.55);      // 대화하러 카메라 앞으로 이동
  bubble(robot.greeting); jumpRobot();
  }

  // ── 3Dsimple 이동 (격자 탐색 + 부드러운 회전) ──
  // 방 안을 몇 걸음 걸어다니는 로봇 = '살아 있는' 느낌의 핵심.
  // 단순히 좌표를 lerp 하지 않고, '목표 지점 → 회전 → 보행' 3단으로 처리한다.
  // 방 크기는 createRoomBase 의 HW=5.6, HD=5.0 과 맞춘다(소품과 겹치지 않게 약간 안쪽).
  // ★ V17 산책 범위 축소: 예전엔 ±3.6 까지 걸어가 카메라 프레임 밖으로 나갔다.
  //   이제 러그 주변(±1.3)만 돌아다녀 "방 한가운데 사는 로봇" 느낌을 유지한다.
  const WALK = { X:1.3, ZB:-0.7, ZF:0.9, SPEED:1.15, TURN:6.5 };
  let _walk = { active:false, tx:0, tz:0, face:0, timer:0, walking:false };
  // 목표 지점으로 걷기(faceR: 도착 후 바라볼 각도, null 이면 현재 방향 유지)
  function walkTo(p, faceR){
    if(!bjs.ready || !bjs.root) return;
    _walk.tx = Math.max(-WALK.X, Math.min(WALK.X, p[0]));
    _walk.tz = Math.max(WALK.ZB, Math.min(WALK.ZF, p[1]));
    _walk.face = (faceR==null) ? _walk.face : faceR;
    _walk.active = true; _walk.walking = true;
    clearTimeout(_walk.timer);
    // 12초 안에 못 가면 그만 둔다(전봇줄처럼 영원히 걷는 것 방지)
    _walk.timer = setTimeout(()=>{ _walk.active=false; _walk.walking=false; }, 12000);
  }
  // 대기 중 랜덤 산책(아이가 지켜볼 만한 장면)
  function idleWander(){
    if(!bjs.ready) return;
    const x = (Math.random()*2-1) * WALK.X;
    const z = WALK.ZB + Math.random()*(WALK.ZF - WALK.ZB);
    // ★ V17 도착 시 70% 확률로 카메라(+z)를 바라본다 → 화면에 얼굴이 보이는 시간이 길어진다.
    walkTo([x, z], Math.random() <0.7 ? 0 : Math.PI*0.5*(Math.random()<0.5?-1:1));
  }
  // 매 프레임 호출: 이동/회전 보간
  function updateWalk(dt){
    if(!bjs.ready || !bjs.root) return;
    const r = bjs.root;
    // 1) 도착까지 이동
    if(_walk.active){
      const dx = _walk.tx - r.position.x, dz = _walk.tz - r.position.z;
      const dist = Math.hypot(dx, dz);
      if(dist <0.08){
        _walk.active = false; _walk.walking = false;
        // 도착 후엔 바라보는 각도만 살짝 맞는다
        if(_walk.face) r.rotation.y = _walk.face;
      }else{
        const step = Math.min(dist, WALK.SPEED * dt);
        r.position.x += dx/dist*step;
        r.position.z += dz/dist*step;
        // 이동 방향을 향해 자연스럽게 회전
        const want = Math.atan2(dx, dz);
        r.rotation.y = angleLerp(r.rotation.y, want, 1 - Math.exp(-WALK.TURN*dt));
      }
    }
    // 2) 걸을 때 살짝 통통 튀기 + 몸 흔들림
    if(_walk.walking){
      r.position.y = Math.abs(Math.sin(bjs._t*9)) * 0.055;
      bjs.bob.rotation.z = Math.sin(bjs._t*9) * 0.03;
    }else{
      r.position.y = 0;
      bjs.bob.rotation.z *= 0.9;
    }
  }
  // 각도 보간(최단 경로로 회전)
  function angleLerp(cur, want, k){
    let d = want - cur;
    while(d>  Math.PI) d -= Math.PI*2;
    while(d <-Math.PI) d += Math.PI*2;
    return cur + d*k;
  }

function rebuildRobot(robot){
  if(!bjs.model || !bjs.scene) return;
  boosterFlames = null;   // 아래에서 dispose 되므로 참조를 먼저 끊는다(잔여 참조 방지)
  bjs.model.getChildMeshes(false).forEach(m=>{ if(m.material) m.material.dispose(); m.dispose(); });
  bjs.refs = buildRobotModel(bjs.scene, bjs.model, effectiveColors(robot.template, robot.palette), robot.template, null, bjs.matFactory, curStage());
  if(bjs.scene.__shadow) bjs.scene.__shadow.getShadowMap().renderList = bjs.model.getChildMeshes(false);
}

// ★ 장식 구매 후 방을 다시 만든다.
//   방 소품(장식)은 createRoomBase 안에서 만들어지므로, 이미 만들어진 씬에서는
//   로봇만 갱신(rebuildRobot)해서는 반영되지 않는다. 여기서는 장식 mesh 를
//   지운 뒤 buildOwnedDecors 로 다시 만든다(엔진/씬/바닥 재사용 → 저비용).
let _roomGen = 0;
function rebuildRoomDecor(){
  const scene = bjs.scene;
  if(!scene) return;
  _roomGen++;
  // 1) 이전 장식 제거(이름은 buildOwnedDecors 가 붙이는 접두사로 식별)
  scene.meshes.slice().forEach(m=>{
    if(/^dsBar|^dsRay|^dsTape|^giftBox|^giftLid|^giftRib|^giftKnot|^giftLoop/.test(m.name)) m.dispose();
  });
  // 2) 같은 재질(M) 재사용으로 다시 배치. M 은 createRoomBase 가 씬에 캐시해 둔다.
  if(!scene.__propM){ console.warn('[rebuildRoomDecor] 재질 캐시 없음 — 장식 재배치 생략'); return; }
  try{
    const placed = buildOwnedDecors(scene, scene.__propM, state.decors||[]);
    scene.__placedDecors = placed;
  }catch(e){ console.error('[rebuildRoomDecor]', e); }
}

// ---------- 방 텍스처(장면 단위 캐시: 같은 장면에서 한 번만 생성) ----------
// 마루 바닥: 판 이음새 + 나뭇결
function texWood(scene){
  if(scene.__woodTex) return scene.__woodTex;
  const S=512, dt=new BABYLON.DynamicTexture('woodT',{width:S,height:S},scene,true);
  const g=dt.getContext();
  g.fillStyle='#efe2cc'; g.fillRect(0,0,S,S);
  const rows=7, ph=S/rows;
  for(let i=0;i<rows;i++){
    const y=i*ph, t=234+Math.floor(Math.random()*12);
    g.fillStyle='rgb('+(t+10)+','+(t+2)+','+(t-14)+')';
    g.fillRect(0,y,S,ph-2);
    g.strokeStyle='rgba(168,146,116,0.22)'; g.lineWidth=1.2;   // 나뭇결
    for(let k=0;k<4;k++){
      const yy=y+6+k*(ph-12)/4;
      g.beginPath(); g.moveTo(0,yy);
      for(let x=0;x<=S;x+=32) g.lineTo(x, yy+Math.sin(x/70+i*2.1+k)*1.7);
      g.stroke();
    }
    g.fillStyle='rgba(150,128,100,0.30)'; g.fillRect(0,y+ph-2,S,2);   // 판 이음새
  }
  dt.update(false); dt.uScale=dt.vScale=5;
  scene.__woodTex=dt; return dt;
}
// 둥근 모서리 러그: 테두리 + 안쪽 + 마름모 문양(alpha 포함 → 네 모서리 투명)
function texRug(scene){
  if(scene.__rugTex) return scene.__rugTex;
  const S=512, dt=new BABYLON.DynamicTexture('rugT',{width:S,height:S},scene,true);
  const g=dt.getContext();
  const rr=(x,y,w,h,r)=>{ g.beginPath(); g.moveTo(x+r,y);
    g.arcTo(x+w,y,x+w,y+h,r); g.arcTo(x+w,y+h,x,y+h,r); g.arcTo(x,y+h,x,y,r); g.arcTo(x,y,x+w,y,r); g.closePath(); };
  g.clearRect(0,0,S,S);
  rr(8,8,S-16,S-16,60); g.fillStyle='#f7c8a4'; g.fill();
  rr(30,30,S-60,S-60,48); g.fillStyle='#ffe6d2'; g.fill();
  rr(58,58,S-116,S-116,40); g.fillStyle='#a8dced'; g.fill();
  g.fillStyle='rgba(255,255,255,0.75)';                              // 중앙 마름모
  g.beginPath(); g.moveTo(S/2,96); g.lineTo(S-96,S/2); g.lineTo(S/2,S-96); g.lineTo(96,S/2); g.closePath(); g.fill();
  g.strokeStyle='rgba(255,255,255,0.55)'; g.lineWidth=5;
  for(let i=0;i<3;i++){ rr(80+i*14,80+i*14,S-160-i*28,S-160-i*28,34); g.stroke(); }
  dt.update(false); dt.hasAlpha=true;
  scene.__rugTex=dt; return dt;
}
// 창밖 풍경: 하늘 그라디언트 + 구름 + 먼 산
function texSky(scene){
  if(scene.__skyTex) return scene.__skyTex;
  const W=512,H=384, dt=new BABYLON.DynamicTexture('skyT',{width:W,height:H},scene,true);
  const g=dt.getContext();
  const gr=g.createLinearGradient(0,0,0,H);
  gr.addColorStop(0,'#a9d6ff'); gr.addColorStop(0.55,'#dcefff'); gr.addColorStop(1,'#fbfdff');
  g.fillStyle=gr; g.fillRect(0,0,W,H);
  g.fillStyle='rgba(255,255,255,0.92)';
  [[110,86,44],[196,64,34],[338,104,40],[428,74,28]].forEach(function(c){
    g.beginPath(); g.arc(c[0],c[1],c[2],0,Math.PI*2);
    g.arc(c[0]+c[2]*0.85,c[1]+7,c[2]*0.68,0,Math.PI*2);
    g.arc(c[0]-c[2]*0.85,c[1]+9,c[2]*0.62,0,Math.PI*2); g.fill();
  });
  g.fillStyle='#cbe4bd'; g.beginPath(); g.moveTo(0,H);
  g.quadraticCurveTo(W*0.26,H-74,W*0.52,H-42); g.quadraticCurveTo(W*0.76,H-84,W,H-52); g.lineTo(W,H); g.closePath(); g.fill();
  g.fillStyle='#b3d9a2'; g.beginPath(); g.moveTo(0,H);
  g.quadraticCurveTo(W*0.42,H-52,W*0.76,H-30); g.quadraticCurveTo(W*0.9,H-24,W,H-28); g.lineTo(W,H); g.closePath(); g.fill();
  dt.update(false);
  scene.__skyTex=dt; return dt;
}
// 접촉 그림자 blob: 소품이 바닥에 밀착된 무게감 표현
function texBlob(scene){
  if(scene.__blobTex) return scene.__blobTex;
  const S=128, dt=new BABYLON.DynamicTexture('blobT',{width:S,height:S},scene,true);
  const g=dt.getContext();
  g.clearRect(0,0,S,S);
  const gr=g.createRadialGradient(S/2,S/2,2,S/2,S/2,S/2);
  gr.addColorStop(0,'rgba(46,56,78,0.60)'); gr.addColorStop(0.62,'rgba(46,56,78,0.22)'); gr.addColorStop(1,'rgba(46,56,78,0)');
  g.fillStyle=gr; g.beginPath(); g.arc(S/2,S/2,S/2,0,Math.PI*2); g.fill();
  dt.update(false); dt.hasAlpha=true;
  scene.__blobTex=dt; return dt;
}

// 소품 전용 무조명 재질(가벼움, PBR 미사용)
function propMat(scene, name, hex, glow){
  const m=new BABYLON.StandardMaterial(name, scene);
  const c=BABYLON.Color3.FromHexString(hex);
  m.diffuseColor=c; m.specularColor=new BABYLON.Color3(0.05,0.05,0.05);
  m.emissiveColor=c.scale(glow||0.12);
  m.backFaceCulling=false;
  return m;
}
// 부드러운 접촉 그림자(그림자 맵 대신 가벼운 blob 으로 접지감 표현)
function addBlobShadow(scene, x, z, r, alpha){
  const m=new BABYLON.StandardMaterial('bsm'+r+'_'+x, scene);
  m.diffuseTexture=texBlob(scene); m.diffuseTexture.hasAlpha=true;
  m.useAlphaFromDiffuseTexture=true; m.diffuseColor=new BABYLON.Color3(0,0,0);
  m.emissiveColor=new BABYLON.Color3(0,0,0); m.specularColor=new BABYLON.Color3(0,0,0);
  m.disableLighting=true; m.alpha=(alpha==null?0.55:alpha); m.backFaceCulling=false;
  const d=BABYLON.MeshBuilder.CreateDisc('blob',{radius:r,tessellation:28},scene);
  d.rotation.x=Math.PI/2; d.position.set(x,0.008,z);
  d.material=m; d.isPickable=false; d.receiveShadows=false;
  return d;
}
// 창빛 속 부유 먼지 — 방에 공기감 부여
function addDustMotes(scene){
  const S=16, dt=new BABYLON.DynamicTexture('dustT',{width:S,height:S},scene,true);
  const g=dt.getContext(); g.clearRect(0,0,S,S);
  const gr=g.createRadialGradient(8,8,0,8,8,8);
  gr.addColorStop(0,'rgba(255,255,255,0.95)'); gr.addColorStop(1,'rgba(255,255,255,0)');
  g.fillStyle=gr; g.fillRect(0,0,S,S); dt.update(false); dt.hasAlpha=true;
  const ps=new BABYLON.ParticleSystem('dust',70,scene);
  ps.particleTexture=dt;
  ps.emitter=new BABYLON.Vector3(-2.6,2.0,-3.2);
  ps.minEmitBox=new BABYLON.Vector3(-0.5,-1.5,-0.6);
  ps.maxEmitBox=new BABYLON.Vector3(0.5,1.5,0.6);
  ps.color1=new BABYLON.Color4(1,1,0.97,0.5);
  ps.color2=new BABYLON.Color4(0.92,0.97,1,0.34);
  ps.colorDead=new BABYLON.Color4(1,1,1,0);
  ps.minSize=0.018; ps.maxSize=0.05;
  ps.minLifeTime=4; ps.maxLifeTime=8; ps.emitRate=10;
  ps.blendMode=BABYLON.ParticleSystem.BLENDMODE_ADD;
  ps.direction1=new BABYLON.Vector3(-0.06,-0.03,0.06);
  ps.direction2=new BABYLON.Vector3(0.06,0.05,0.1);
  ps.minEmitPower=0.02; ps.maxEmitPower=0.09;
  ps.gravity=new BABYLON.Vector3(0,-0.012,0);
  ps.start();
}
// 실내 소품: 책장 / 화분 / 스탠드 조명 / 액자 / 벽시계 / 삼각 플래그 / 블록
function buildRoomProps(scene, M){
  const box=function(n,w,h,d,x,y,z,m){ const b=BABYLON.MeshBuilder.CreateBox(n,{width:w,height:h,depth:d},scene);
    b.position.set(x,y,z); b.material=m; b.isPickable=false; b.receiveShadows=true; return b; };
  const cyl=function(n,o,x,y,z,m){ const c=BABYLON.MeshBuilder.CreateCylinder(n,o,scene);
    c.position.set(x,y,z); c.material=m; c.isPickable=false; c.receiveShadows=true; return c; };

  // ── 책장(오른쪽) ──
  const sx=4.35, sz=-4.2;
  box('shBack',2.3,1.55,0.12, sx,0.78,sz-0.24, M.woodDark);
  box('shL',0.12,1.55,0.55, sx-1.09,0.78,sz, M.woodDark);
  box('shR',0.12,1.55,0.55, sx+1.09,0.78,sz, M.woodDark);
  box('shTop',2.3,0.1,0.55, sx,1.53,sz, M.wood);
  box('shMid',2.16,0.08,0.52, sx,0.82,sz, M.wood);
  box('shBot',2.16,0.1,0.52, sx,0.06,sz, M.wood);
  [[0,0.34,0.42],[1,0.26,0.34],[2,0.40,0.36],[3,0.30,0.44]].forEach(function(row){
    for(let i=0;i<4;i++){
      const h=row[1]*(0.82+((i+row[0])%3)*0.09);
      box('bk'+row[0]+'_'+i, row[1]*0.8, h, row[2], sx-0.86+i*0.34, (row[0]?0.87:0.11)+h/2, sz+0.03, M.book[(i+row[0])%M.book.length]);
    }
  });
  addBlobShadow(scene, sx, sz+0.05, 1.35, 0.5);

  // ── 화분(왼쪽) ──
  const px=-2.35, pz=-3.85;
  cyl('pot',{height:0.44,diameterTop:0.54,diameterBottom:0.38,tessellation:20}, px,0.22,pz, M.pot);
  cyl('potRim',{height:0.07,diameter:0.58,tessellation:20}, px,0.44,pz, M.potRim);
  cyl('stem',{height:0.62,diameter:0.055,tessellation:10}, px,0.75,pz, M.stem);
  [[0,0.95,0.06],[0.2,0.80,-0.10],[-0.19,0.72,0.12],[0.05,1.18,0.14]].forEach(function(L,i){
    const l=BABYLON.MeshBuilder.CreateSphere('leaf'+i,{diameter:0.34,segments:12},scene);
    l.position.set(px+L[0], L[1], pz+L[2]); l.scaling.set(1,0.22,0.66);
    l.rotation.set(0.5*L[2]+0.3, i*0.9, -0.5*L[0]+0.4);
    l.material=M.leaf[i%2]; l.isPickable=false;
  });
  addBlobShadow(scene, px, pz, 0.5, 0.5);

  // ── 스탠드 조명(오른쪽 앞) ──
  const lx=4.45, lz=-3.15;
  cyl('lampBase',{height:0.07,diameterTop:0.62,diameterBottom:0.7,tessellation:20}, lx,0.035,lz, M.metal);
  cyl('lampPole',{height:1.72,diameter:0.075,tessellation:12}, lx,0.9,lz, M.metal);
  const shade=BABYLON.MeshBuilder.CreateCylinder('lampShade',{height:0.46,diameterTop:0.34,diameterBottom:0.78,tessellation:22},scene);
  shade.position.set(lx,1.93,lz); shade.material=M.shade; shade.isPickable=false;
  cyl('lampGlow',{height:0.05,diameter:0.5,tessellation:18}, lx,1.72,lz, M.bulb);
  addBlobShadow(scene, lx, lz, 0.5, 0.5);

  // ── 벽 액자 2개 ──
  [[3.35,2.30,0.82,0.64,0],[1.35,2.62,0.7,0.8,1]].forEach(function(f){
    box('fr'+f[4], f[2]+0.12, f[3]+0.12, 0.07, f[0], f[1], -4.93, M.frame);
    box('frC'+f[4], f[2], f[3], 0.05, f[0], f[1], -4.88, M.frameCol[f[4]]);
    const s=BABYLON.MeshBuilder.CreateSphere('frS'+f[4],{diameter:0.2,segments:10},scene);
    s.position.set(f[0]-0.02, f[1]+0.02, -4.83); s.scaling.set(1,1,0.35);
    s.material=M.sticker; s.isPickable=false;
  });

  // ── 벽시계 ──
  const ck=BABYLON.MeshBuilder.CreateCylinder('clock',{height:0.08,diameter:0.72,tessellation:26},scene);
  ck.rotation.x=Math.PI/2; ck.position.set(2.55,2.72,-4.92); ck.material=M.frame; ck.isPickable=false;
  const cf=BABYLON.MeshBuilder.CreateCylinder('clockFace',{height:0.09,diameter:0.6,tessellation:26},scene);
  cf.rotation.x=Math.PI/2; cf.position.set(2.55,2.72,-4.86); cf.material=M.clockFace; cf.isPickable=false;
  const ch1=box('clockH1',0.045,0.2,0.03, 2.55,2.81,-4.81, M.metalDark); ch1.rotation.z=0.5;
  const ch2=box('clockH2',0.04,0.26,0.03, 2.61,2.70,-4.81, M.metalDark); ch2.rotation.z=-0.7;

  // ── 삼각 플래그(빵빵이) ──
  box('cord',10.8,0.035,0.035, 0,2.95,-4.85, M.cord);
  for(let i=0;i<9;i++){
    const t=i/8, sag=Math.sin(t*Math.PI)*0.34;   //  깃줄은 중앙이 자연스럽게 처짐
    const f=BABYLON.MeshBuilder.CreateDisc('flag'+i,{radius:0.19,tessellation:3},scene);
    f.position.set(-4.9+t*9.8, 2.95-sag-0.2, -4.83); f.rotation.z=Math.PI;
    f.material=M.flag[i%5]; f.isPickable=false;
  }

  // ── 장난감 블록(책장 아래 작은 탑) ──
  const blocks=[[2.02,0.085,-3.45,0.17,0],[2.24,0.075,-3.40,0.15,1],[2.04,0.25,-3.45,0.14,2]];
  blocks.forEach(function(b){
    const o=box('blk'+b[4], b[3],b[3],b[3], b[0],b[1],b[2], M.block[b[4]]);
    o.rotation.y=b[4]*0.5;
  });
  addBlobShadow(scene, 2.05, -3.35, 0.22, 0.4);

  // ── 책상 + 의자 (왼쪽 앞, 빈 공간 채우기) ──
  const dkWood = propMat(scene, 'dkWood', '#C08A5A', 0.06);
  const dkLeg  = propMat(scene, 'dkLeg',  '#8A6239', 0.05);
  const dkPad  = propMat(scene, 'dkPad',  '#5C6E86', 0.05);
  const DX = 3.30, DZ = -0.05;
  const deskTop = box('deskTop', 0.92, 0.09, 2.10, DX, 1.02, DZ, dkWood);
  [[-0.38,-0.92],[-0.38,0.92],[0.38,-0.92],[0.38,0.92]].forEach(function(q,i){
    box('deskLeg'+i, 0.09, 0.98, 0.09, DX+q[0], 0.49, DZ+q[1], dkLeg);
  });
  box('chairPad', 0.46, 0.05, 0.48, DX-0.70, 0.635, DZ, dkPad);
  box('deskDrawer', 0.03, 0.22, 0.55, DX+0.44, 0.88, DZ+0.55, dkLeg);
  // 노트북(열린 상태) — 방에 '공부하는 자리'가 생긴다
  box('lapBase', 0.42, 0.03, 0.60, DX-0.10, 1.08, DZ-0.45, dkPad);
  const lapScr = box('lapScr', 0.42, 0.38, 0.03, DX-0.10, 1.27, DZ-0.72, dkPad);
  lapScr.rotation.x = -0.24;
  cyl('mugDesk', {height:0.15, diameter:0.13, tessellation:14}, DX+0.02, 1.15, DZ+0.55, M.bulb);
  // 의자
  box('chairSeat', 0.54, 0.06, 0.56, DX-0.70, 0.58, DZ, dkWood);
  box('chairBack', 0.06, 0.42, 0.50, DX-0.94, 0.82, DZ, dkWood);
  [[-0.24,-0.24],[-0.24,0.24],[0.24,-0.24],[0.24,0.24]].forEach(function(q,i){
    box('chairLeg'+i, 0.055, 0.56, 0.055, DX-0.70+q[0], 0.28, DZ+q[1], dkLeg);
  });
  addBlobShadow(scene, DX-0.35, DZ, 1.30, 0.30);

  // ── 러그 술 (양쪽 긴 변) ──
  const fringe = propMat(scene, 'fringe', '#EFE6D8', 0.08);
  for (let i=0;i<11;i++){
    const z = -1.42 + i*0.284;
    box('frL'+i, 0.07, 0.012, 0.04, -1.98, 0.012, z, fringe);
    box('frR'+i, 0.07, 0.012, 0.04,  1.98, 0.012, z, fringe);
  }

  // ── 로봇 발밑 접촉 그림자(실제 그림자와 보완 → 더 단단한 접지감) ──
  // ★ 로봇이 걸어다니면 그림자도 따라가야 한다. 방에 고정해 두면
  //   '로봇만 움직이고 그림자는 원지에 남는' 상태가 된다.
  //   아직 root 가 없을 수 있으므로(아래 startBabylon 에서 나중에 만든다) 여기서는
  //   만들어 두기만 하고, root 생성 뒤에 거기로 붙인다.
  const rShadow = addBlobShadow(scene, 0, 0, 0.82, 0.5);   // ★ V17 접지감 강화
  scene.__footShadow = rShadow;
}

// ★ 구입한 장식을 실제 3D 오브젝트로 배치(남은 위험 1)
//   예전에는 상점에서 산 장식이 목록 텍스트로만 보여서 "돈을 냈는데 보이지 않는" 문제가 있었다.
//   여기서 실제 3D 오브젝트를 방 안에 배치해 구매가 공간으로 드러나게 한다.
function buildOwnedDecors(scene, M, decors){
  if(!decors || !decors.length) return [];
  const placed = [];
  const box=(n,w,h,d,x,y,z,m)=>{ const b=BABYLON.MeshBuilder.CreateBox(n,{width:w,height:h,depth:d},scene);
    b.position.set(x,y,z); b.material=m; b.isPickable=false; b.receiveShadows=true; return b; };
  const cyl=(n,o,x,y,z,m)=>{ const c=BABYLON.MeshBuilder.CreateCylinder(n,o,scene);
    c.position.set(x,y,z); c.material=m; c.isPickable=false; c.receiveShadows=true; return c; };

  // 별 스티커: 벽면(뒷벽)에 붙는 발광 5각 별 — 이미 상점 미리보기에서 사용한 조립 방식
  if(decors.includes('별 스티커')){
    const mx=-0.55, my=2.72, mz=-4.88;
    const starMat = M.sticker;
    const P=[];
    for(let i=0;i<5;i++){ const a=-Math.PI/2+i*Math.PI*2/5; P.push(new BABYLON.Vector3(mx+Math.cos(a)*0.3, my+Math.sin(a)*0.3, mz)); }
    for(let i=0;i<5;i++){
      const a=P[i], b=P[(i+1)%5];
      const len=BABYLON.Vector3.Distance(a,b);
      const bar=BABYLON.MeshBuilder.CreateCylinder('dsBar'+i,{height:len,diameter:0.085,tessellation:8},scene);
      bar.position=BABYLON.Vector3.Center(a,b);
      const dir=b.subtract(a).normalize();
      const axis=BABYLON.Vector3.Cross(BABYLON.Axis.Y, dir);
      const ang=Math.acos(Math.max(-1,Math.min(1,BABYLON.Vector3.Dot(BABYLON.Axis.Y,dir))));
      bar.rotationQuaternion = axis.length()<0.001 ? BABYLON.Quaternion.Identity()
        : BABYLON.Quaternion.RotationAxis(axis.normalize(), ang);
      bar.material=starMat; bar.isPickable=false;
    }
    // 십자 광선
    [[0,0.52,0.028],[0.31,0.31,0.02]].forEach(([rx,ry,th],i)=>{
      const r1=BABYLON.MeshBuilder.CreateBox('dsRayV'+i,{width:0.035,height:ry,depth:0.025},scene);
      r1.position.set(mx, my, mz); r1.material=starMat; r1.isPickable=false;
      const r2=BABYLON.MeshBuilder.CreateBox('dsRayH'+i,{width:rx||ry,height:0.035,depth:0.025},scene);
      r2.position.set(mx+(i?0.22:0), my+(i?0.22:0), mz); r2.material=starMat; r2.isPickable=false;
    });
    // 뒷벽 액자 자리에 붙은 별이라 앵커(작은 테이프) 추가
    const tape=box('dsTape',0.12,0.05,0.02, mx, my+0.3, mz+0.01, M.frame);
    placed.push('별 스티커');
  }

  // 선물 상자: 책장 아래 바닥에 놓인 상자 + 리본 매듭
  if(decors.includes('선물 상자')){
    const gx=1.85, gy=0, gz=-2.95;
    const g=box('giftBox',0.52,0.42,0.52, gx, gy+0.21, gz, M.giftBox);
    const lid=box('giftLid',0.56,0.1,0.56, gx, gy+0.44, gz, M.giftRibbon);
    // 크로스 리본 2줄
    box('giftRib1',0.11,0.53,0.545, gx, gy+0.24, gz, M.giftRibbon);
    box('giftRib2',0.545,0.53,0.11, gx, gy+0.24, gz, M.giftRibbon);
    // 매듭 구
    const knot=BABYLON.MeshBuilder.CreateSphere('giftKnot',{diameter:0.15,segments:12},scene);
    knot.position.set(gx, gy+0.5, gz); knot.scaling.set(1,0.75,1);
    knot.material=M.giftRibbon; knot.isPickable=false;
    // 리본 양 갈래(루프 2개)
    [0,1].forEach(i=>{
      const loop=BABYLON.MeshBuilder.CreateTorus('giftLoop'+i,{diameter:0.2,thickness:0.045,tessellation:14},scene);
      loop.position.set(gx+(i?0.09:-0.09), gy+0.55, gz);
      loop.rotation.x=Math.PI/2.6; loop.rotation.z=i?0.5:-0.5;
      loop.material=M.giftRibbon; loop.isPickable=false;
    });
    addBlobShadow(scene, gx, gz, 0.42, 0.5);
    placed.push('선물 상자');
  }

  // 장식 종류를 늘릴 때는 여기에 분기를 하나 더 추가하면 된다(이름 확인 → 메시 생성)
  return placed;
}

// 방 베이스(바닥/벽/창/러그/조명/소품) — 마이룸과 미리보기 공용
// opt: { props:false → 소품 생략, dust:false → 먼지 입자 생략 }
function createRoomBase(scene, opt){
  opt = opt||{};
  scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
  scene.fogColor = new BABYLON.Color3(0.863,0.918,0.988); // 하늘색과 동일 → 바닥 가장자리가 수평선처럼 흐려짐
  scene.fogDensity = 0.016;   // ★ V17 0.03→0.016: 원경 벽이 뿌옇게 뜨던 문제

  // 광원은 중성 흰색에 가깝게 (색 왜곡 방지 — 아이가 고른 색이 그대로 보이도록)
  const hemi = new BABYLON.HemisphericLight('h', new BABYLON.Vector3(0,1,0), scene);
  // ★ V17: 하늘광은 낮추고 키 라이트를 올려 '면이 나뉘는' 입체감을 만든다.
  //   (아이가 고른 색은 그대로 보이도록 광원 색은 중성 유지)
  hemi.intensity = 0.42; hemi.diffuse = new BABYLON.Color3(1,1,1);
  hemi.groundColor = new BABYLON.Color3(0.93,0.90,0.86);   // 바닥 반사광은 살짝 따뜻하게
  const dir = new BABYLON.DirectionalLight('d', new BABYLON.Vector3(-0.42,-0.9,-0.62), scene);
  dir.intensity = 1.05; dir.position = new BABYLON.Vector3(3.6,7.6,5.4);
  dir.autoCalcShadowZBounds = false; dir.shadowMinZ = 2; dir.shadowMaxZ = 18;
  // 림 라이트(역광): 로봇 윤곽을 배경에서 분리해 입체감↑
  const rimLight = new BABYLON.DirectionalLight('rimLight', new BABYLON.Vector3(0,-0.45,1), scene);
  rimLight.intensity = 0.30; rimLight.position = new BABYLON.Vector3(-2.4,5,-7);

  const flat = m=>{ m.specularColor=new BABYLON.Color3(0,0,0); return m; };
  const HW=5.6, HD=5.0, WH=9.0;                       // 벽 반너비 / 뒷벽 z / 벽 높이
  const WIN={x0:-4.4, x1:-2.0, y0:1.7, y1:3.9};       // 창 개구부

  // ── 마루 바닥 ──
  const floor = BABYLON.MeshBuilder.CreateGround('floor',{width:26,height:26,subdivisions:1},scene);
  const fm=flat(new BABYLON.StandardMaterial('fm',scene));
  fm.diffuseTexture=texWood(scene); fm.diffuseColor=new BABYLON.Color3(1,1,1);
  floor.material=fm; floor.isPickable=false; floor.receiveShadows=true;

  // ── 벽(뒷벽을 창 개구부 기준으로 4조각 분할 → 실제 구멍) ──
  const wallMat=flat(new BABYLON.StandardMaterial('wallM',scene)); wallMat.diffuseColor=new BABYLON.Color3(0.94,0.96,0.995);
  wallMat.emissiveColor=new BABYLON.Color3(0.10,0.11,0.13);   // 옆벽 어두운 부위 보정
  wallMat.backFaceCulling=false;
  const wainMat=flat(new BABYLON.StandardMaterial('wainM',scene)); wainMat.diffuseColor=new BABYLON.Color3(0.82,0.885,0.965);
  wainMat.emissiveColor=new BABYLON.Color3(0.08,0.09,0.11);
  wainMat.backFaceCulling=false;
  const baseMat=flat(new BABYLON.StandardMaterial('baseM',scene)); baseMat.diffuseColor=new BABYLON.Color3(1,1,1);
  baseMat.backFaceCulling=false;
  const plane=function(n,w,h,x,y,z,m){ const p=BABYLON.MeshBuilder.CreatePlane(n,{width:w,height:h},scene);
    p.position.set(x,y,z); p.material=m; p.isPickable=false; p.receiveShadows=true; return p; };
  const wcx=(WIN.x0+WIN.x1)/2, wcy=(WIN.y0+WIN.y1)/2, ww=WIN.x1-WIN.x0, wh=WIN.y1-WIN.y0;
  if(!opt.bare) plane('wL', WIN.x0+HW, WH, (-HW+WIN.x0)/2, WH/2, -HD, wallMat);
  if(!opt.bare) plane('wR', HW-WIN.x1, WH, (HW+WIN.x1)/2, WH/2, -HD, wallMat);
  if(!opt.bare) plane('wB', ww, WIN.y0, wcx, WIN.y0/2, -HD, wallMat);
  if(!opt.bare) plane('wT', ww, WH-WIN.y1, wcx, (WH+WIN.y1)/2, -HD, wallMat);
  if(!opt.bare) plane('sideL', 18, WH, -HW, WH/2, 2, wallMat).rotation.y=Math.PI/2;
  if(!opt.bare) plane('sideR', 18, WH,  HW, WH/2, 2, wallMat).rotation.y=Math.PI/2;
  // 걸레받이 + 걸레받이 몰딩(벽과 바닥의 경계가 자연스럽고, 이전의 딱딱한 경계 사라짐)
  if(!opt.bare) plane('wainB', HW*2, 1.0, 0, 0.5, -HD+0.02, wainMat);
  if(!opt.bare) plane('wainL', 18, 1.0, -HW+0.02, 0.5, 2, wainMat).rotation.y=Math.PI/2;
  if(!opt.bare) plane('wainR', 18, 1.0,  HW-0.02, 0.5, 2, wainMat).rotation.y=Math.PI/2;
  const skirt=function(n,w,d,x,z,ry){ const b=BABYLON.MeshBuilder.CreateBox(n,{width:w,height:0.15,depth:d},scene);
    b.position.set(x,0.075,z); if(ry) b.rotation.y=ry; b.material=baseMat; b.isPickable=false; return b; };
  if(!opt.bare){ skirt('skB',HW*2,0.07, 0,-HD+0.05, 0);
  skirt('skL',18,0.07, -HW+0.05,2, Math.PI/2);
  skirt('skR',18,0.07,  HW-0.05,2, Math.PI/2); }
  // 천장(위쪽 빈 공간을 막아 시선이 자연스럽게 닫히도록)
  const ceilMat=flat(new BABYLON.StandardMaterial('ceilM',scene)); ceilMat.diffuseColor=new BABYLON.Color3(0.98,0.985,1);
  ceilMat.backFaceCulling=false;
  if(!opt.bare){ const ceil=BABYLON.MeshBuilder.CreateGround('ceiling',{width:HW*2.4,height:20,subdivisions:1},scene);
  ceil.position.set(0, WH-0.02, 2); ceil.rotation.x=Math.PI;   // 아래를 향하도록 뒤집음
  ceil.material=ceilMat; ceil.isPickable=false;
  // 천장 가장자리 몰딩(벽과 천장 사이 경계 정리)
  const crown=function(n,w,d,x,z,ry){ const b=BABYLON.MeshBuilder.CreateBox(n,{width:w,height:0.12,depth:d},scene);
    b.position.set(x,WH-0.06,z); if(ry) b.rotation.y=ry; b.material=baseMat; b.isPickable=false; return b; };
  crown('crB',HW*2,0.08, 0,-HD+0.04, 0);
  crown('crL',18,0.08, -HW+0.04,2, Math.PI/2);
  crown('crR',18,0.08,  HW-0.04,2, Math.PI/2); }

  // ── 창(틀 + 십자 창살 + 창대 + 창밖 풍경) ──
  const frameMat=flat(new BABYLON.StandardMaterial('frmM',scene)); frameMat.diffuseColor=new BABYLON.Color3(1,1,1);
  frameMat.backFaceCulling=false;
  const fbox=function(n,w,h,d,x,y,z){ const b=BABYLON.MeshBuilder.CreateBox(n,{width:w,height:h,depth:d},scene);
    b.position.set(x,y,z); b.material=frameMat; b.isPickable=false; return b; };
  if(!opt.bare){
  fbox('wfT',ww+0.24,0.14,0.16, wcx,WIN.y1+0.05,-HD+0.02);
  fbox('wfB',ww+0.24,0.16,0.22, wcx,WIN.y0-0.05,-HD+0.03);
  fbox('wfL',0.14,wh+0.2,0.16, WIN.x0-0.05,wcy,-HD+0.02);
  fbox('wfR',0.14,wh+0.2,0.16, WIN.x1+0.05,wcy,-HD+0.02);
  fbox('wfV',0.08,wh,0.10, wcx,wcy,-HD+0.04);
  fbox('wfH',ww,0.08,0.10, wcx,wcy,-HD+0.04);
  fbox('sill',ww+0.4,0.09,0.34, wcx,WIN.y0-0.14,-HD+0.16);
  const skyMat=new BABYLON.StandardMaterial('skyM',scene);
  skyMat.diffuseTexture=texSky(scene); skyMat.emissiveColor=new BABYLON.Color3(0.9,0.9,0.9);
  skyMat.specularColor=new BABYLON.Color3(0,0,0); skyMat.disableLighting=true; skyMat.backFaceCulling=false;
  const sky=BABYLON.MeshBuilder.CreatePlane('skyView',{width:10,height:7},scene);
  sky.position.set(wcx+0.5, wcy+0.6, -HD-3.0); sky.material=skyMat; sky.isPickable=false; sky.applyFog=false;
  }

  // ── 창빛 기둥(additive 위장 볼륨광, 공기감 표현) ──
  const beam=BABYLON.MeshBuilder.CreateCylinder('beam',{height:5.2,diameterTop:1.0,diameterBottom:2.6,tessellation:20},scene);
  const bFrom=new BABYLON.Vector3(wcx,WIN.y1,-HD+0.15), bTo=new BABYLON.Vector3(wcx+1.6,0.06,-HD+3.8);
  const dv=bTo.subtract(bFrom), dN=dv.scale(1/dv.length());
  beam.position.copyFrom(bFrom.add(dv.scale(0.5)));
  const ax=BABYLON.Vector3.Cross(BABYLON.Axis.Y, dN);
  beam.rotationQuaternion = ax.length()<0.001 ? BABYLON.Quaternion.Identity()
    : BABYLON.Quaternion.RotationAxis(ax.normalize(), Math.acos(Math.max(-1,Math.min(1,BABYLON.Vector3.Dot(BABYLON.Axis.Y,dN)))));
  const bm=new BABYLON.StandardMaterial('beamM',scene);
  bm.emissiveColor=new BABYLON.Color3(1,0.98,0.92); bm.diffuseColor=new BABYLON.Color3(0,0,0);
  bm.specularColor=new BABYLON.Color3(0,0,0); bm.disableLighting=true; bm.backFaceCulling=false;
  bm.alpha=0.06; bm.alphaMode=BABYLON.Engine.ALPHA_ADD;   // ★ V17 0.09→0.06 (창가가 하얗게 뜨던 문제)
  beam.material=bm; beam.isPickable=false; beam.applyFog=false;
  if(opt.bare) beam.dispose();

  // ──  러그(둥근 모서리 + 문양) ──
  if(!opt.bare){ const rug=BABYLON.MeshBuilder.CreateGround('rug',{width:3.9,height:3.1,subdivisions:1},scene);
  rug.position.y=0.014;
  const rugMat=flat(new BABYLON.StandardMaterial('rugM',scene));
  rugMat.diffuseTexture=texRug(scene); rugMat.diffuseTexture.hasAlpha=true;
  rugMat.useAlphaFromDiffuseTexture=true; rugMat.backFaceCulling=false;
  rug.material=rugMat; rug.isPickable=false; rug.receiveShadows=true; }

  // ── 소품 ──
  if(opt.props !== false){
    const palette=['#ef8f7c','#ffd36e','#7fc8f8','#9ad9b0','#c9a6ee','#f7a5c4'];
    const M={
      wood:propMat(scene,'mWood','#d9b98c'), woodDark:propMat(scene,'mWoodD','#b98f5f'),
      pot:propMat(scene,'mPot','#e79a86'), potRim:propMat(scene,'mPotR','#f6bfae'),
      stem:propMat(scene,'mStem','#5f9e6a'),
      leaf:[propMat(scene,'mLf1','#6fbb7a'), propMat(scene,'mLf2','#57a566')],
      metal:propMat(scene,'mMet','#c3ccd8'), metalDark:propMat(scene,'mMetD','#8b95a3'),
      shade:propMat(scene,'mShade','#ffe0a8',0.42), bulb:propMat(scene,'mBulb','#fff4d2',0.85),
      frame:propMat(scene,'mFrame','#c9a273'),
      frameCol:[propMat(scene,'mFc1','#ffd9e2'), propMat(scene,'mFc2','#cdeafd')],
      sticker:propMat(scene,'mStk','#ff8fa3',0.3), clockFace:propMat(scene,'mClk','#fdfdff'),
      cord:propMat(scene,'mCord','#b9c2cf'),
      flag:['#ff9aa2','#ffd93d','#8fd3ff','#b5e48c','#d5b3ff'].map(function(c,i){ return propMat(scene,'mFlg'+i,c,0.3); }),
      book:palette.map(function(c,i){ return propMat(scene,'mBk'+i,c,0.16); }),
      block:[propMat(scene,'mBl0','#7fc8f8'), propMat(scene,'mBl1','#ffd36e'), propMat(scene,'mBl2','#9ad9b0')],
      // ★ 소유 장식용 재질(선물 상자)
      giftBox:propMat(scene,'mGiftB','#e05a5a'),
      giftRibbon:propMat(scene,'mGiftR','#ffd54f',0.28)
    };
    buildRoomProps(scene, M);
    scene.__propM = M;   // 장식 재생성 시 재사용(재질 중복 생성 방지)
    // ★ 이미 구매한 장식을 실제 3D 오브젝트로 배치(돈을 낸 만큼 보이게)
    try{ scene.__placedDecors = buildOwnedDecors(scene, M, opt.decors||[]); }catch(e){ console.error('[decors]', e); }
  }
  // 단품 전시대(장식 미리보기 전용) — 상품이 공중에 뜨지 않도록 받침대
  if(opt.bare){
    const ped=BABYLON.MeshBuilder.CreateCylinder('pedestal',{height:0.1,diameter:1.15,tessellation:44},scene);
    ped.position.y=0.05; ped.isPickable=false; ped.receiveShadows=true;
    const pm=flat(new BABYLON.StandardMaterial('pedM',scene)); pm.diffuseColor=new BABYLON.Color3(1,1,1);
    const pt=new BABYLON.DynamicTexture('pedT',{width:256,height:256},scene,true);
    const pc=pt.getContext(); const pgr=pc.createRadialGradient(128,128,20,128,128,128);
    pgr.addColorStop(0,'#ffffff'); pgr.addColorStop(0.7,'#f3f8ff'); pgr.addColorStop(1,'#dfeaf7');
    pc.fillStyle=pgr; pc.fillRect(0,0,256,256); pt.update(false);
    pm.diffuseTexture=pt; ped.material=pm;
  }
  if(opt.dust !== false && BABYLON.ParticleSystem) addDustMotes(scene);
  return { dir, hemi };
}
// 부드러운 그림자 (rebuild 후 다시 호출해 캐스터 갱신)
function applyShadow(scene, dir, meshRoot){
  if(!scene.__shadow){
    // ★ V17: 1024→2048 + 하이필터. 바닥이 26×26 으로 넓어 해상도가 부족했다.
    //   bias/normalBias 를 줘서 그림자가 얼굴에 붙는 '아크네'를 막는다.
    const sh = new BABYLON.ShadowGenerator(1536, dir);
    sh.usePercentageCloserFiltering = true;
    sh.filteringQuality = BABYLON.ShadowGenerator.QUALITY_MEDIUM;
    sh.darkness = 0.34; sh.bias = 0.002; sh.normalBias = 0.02;
    scene.__shadow = sh;
  }
  scene.__shadow.getShadowMap().renderList = meshRoot.getChildMeshes(false);
}

// ★ V11 저사양 기기 자동 조정 — 학교 태블릿·크롬북에서도 끊기지 않게.
//   아이는 '버벅임'을 화질보다 훨씬 크게 느낀다 → 부드러움을 우선한다.
//   시작 후 2.5초간 실제 FPS 를 재서 낮으면 해상도·그림자·후처리를 포기한다.
function autoTuneQuality(engine, scene){
  if(bjs._tuned) return;
  bjs._tuned = true;
  // ★ V17: 예전에는 시작 2.5초를 그대로 쟀는데, 그 구간이 정확히 환경 텍스처 로딩과
  //   셰이더 컴파일 구간이라 어떤 기기든 FPS 가 낮게 나왔다 → 그림자가 무조건 꺼졌다.
  //   워밍업 1.2초를 버리고, 그 뒤 2.5초만 측정한다. 그림자는 정말 느릴 때만 포기.
  let frames = 0;
  let t0 = 0;
  let obs = null;
  setTimeout(()=>{
    t0 = performance.now();
    obs = scene.onAfterRenderObservable.add(()=>{ frames++; });
    setTimeout(()=>{
      try{ scene.onAfterRenderObservable.remove(obs); }catch(e){}
      const fps = frames / Math.max(0.5, (performance.now() - t0) / 1000);
      bjs.fps = Math.round(fps);
      if(fps>= 20) return;                             // 20fps 이상이면 화질 유지(24→20: 디테일 추가 후 과민 반응)
      bjs.lowPerf = true;
      try{ engine.setHardwareScalingLevel(1.25); }catch(e){}                                   // 1차: 해상도만 살짝 ↓
      if(fps <16){
        try{ if(scene.__shadow){ scene.__shadow.dispose(); scene.__shadow = null; } }catch(e){}  // 2차: 그림자
        try{ if(bjs.pipeline){ bjs.pipeline.dispose(); bjs.pipeline = null; } }catch(e){}        // 3차: 후처리
        try{ scene.particleSystems.slice().forEach(p=>p.dispose()); }catch(e){}                 // 4차: 먼지
      }
      console.log('[성능] FPS', Math.round(fps), '→ 저사양 모드(해상도' + (fps <18 ? '·그림자·후처리·먼지' : '') + ' 해제)');
    }, 2500);
  }, 1200);
}

function startBabylon(canvas, robot, fallback){
  if(bjs._starting || bjs.ready) return; // 중복 시작 방지 (환경 로드 대기 중 재진입)
  bjs._starting = true;
  try{
    const engine = new BABYLON.Engine(canvas, true, {preserveDrawingBuffer:true, stencil:true, adaptToDeviceRatio:true});
    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0.863,0.918,0.988,1); // #dceafc

    // 카메라: +z 쪽에서 로봇 정면을 바라봄 (alpha=π/2 → z 양수, 벽이 로봇 뒤에 위치)
    const cam = new BABYLON.ArcRotateCamera('cam', Math.PI/2, 1.30, 6.8, new BABYLON.Vector3(0,1.05,0), scene);
    // ★ V17 프레이밍: 캔버스 비율이 세로로 길면 같은 거리에서 로봇만 크게 보인다.
    //   비율을 읽어 거리를 자동 보정하고, 리사이즈 때마다 다시 맞춘다.
    const fitRoomCamera = ()=>{
      const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
      const ar = w / h;
      const r = Math.max(5.4, Math.min(9.0, 5.85 + (1.35 - ar) * 2.5));
      cam.radius = r;
      cam.lowerRadiusLimit = Math.max(4.0, r * 0.72);
      cam.upperRadiusLimit = r * 1.55;
      cam.beta = ar <0.9 ? 1.24 : 1.30;
    };
    fitRoomCamera();
    // 줌 한계 설정 (휠로 확대/축소)
    cam.lowerRadiusLimit = cam.lowerRadiusLimit || 4.2; cam.upperRadiusLimit = cam.upperRadiusLimit || 11;
    cam.wheelDeltaPercentage = 0.02;
    if(!canvas.__zoomBound){
      canvas.__zoomBound = true;
      canvas.addEventListener('wheel', (e)=>{
        e.preventDefault();
        cam.radius = Math.max(cam.lowerRadiusLimit, Math.min(cam.upperRadiusLimit, cam.radius + e.deltaY*0.012));
      }, {passive:false});
    }
    // 조명·바닥·러그·안개 (미리보기 창과 공용)
    // ★ decors 전달 → 구매한 장식이 방 안에 실제 3D 오브젝트로 놓인다
    const { dir, hemi } = createRoomBase(scene, { decors: state.decors||[] });

    const root = new BABYLON.TransformNode('robotRoot', scene);
    root.rotation.y = 0;   // ★ V17 시작 자세는 카메라 정면
    const bob  = new BABYLON.TransformNode('bob', scene); bob.parent = root;
    const model= new BABYLON.TransformNode('model', scene); model.parent = bob;
    // 발밑 그림자를 root 에 붙여 로봇과 함께 움직이게 한다
    if(scene.__footShadow){ scene.__footShadow.parent = root; scene.__footShadow.position.y = 0.008; }
// ★ V3 수정: bjs 를 다시 만들 때 _starting:true 를 반드시 함께 넣는다.
    //   원래는 자꾸 때 _starting 이 사라져서, 환경 텍스처 로딩(~2.5초) 동안
    //   마이룸이 다시 호출되면 가드를 통과해 같은 canvas 에 두 번째 Engine 이 생겼다
    //   (렌더 루프 2개, 호흡 2배, wanderTimer 누수).
    bjs = { engine, scene, root, bob, model, canvas, cam, ready:false, _t:0, wanderTimer:null, _starting:true };

    // PBR 환경광 로드(최대 2.5초) → 성공 시 점토 질감, 실패 시 Standard 로봇 생성
    tryLoadEnvironment(scene).then(ok=>{
      try{
        const factory = makeMatFactory(scene, ok);
        bjs.matFactory = factory;
        // ★ V17: 환경광이 성공해도 키 라이트를 예전 값(0.6)으로 되돌리지 않는다.
        //   되돌리면 PBR 반사가 있는 기기에서만 장면이 다시 평평해진다.
        if(ok){ hemi.intensity = 0.38; dir.intensity = 0.95; }
        // 후처리: FXAA + 미세 비네트만 사용 (톤매핑/대비는 색 왜곡 → OFF, 아이가 고른 색 그대로)
        try{
          const pipe = new BABYLON.DefaultRenderingPipeline('dpr', true, scene, [cam]);
          bjs.pipeline = pipe;   // ★ V11 저사양 모드에서 해제할 수 있게 보관
          pipe.fxaaEnabled = true;
          pipe.imageProcessing.toneMappingEnabled = false;
          pipe.imageProcessing.exposure = 1.0;
          pipe.imageProcessing.contrast = 1.0;
          pipe.imageProcessing.vignetteEnabled = true;
          pipe.imageProcessing.vignetteWeight = 1.1;
          pipe.imageProcessing.vignetteStretch = 0.4;
        }catch(e){ new BABYLON.FxaaPostProcess('fxaa', 1.0, cam); } // 폴백
        bjs.refs = buildRobotModel(scene, model, effectiveColors(robot.template, robot.palette), robot.template, null, factory, curStage());
        applyShadow(scene, dir, model); // 로봇 그림자를 바닥에

        // 대기 모션: 위아래 흔들림 + 호흡/깜빡임/안테나 펄스/팔 흔들
        scene.onBeforeRenderObservable.add(()=>{
          const dt=engine.getDeltaTime()/1000; bjs._t+=dt;
          // 이동 갱신(루트 위치/회전 조작) → 그 다음 원래 애니메이션
          updateWalk(dt);
          // 점프 애니메이션 중이면 숨의 흔들림이 값을 덮어쓰므로 멈춘다
          if(!_walk.walking && !bjs._jumping) bob.position.y=Math.sin(bjs._t*2)*0.03;
          const talk = Math.max(0, 1-(Date.now()-(bjs.talkUntil||0))/900);
          updateIdle(bjs.refs, bjs._t, talk);
        });
        // 아이가 가만히 있으면 로봇이 스스로 몇 걸음 걸어다닌다(무한 반복 예약)
        // ★ V17: 첫 9초는 제자리에서 카메라를 바라보게 둔다(첫인상=얼굴).
        //   그 뒤 11초 간격으로 한두 걸음. 너무 자주 움직이면 '등 돌린 로봇'이 자주 보인다.
        setTimeout(()=>{
          if(!bjs.ready) return;
          bjs.wanderTimer = setInterval(()=>{ if(bjs.ready && !_walk.active && !bjs._userDragging) idleWander(); }, 11000);
        }, 9000);

        // 왼쪽 드래그=회전 / 오른쪽 드래그=카메라 이동(팬) / 클릭=말하기·부품 설명
        canvas.addEventListener('contextmenu', e=>e.preventDefault());
        let dragging=false, lastX=0, moved=0;
        bjs._userDragging=false;   // 사용자가 회전 중이면 산책을 멈춘다
        let panning=false, panX=0, panY=0;
        scene.onPointerObservable.add(p=>{
          if(p.type===BABYLON.PointerEventTypes.POINTERDOWN){
            if(p.event.button===2){ panning=true; panX=p.event.clientX; panY=p.event.clientY; }
            else { dragging=true; bjs._userDragging=true; lastX=p.event.clientX; moved=0; }
          } else if(p.type===BABYLON.PointerEventTypes.POINTERMOVE){
            if(panning){
              const dx=p.event.clientX-panX, dy=p.event.clientY-panY; panX=p.event.clientX; panY=p.event.clientY;
              const f = cam.radius*0.0016;
              cam.target.x = Math.max(-2.2, Math.min(2.2, cam.target.x - dx*f));
              cam.target.y = Math.max(-0.4, Math.min(3.2, cam.target.y + dy*f));
            } else if(dragging){
              const dx=p.event.clientX-lastX; lastX=p.event.clientX; moved+=Math.abs(dx); root.rotation.y += dx*0.012;
            }
          } else if(p.type===BABYLON.PointerEventTypes.POINTERUP){
            if(panning){ panning=false; return; } // 오른쪽 버튼 놓음 → 말하기 없음
            dragging=false; bjs._userDragging=false;
            if(moved<6){ const pick=scene.pick(scene.pointerX, scene.pointerY);
              if(pick.hit && pick.pickedMesh && pick.pickedMesh.metadata){
                const md = pick.pickedMesh.metadata;
                if(md.part){ const info=PART_INFO[md.part]||{emoji:'',desc:''}; bubble(`${info.emoji} ${md.part} — ${info.desc}`); }
                else if(md.robot){ talkToRobot(robot); }
              }
            }
          }
        });

        engine.runRenderLoop(()=>scene.render());
        window.addEventListener('resize', ()=>{ engine.resize(); try{ fitRoomCamera(); }catch(e){} });
        bjs.ready = true; bjs._starting = false;
        canvas.classList.remove('hidden'); $('#room-robot').classList.add('hidden');
        autoTuneQuality(engine, scene);   // ★ V11: 실제 FPS 를 보고 필요하면 화질을 낮춘다
        setTimeout(()=>engine.resize(), 60); // 화면 전환 후 사이즈 보정
      }catch(e){
        bjs._starting = false;
        window.__bjsError = (e && e.message) || String(e); console.error('[Babylon]', e); fallback();
      }
    });
  }catch(e){ bjs._starting = false; window.__bjsError = (e && e.message) || String(e); console.error('[Babylon]', e); fallback(); }
}

// 3D 마운트 (CDN 실패 시 SVG 폴백)
function mountRoom3D(robot){
  const canvas = $('#room3d');
  const fallback = ()=>{ bjs.ready=false; canvas.classList.add('hidden'); $('#room-robot').classList.remove('hidden');
    $('#room-robot').innerHTML = robotSVG(robot.template, robot.palette); };
  // 최초 진입일 때만 SVG 를 로딩 플레이스홀더로 먼저 보여줌 (이미 3D 살아있으면 플래시 방지)
  if(!bjs.ready){
    $('#room-robot').classList.remove('hidden'); canvas.classList.add('hidden');
    $('#room-robot').innerHTML = robotSVG(robot.template, robot.palette);
  }
  const wait = (n=0)=>{
    if(bjs.ready && bjs.scene){ rebuildRobot(robot); setTimeout(()=>bjs.engine.resize(),30); return; }
    if(window.__bjsFailed){ fallback(); return; }
    if(window.BABYLON){ startBabylon(canvas, robot, fallback); return; }
    if(n>70){ fallback(); return; } // ~7초 대기 후 폴백
    setTimeout(()=>wait(n+1), 100);
  };
  wait();
}
function renderQuests(){
  const doneIds = (state.quests.done||[]).map(Number);
  $('#quest-list').innerHTML = state.quests.list.map(q=>{
    const done = doneIds.includes(q.id);
    const title = esc(q.title);
    if(q.type==='ai_mission' && !done){
      const tp = (state.growth && state.growth.topic) || null;
      const chip = tp ? `<div class="aim-topic"> 이번 주 주제 · ${esc(tp.topic)}</div>` : '';
      return `<div class="quest-item aim">${chip}<div style="margin-bottom:6px"> ${title}</div>
        <textarea id="ai-answer" rows="2" maxlength="120" placeholder="로봇에게 이야기해주세요!"></textarea>
        <button class="btn primary" id="ai-submit" data-qid="${q.id}" style="width:100%;margin-top:6px">답하기  +${q.reward}</button></div>`;
    }
    return `<div class="quest-item ${done?'done':''}"><span>${done?'':''} ${title}</span><span> +${q.reward}</span></div>`;
  }).join('');
  const btn = $('#ai-submit');
  if(btn) btn.addEventListener('click', submitAiMission);
}
async function submitAiMission(){
  const btn = $('#ai-submit'); if(btn.disabled) return;
  const answer = ($('#ai-answer')?$('#ai-answer').value:'').trim();
  if(!answer) return alert('로봇에게 이야기를 적어주세요!');
  btn.disabled = true; btn.textContent = ' 로봇이 듣는 중...';
  try{
    const r = await api('/api/quest/answer',{answer});
    state.user.cell_balance = r.balance; setBalance(r.balance);
    state.quests.done.push(String(btn.dataset.qid)); renderQuests();
    bubble(r.reaction);
    setTimeout(()=>bubble(r.bonus? ` +${r.baseReward}셀 (부품 +${r.bonus}) = +${r.reward}셀!` : ` +${r.reward}셀 획득!`), 4500);
  }catch(e){ alert(e.message); btn.disabled=false; btn.textContent='답하기  +30'; }
}
// ★ P1-8 이중 클릭 방지: 요청 중 버튼을 잠가 LLM 을 두 번 소모하지 않게 한다
$$('.interact-row .btn').forEach(b=>b.addEventListener('click', async ()=>{
  if(b.disabled) return;
  const act = b.dataset.act;
  b.disabled = true;
  try{
    const j = await api('/api/interact',{situation:act});
    // ★ 반응하기 전에 로봇이 카메라 쪽으로 걸어와야 '같이 놀는' 느낌이 난다
    walkTo([0, -0.2], 0);
    bubble(j.line); jumpRobot();
    // ★ P1-1 일일 한도 초과 안내
    if(j.limited) setTimeout(()=>bubble('오늘은 정말 많이 했어! 내일 또 놀자 '), 1200);
    const q = state.quests.list.find(x=>x.type===act);
    const doneIds = (state.quests.done||[]).map(Number);
    if(q && !doneIds.includes(q.id)){
      const r = await api('/api/quest/complete',{questId:q.id});
      state.user.cell_balance = r.balance; setBalance(r.balance);
      state.quests.done.push(String(q.id)); renderQuests();
      // ★ P0-2 레벨업 시 성장 알림
      if(r.growth && r.growth.leveledUp){
        SFX.levelup();
        setTimeout(()=>bubble(` 레벨 업! Lv.${r.growth.level} 달성!`), 500);
        await refreshGrowth();     // ★ V9: 단계가 바뀌면 3D 가 눈앞에서 자란다
      }
      setTimeout(()=>bubble(r.bonus? ` +${r.baseReward}셀 (부품 +${r.bonus}) = +${r.reward}셀!` : ` +${r.reward}셀 획득!`), 500);
    }
  }catch(e){ alert(e.message); }
  finally{ b.disabled = false; }
}));

// ---------- 미니게임: 반사 속도 + 기억 순서 (남은 위험 3: 난이도 커브) ----------
// 두 게임 모두 '클라이언트에서 플레이 → 서버로 성적 제출 → 서버가 보상 지급'.
// 보상 계산은 전부 서버가 하므로 클라이언트를 조작해 셀을 늘릴 수 없다.
// 12색(9단계 11칸까지 커버). 8색이었을 때 6단계에서 상한에 걸려
// 7~9단계가 같은 난이도로 반복되고, 수열 길이만 커져 클리어가 불가능해졌다.
const MEM_COLORS = ['#ff6b6b','#ffa94d','#ffe066','#63e6be','#74c0fc','#b197fc','#ffa8d5','#8ce99a','#ffc078','#a5d8ff','#d0bfff','#99e9f2'];
const MEM_MAX_LEVEL = 9;   // 클리어 가능한 최종 단계(서버 보상 상한과 동일)
let _rxTimer = null, _rxNext = null, _mmTimer = null;
function closeGame(id){
  clearTimeout(_rxTimer); clearTimeout(_rxNext); clearTimeout(_mmTimer);
  _rxTimer = _rxNext = _mmTimer = null;
  // ★ 닫을 때 게임 상태도 반드시 초기화한다.
  //   rx.running 이 true 로 남으면 다음에 다시 열었을 때
  //   "진행 중" 인 척하며 타이머만 도는 유령 상태가 된다.
  rx.running = false; mm.running = false;
  // 버튼 복구(다음 실행에서 '계속하기' 등으로 굳지 않도록)
  const rg = $('#reflex-go'); if(rg){ rg.disabled = false; }
  const mg = $('#memory-go'); if(mg){ mg.disabled = false; }
  $('#'+id).classList.add('hidden');
}
// 공통: 게임 결과 제출 + 보상 안내
// ★ 어떤 경우에도 버튼이 '제출 중' 으로 굳지 않도록 finally 에서 반드시 복구한다.
//   (예전에는 catch 에서 bubble 만 띄우고 버튼을 돌려주지 않아 화면이 영구히 멈췄다)
async function submitGameResult(kind, payload, btn){
  const btnRef = btn || null;
  try{
    // 서버가 LLM 을 거치지 않더라도 응답이 늦을 수 있으므로 12초_TIMEOUT 을 건다
    const r = await api('/api/game/result', Object.assign({ kind }, payload), 12000);
    state.user.cell_balance = r.balance; setBalance(r.balance);
    if(r.growth) state.growth = { ...state.growth, ...r.growth, partBonus: state.growth.partBonus||0 };
    await refreshGrowth();     // ★ V9: 단계가 바뀌면 3D 가 눈앞에서 자란다
    const detail = r.ms != null ? `${r.ms}ms` : `${r.level}단계`;
    const stage = kind==='reaction' ? $('#reflex-stage') : $('#memory-stage');
    if(stage) stage.innerHTML = ` 보상 받음!<br> +${r.reward}셀 · +${r.growth.exp}XP`;
    bubble(` ${r.label} ${detail}!  +${r.reward}셀 +${r.growth.exp}XP`);
    // 1.6초 뒤에 창을 스스로 닫아 다음 판으로 이어지게 한다
    setTimeout(()=>{
      closeGame(kind==='reaction' ? 'game-reflex' : 'game-memory');
      if(state.robot) renderMyroom();
    }, 1600);
  }catch(e){
    // 실패: 사유를 화면에 분명히 남기고 버튼을 되살린다(재시도 가능)
    const stage = kind==='reaction' ? $('#reflex-stage') : $('#memory-stage');
    if(stage) stage.innerHTML = `<span style="color:#c92a2a">${esc(e.message)}</span>`;
    bubble(e.message);
    if(btnRef){
      btnRef.disabled = false;
      btnRef.textContent = kind==='reaction' ? '다시 시작' : '다시 시작';
    }
    const other = kind==='reaction' ? $('#memory-go') : $('#reflex-go');
    if(other) other.disabled = false;
  }
}
// ── 반사 속도 ──
const rx = { tries:0, best:null, armedAt:0, running:false, skipped:0 };
function openReflex(){
  rx.tries = 0; rx.best = null; rx.running = false; rx.skipped = 0;
  clearTimeout(_rxNext); _rxNext = null;
  $('#reflex-tries').textContent = '시도 0/3';
  $('#reflex-best').textContent = '';
  $('#reflex-stage').textContent = '초록불이 되면 아래 버튼을 눌러요!';
  $('#reflex-stage').className = 'game-stage';
  $('#reflex-go').textContent = '시작하기';
  $('#reflex-go').disabled = false;
  $('#game-reflex').classList.remove('hidden');
}
function reflexArm(){
  const stage = $('#reflex-stage'), btn = $('#reflex-go');
  clearTimeout(_rxNext); _rxNext = null;   // 예약된 다음 판이 있으면 취소(중복 발동 방지)
  stage.className = 'game-stage wait'; stage.textContent = '빨간불… 기다려요!';
  btn.textContent = '기다리는 중…';
  const delay = 1200 + Math.random()*3200;
  _rxTimer = setTimeout(()=>{
    stage.className = 'game-stage go'; stage.textContent = ' 지금!';
    rx.armedAt = performance.now();
    btn.textContent = '지금 누르기!';
  }, delay);
}
// 반사 속도 종료 처리(유효 기록이 있을 때만 서버에 제출)
// 세 판을 모두 실수/이동으로 흘렸다면 best 가 null 이므로 제출하지 않고 되돌린다.
function finishReflex(){
  const stage = $('#reflex-stage'), btn = $('#reflex-go');
  rx.running = false;
  clearTimeout(_rxNext); _rxNext = null;
  btn.disabled = false; btn.textContent = '시작하기';
  if(rx.best == null){
    stage.className = 'game-stage';
    stage.textContent = '아이번엔 한 번도 성공하지 못했어요  다시 도전해 볼래요?';
    return;
  }
  btn.disabled = true; btn.textContent = '결과 제출 중...';
  stage.className = 'game-stage';
  stage.textContent = `최고 기록 ${rx.best}ms!`;
  submitGameResult('reaction', { ms: rx.best }, btn);
}
function reflexClick(){
  if(!rx.running) return;
  const stage = $('#reflex-stage'), btn = $('#reflex-go');
  if(stage.classList.contains('wait')){          // 빨간불에 눌림 = 실수
    SFX.wrong();
    clearTimeout(_rxTimer);
    // ★ 실수도 한 판만 버리고 다음 판으로 진행(게임 전체를 초기화하지 않는다)
    stage.className = 'game-stage next';
    stage.textContent = '아직 빨간불이야!  이 판은 넘어갈게요';
    rx.skipped++; rx.tries++; $('#reflex-tries').textContent = `시도 ${rx.tries}/3`;
    btn.textContent = '계속하기'; btn.disabled = false;
    if(rx.tries>= 3){ finishReflex(); return; }
    _rxNext = setTimeout(()=>{ if(rx.running) reflexArm(); }, 1000);
    return;
  }
  if(!stage.classList.contains('go')) return;
  const ms = Math.round(performance.now() - rx.armedAt);
  // 방어: 비정상적으로 큰 값(비보호 상태에서의 클릭 등)은 기록하지 않는다.
  // 서버도 99999ms 상한과 '너무 빨랐어' 하한 검증을 함께 쓰므로 이중 안전장치다.
  // ★ 이때 게임을 끝내지 않는다 — 한 판만 건너뛰고 다음 판으로 진행시킨다.
  //   (이전처럼 rx.running=false 로 두면 시도 횟수까지 초기화되어 아이가 좌절한다)
  if(ms <0 || ms> 9000){
    stage.className = 'game-stage next';
    stage.textContent = '아까 누른 것 같아! 이 판은 넘어갈게요';
    rx.skipped++; rx.tries++; $('#reflex-tries').textContent = `시도 ${rx.tries}/3`;
    btn.textContent = '계속하기'; btn.disabled = false;
    if(rx.tries>= 3){ finishReflex(); return; }
    _rxNext = setTimeout(()=>{ if(rx.running) reflexArm(); }, 1000);
    return;
  }
  rx.tries++;
  $('#reflex-tries').textContent = `시도 ${rx.tries}/3`;
  if(rx.best == null || ms <rx.best){ rx.best = ms; $('#reflex-best').textContent = `최고 ${ms}ms`; }
  if(rx.tries>= 3){
    finishReflex();
    return;
  }else{
    // ★ 이전 버전의 버그: 여기서 stage 에 'go' 클래스를 제거한 뒤
    //   rx.running 을 true 로 남겨 두었는데, '계속하기' 를 누르면
    //   reflexClick() 이 'go' 가 아니라는 이유로 즉시 return 하여
    //   버튼이 완전히 죽었다(아무 반응 없음).
    //   해결: 잠시 결과를 보여준 뒤 다음 판을 자동으로 시작하고,
    //   '계속하기' 버튼은 그 대기 중 눌러 즉시 다음 판을 진행시킨다.
    stage.className = 'game-stage next';
    stage.textContent = `${ms}ms! ${1000}ms 후에 다음 판…`;
    btn.textContent = '계속하기'; btn.disabled = false;
    _rxNext = setTimeout(()=>{ if(rx.running) reflexArm(); }, 1000);
  }
}
// ── 기억 순서 ──
// ★ 1단계부터 '기억할 만한' 개수(3개)로 시작해야 한다.
//   1개만 보여주면 기억 게임이 아니라 운 게임이 되어 게임이 성립하지 않는다.
const MEM_BASE_PAD = 2;      // 단계 1 에 보여줄 개수 = 1 + 2 = 3
const MEM_SHOW_MS  = 700;     // 칸 하나를 보여주는 시간(너무 짧으면 따라갈 수 없다)
const mm = { seq:[], input:[], colorOf:[], level:1, running:false };
function openMemory(){
  mm.level = 1; mm.seq = []; mm.input = []; mm.running = false;
  $('#memory-level').textContent = '단계 1';
  $('#memory-best').textContent = '';
  $('#memory-stage').className = 'game-stage seq';
  $('#memory-stage').textContent = '준비...';
  $('#memory-go').textContent = '시작하기';
  $('#memory-go').disabled = false;
  $('#game-memory').classList.remove('hidden');
}
function memShow(){
  const stage = $('#memory-stage');
  // ★ 칸 수는 팔레트 크기를 넘을 수 없다.
  //   show 가 팔레트보다 크면 화면에는 8칸만 나오는데
  //   수열에는 8번 인덱스까지 들어가고, 그 칸은 존재하지 않아
  //   영영 꺼지지 않는다 → 7단계부터 수학적으로 클리어 불가(실측 확인된 버그).
  // ★ 칸 수는 (색 수, 모양 수) 둘 다 넘을 수 없다.
  //   색/모양 중 하나라도 부족하면 구별이 불가능해진다(색각 보조가 무의미해짐).
  const show = Math.min(MEM_COLORS.length, MEM_SHAPES.length, mm.level + MEM_BASE_PAD);
  // ★ 아래 두 가지가 치명적이었다:
  //   (a) 수열이 0,1,2 오름차순 고정 → 아이가 '왼쪽부터 차례로' 누르면 끝
  //   (b) 모든 칸을 한 번에 칠함 → '차례대로 켜지는' 동작 자체가 없음
  //   → 기억 게임이 아니었다.
  // 이제: 칸마다 서로 다른 색을 섞어 배정하고, 0..show-1 을 임의 순서로 섞은 뒤
  //       한 칸씩 MEM_SHOW_MS 동안 켜고 다음 칸으로 넘어간다.
  const palette = MEM_COLORS.slice(0, show);
  for(let i=palette.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [palette[i],palette[j]]=[palette[j],palette[i]];
  }
  mm.colorOf = palette;
  mm.seq = [];
  for(let i=0;i<show;i++) mm.seq.push(i);
  for(let i=mm.seq.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [mm.seq[i],mm.seq[j]]=[mm.seq[j],mm.seq[i]];
  }
  // ★ V5: 색각 보조(색만으로 구분할 때 필요한 도형 단서).
//   색만 구분하면 적록색약이 있는 아이(남학생 약 8%)는 이 게임을 못 한다.
//   그래서 각 칸에 '모양'을 함께 입힌다. 색 + 모양 이중 단서이므로
//   어느 한쪽을 못 알아도 나머지로 구별할 수 있다.
//   (모양은 유니코드 기호 문자열 — 이미지 에셋 없이 CSS 없이 동작한다)
// ★ V5-b: 모양은 '칸 수'보다 적으면 안 된다.
//   예전엔 8개짜리 배열을 % 8 로 돌려 써서, 7단계(9칸)부터 ●가 두 번 등장했다.
//   색각 보조의 목적이 '색 못 보는 아이가 구분하는 것' 인데,
//   같은 모양이 겹치면 그 아이에게 오히려 더 혼란 → 접근성 기능이 무의미해진다.
//   그래서 12개(최대 칸 수)를 확보하고, 그래도 부족하면 칸 수 자체를 줄인다.
const MEM_SHAPES = ['●','▲','■','◆','★','','▶','◀','◉','△','▽',''];
  // 칸마다 서로 다른 모양 배정(색과 같은 방식으로 섞는다)
  mm.shapeOf = mm.colorOf.map((_, i)=>MEM_SHAPES[i % MEM_SHAPES.length]);
  // 각 칸 안에 모양 span 을 넣는다. 'showing' 동안만 보이며, 입력 단계에서는 숨겨진다
  // → 아이가 '몇 번째 칸인지' 를 위치로 외우는 것을 막는다.
  stage.innerHTML = mm.colorOf.map((c,i)=>
    `<i class="pad"><b class="sym">${mm.shapeOf[i]}</b></i>`).join('');
  stage.classList.remove('input');
  stage.classList.add('showing');
  $('#memory-level').textContent = `단계 ${mm.level} · ${show}칸`;
  const pads = [...stage.querySelectorAll('.pad')];
  let k = 0;
  const step = ()=>{
    if(k> 0){ const prev = pads[mm.seq[k-1]]; if(prev){ prev.style.background = ''; prev.classList.remove('lit'); } }
    if(k>= mm.seq.length){
      stage.classList.remove('showing');
      stage.classList.add('input');
      mm.input = [];
      return;
    }
    const cur = pads[mm.seq[k]];
    if(cur){ cur.style.background = mm.colorOf[mm.seq[k]]; cur.classList.add('lit'); }
    k++;
    _mmTimer = setTimeout(step, MEM_SHOW_MS);
  };
  _mmTimer = setTimeout(step, MEM_SHOW_MS);
}
function memPick(i){
  if(!mm.running) return;
  const stage = $('#memory-stage');
  if(stage.classList.contains('showing')) return;    // 보여주는 중엔 입력 불가
  // ★ 이미 이번 판을 다 맞힌 상태면 더 받지 않는다.
  //   정답 후 620ms 안에 연타하면 mm.input 이 길어져
  //   mm.seq[나머지] === undefined 비교가 항상 실패 → 방금 이긴 판이 실패로 바뀐다.
  //   아이들은 연타가 많으므로 반드시 막아야 한다.
  if(mm.input.length>= mm.seq.length) return;
  const pads = stage.querySelectorAll('.pad');
  // V5: 클릭한 칸은 색뿐 아니라 모양도 함께 보여준다(색각 보조)
  if(pads[i]){ pads[i].style.background = mm.colorOf[i]; pads[i].classList.add('lit'); }
  mm.input.push(i);
  const n = mm.input.length;
  // 즉시 판정(위치와 위치 비교 → 값 범위가 일치하므로 반드시 성립한다)
  if(mm.input[n-1] !== mm.seq[n-1]){ memFail(n-1); return; }
  if(n === mm.seq.length){
    // 다음 판이 시작되기 전에 입력을 비운다(연타 대비)
    mm.input = [];
    mm.level++;
    if(mm.level>= MEM_MAX_LEVEL){
      mm.running = false;
      stage.classList.remove('input');
      stage.innerHTML = ' 완성!';
      $('#memory-level').textContent = `${MEM_MAX_LEVEL}단계 도달!`;
      $('#memory-go').textContent = '결과 제출 중...'; $('#memory-go').disabled = true;
      submitGameResult('memory', { level: MEM_MAX_LEVEL }, $('#memory-go'));
      return;
    }
    $('#memory-level').textContent = `단계 ${mm.level}`;
    setTimeout(memShow, 620);
  }
}
function memFail(i){
  SFX.wrong();
  mm.running = false;
  const stage = $('#memory-stage');
  stage.classList.add('input');
  stage.classList.remove('showing');
  const pads = stage.querySelectorAll('.pad');
  if(pads[i]) pads[i].style.background = '#ff8787';
  // ★ 정답을 함께 보여준다 — '틀렸다' 만으로는 아이가 배우지 못한다.
  //   틀린 칸은 빨강 테두리, 나머지는 실제 색으로 잠깐 공개해 주어 답을 기억하게 한다.
  //   V5: 모양도 함께 표시(색 못 보는 아이가 '기억한 순서' 를 확인하게 해준다)
  const answer = mm.seq.map((_, k)=>
    `<i class="pad${k===i?' wrong':''} lit" style="background:${mm.colorOf[k]}"><b class="sym">${mm.shapeOf[k]||''}</b></i>`).join('');
  stage.innerHTML = answer +
    `<div class="fail">앗! ${i+1}번째부터 달라요 <br>` +
    `도달 단계 ${mm.level} · 다음에 다시 도전해 볼래요?</div>`;
  $('#memory-go').textContent = '다시 도전'; $('#memory-go').disabled = false;
  if(mm.level>= 3) submitGameResult('memory', { level: mm.level }, $('#memory-go'));
}

// 미니게임 버튼 연결
$("#btn-reflex").addEventListener("click", openReflex);
$("#btn-memory").addEventListener("click", openMemory);
$("#reflex-go").addEventListener("click", ()=>{
  const stage = $('#reflex-stage'), btn = $('#reflex-go');
  if(!rx.running){
    // 게임 시작(또는 '아직 빨간불'/'기록 이상' 후 재시작)
    rx.running = true; rx.tries = 0;
    $('#reflex-tries').textContent = '시도 0/3';
    btn.textContent = '지금 누르기!';
    reflexArm();
    return;
  }
  // 다음 판 대기 중이면 예약된 타이머를 취소하고 즉시 시작한다
  if(stage.classList.contains('next')){
    clearTimeout(_rxNext); _rxNext = null;
    btn.textContent = '지금 누르기!';
    reflexArm();
    return;
  }
  reflexClick();
});
$("#memory-go").addEventListener("click", ()=>{
  if(!mm.running){ mm.running=true; mm.level=1; $("#memory-level").textContent="단계 1"; memShow(); }
  else { mm.running=false; $("#memory-go").textContent="시작하기"; $("#memory-go").disabled=false; memShow(); }
});
// 반사 속도: 스테이지 클릭으로도 눌러볼 수 있게 한다(버튼만 보면 못 알아듣는 아이용)
$('#reflex-stage').addEventListener('click', ()=>{ if(!$('#reflex-go').disabled) $('#reflex-go').click(); });
// 기억 게임 패드 클릭 위임
$("#memory-stage").addEventListener("click", (e)=>{
  const pad = e.target.closest(".pad"); if(!pad) return;
  const all = [...$("#memory-stage").querySelectorAll(".pad")];
  memPick(all.indexOf(pad));
});
// 부모 승인 게이트 버튼 (P0-4)
$("#gate-ok").addEventListener("click", verifyParent);
$("#gate-a").addEventListener("keydown", e=>{ if(e.key==="Enter"){ e.preventDefault(); verifyParent(); } });
$("#overplay-parent").addEventListener("click", openParentGate);
$("#overplay-ok").addEventListener("click", ()=>{
  // 오늘은 여기서 끝내되, 데이터는 지우지 않는다(내일 이어서 놀 수 있게)
  stopPlayTimer();
  $('#overplay').classList.add('hidden');
  show('start');
});
// 닫기 버튼 + ESC
// ★ 반드시 쿼리SelectorAll 을 써야 한다. querySelector 는 첫 요소 하나만
//   반환하므로 .forEach 에서 TypeError 가 나고 바인딩이 아예 실행되지 않아
//   두 게임의 닫기 버튼이 모두 먹통이 된다.
$$("[data-close]").forEach(b=>b.addEventListener("click", ()=>closeGame(b.dataset.close)));
// 안전망: 모달 배경(바깥 영역)을 클릭해도 닫히도록 — ✕ 를 못 찾거나 못 눌러도 탈출 가능
$$('.modal').forEach(m=>{
  if(m.id === 'preview-modal' || m.id === 'modal') return;   // 기존 모달은 별도 처리
  m.addEventListener('click', e=>{ if(e.target === m) closeGame(m.id); });
});
document.addEventListener("keydown", e=>{ if(e.key==="Escape"){ closeGame("game-reflex"); closeGame("game-memory"); } });
// ---------- 상점 ----------
const ITEM_KIND = { part:'로봇 부품', decor:'방 장식', skin:'색칠 스킨', shard:'부품 조각' };
async function loadShop(){
  const items = await api('/api/items');
  // 등급: 가격대별 표시(아이에게 "레벨"처럼 보이게) + 보유 여부 배지
  const tier = p => p>=100 ? { label:'EPIC', cls:'t-epic' } : p>=70 ? { label:'RARE', cls:'t-rare' } : { label:'NORMAL', cls:'t-normal' };
  $('#shop-list').innerHTML = items.map(it=>{
    const t = tier(it.price);
    // ★ P1-4 소비 가능 아이템(skin/shard)은 반복 구매 가능 → '보유 중' 으로 잠그지 않는다
    const repeatable = !!it.consumable;
    const owned = !repeatable && (state.parts.includes(it.name) || state.decors.includes(it.name));
    const kind = ITEM_KIND[it.type] || '아이템';
    // ★ V11 주말 한정: 오늘이 판매일이 아니면 '잠금' 상태로 보여준다.
    //   숨기지 않고 보여줘야 "주말에 다시 오자"는 예고가 된다.
    const locked = it.available === false;
    return `<div class="item-card ${t.cls}${owned?' owned':''}${locked?' locked':''}">
      <div class="em">${ITEM_EMOJI[it.name]||''}</div>
      ${owned?'<span class="owned-badge">보유 </span>':''}
      ${locked?'<span class="owned-badge weekend"> 주말 한정</span>':(repeatable?'<span class="owned-badge repeat">반복 구매 가능</span>':'')}
      <span class="tier ${t.cls}">${t.label}</span>
      <div class="nm">${esc(it.name)}</div>
      <div class="kind">${esc(kind)}</div>
      <div class="price"> ${it.price}</div>
      ${locked?'<div class="lock-hint">토·일요일에만 살 수 있어요</div>':''}
      <div class="btn-row">
        ${(it.type==='skin'||it.type==='shard'||locked)?'':`<button class="btn ghost" data-preview="${it.id}">미리보기</button>`}
        <button class="btn primary" data-buy="${it.id}" ${(owned||locked)?'disabled':''}>${locked?'주말 한정':(owned?'보유 중':'구매')}</button>
      </div></div>`;
  }).join('');
  $$('#shop-list [data-buy]').forEach(b=>b.addEventListener('click', async ()=>{
    // ★ 진행 중 방어(V2-10): 소지품은 서버가 409 로 막지만
    //   소비품(skin/shard)은 연속 클릭이 그대로 두 번 결제된다.
    if(b.disabled) return;
    b.disabled = true;
    const old = b.textContent;
    b.textContent = '구매 중…';
    try{ await buyItem(b.dataset.buy); }
    catch(e){ alert(e.message); }
    finally{ b.disabled = false; b.textContent = old; }
  }));
  $$('#shop-list [data-preview]').forEach(b=>b.addEventListener('click', ()=>{
    const it = items.find(x=>x.id==b.dataset.preview); if(it) openPreview(it);
  }));
  await loadShardTargets();   // 교환 목표(부품별 필요 조각 수) 로드
  renderOwned();   // 하단 '내 부품함' 갱신
}
// 구매 공통 처리 (상점 + 미리보기에서 재사용)
async function buyItem(itemId){
  const r = await api('/api/shop/buy',{itemId});
  state.user.cell_balance = r.balance; setBalance(r.balance);
  // ★ P0-1 장식/스킨도 즉시 상태에 반영(마이룸 '보유 장식' 목록이 곧바로 갱신되도록)
  try{
    const jr = await api('/api/robots/me');
    const beforeDecors = (state.decors||[]).join(',');
    const beforeSkins  = (state.skins||[]).join(',');
    absorbRobotMe(jr);
    const decorChanged = beforeDecors !== (state.decors||[]).join(',');
    // ★ 스킨은 effectiveColors 를 통해 로봇 색에 반영된다 → 재빌드 대상
    const skinChanged  = beforeSkins  !== (state.skins||[]).join(',');
    if(bjs.ready && state.robot){
      // 장식은 방(소품) 레벨 오브젝트라 로봇만 갱신하면 안 된다 → 방 장식만 재배치
      if(decorChanged) rebuildRoomDecor();
      if(decorChanged || skinChanged) rebuildRobot(state.robot);
    }
    // ★ V9: 부품을 사면 과제 보너스가 오른다 → 수치를 다시 읽어 배지에 즉시 반영
    await refreshGrowth();
    if($('#screen-myroom') && !$('#screen-myroom').classList.contains('hidden')) renderMyroom();
    renderOwned();   // 구매 즉시 '내 부품함' 갱신
    if($('#screen-shop') && !$('#screen-shop').classList.contains('hidden')) loadShop();
  }catch(e){}
  return r;
}

// ---------- 부품 미리보기 (mini 3D) ----------
let previewEngine = null;
function closePreview(){
  $('#preview-modal').classList.add('hidden');
  if(previewEngine){ previewEngine.dispose(); previewEngine=null; }
}
function openPreview(item){
  const robot = state.robot || { template:'doro', palette:{} };
  const info = PART_INFO[item.name];
  $('#preview-title').textContent = `${ITEM_EMOJI[item.name]||''} ${item.name}`;
  $('#preview-desc').textContent = info ? info.desc : (item.type==='decor' ? '방을 꾸미는 장식품이에요.' : '');
  const owned = state.parts.includes(item.name);
  const buy = $('#preview-buy');
  buy.dataset.buy = item.id;
  if(owned){ buy.textContent='보유 중 '; buy.disabled=true; }
  else { buy.textContent=`구매하기  ${item.price}`; buy.disabled=false; }
  $('#preview-modal').classList.remove('hidden');
  // 장식은 로봇 없이 상품만 크게 전시(무엇을 사는지 명확히)
  const solo = item.type==='decor';
  setTimeout(()=>{ try{ buildPreviewScene($('#preview-canvas'), robot, [item.name], solo); }catch(e){ console.error('[preview]', e); } }, 60);
}
function buildPreviewScene(canvas, robot, parts, solo){
  if(previewEngine){ previewEngine.dispose(); previewEngine=null; }
  const engine = new BABYLON.Engine(canvas, true, {preserveDrawingBuffer:true, adaptToDeviceRatio:true});
  previewEngine = engine;
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.863,0.918,0.988,1);
  const cam = new BABYLON.ArcRotateCamera('pcam', Math.PI/2, Math.PI/2.6, 6.5, new BABYLON.Vector3(0,1.3,0), scene);
  cam.lowerRadiusLimit=4.5; cam.upperRadiusLimit=10;
  if(solo){ cam.radius = 3.2; cam.beta = Math.PI/3.1; cam.lowerRadiusLimit = 1.8; cam.upperRadiusLimit = 6.5; }
  const { dir, hemi } = createRoomBase(scene, solo
    ? { props:false, dust:false, bare:true }     // 장식 단독 전시: 벽·러그 없이 깔끔한 배경
    : { props:false, dust:false });              // 부품: 방 골격 유지(착용감)
  const root = new BABYLON.TransformNode('proot', scene);
  const bob = new BABYLON.TransformNode('pbob', scene); bob.parent=root;
  // solo(장식)에서는 model 을 bob 아래에 두지 않고 root 직속에 붙인다
  // → 상품이 원점에서 떨어져 있어도 root 회전 시 공전하지 않음
  const model = new BABYLON.TransformNode('pmodel', scene); model.parent = solo ? root : bob;
  tryLoadEnvironment(scene).then(ok=>{
    if(previewEngine !== engine) return; // 닫힌 후 늦게 도착 → 무시
    const factory = makeMatFactory(scene, ok);
    if(ok){ hemi.intensity = 0.3; dir.intensity = 0.6; }
    try{
      const pipe = new BABYLON.DefaultRenderingPipeline('ppr', true, scene, [cam]);
      pipe.fxaaEnabled = true;
      pipe.imageProcessing.toneMappingEnabled = false;   // 색 왜곡 방지
      pipe.imageProcessing.exposure = 1.0; pipe.imageProcessing.contrast = 1.0;
    }catch(e){ new BABYLON.FxaaPostProcess('fxaa', 1.0, cam); }
    const refs = buildRobotModel(scene, model, effectiveColors(robot.template, robot.palette), robot.template, parts, factory, curStage());
    // solo(장식): 로봇 몸통·얼굴을 숨기고 부품만 남겨 상품에 집중
    const shown = [];
    model.getChildMeshes(false).forEach(m=>{
      const isPart = !!(m.metadata && m.metadata.part);
      m.isVisible = solo ? isPart : true;
      if(solo && isPart) shown.push(m);
    });
    if(solo && shown.length){
      // 부품별로 좌표가 박혀 있으므로, 로컬 좌표를 직접 보정해 원점 기준으로 recenter
      // (월드 행렬이 아직 갱신되지 않았으므로 position 값을 그대로 계산한다)
      let mnx=1e9,mnz=1e9,mny=1e9,mxx=-1e9,mxz=-1e9,mxy=-1e9;
      shown.forEach(m=>{
        const bi=m.getBoundingInfo().boundingBox;
        // 로컬 위치 + 로컬 반경(월드 스케일 1 가정)으로 대략적인 로컬 경계 계산
        const ext=bi.maximum.subtract(bi.minimum);
        mnx=Math.min(mnx,m.position.x-ext.x); mxx=Math.max(mxx,m.position.x+ext.x);
        mny=Math.min(mny,m.position.y-ext.y); mxy=Math.max(mxy,m.position.y+ext.y);
        mnz=Math.min(mnz,m.position.z-ext.z); mxz=Math.max(mxz,m.position.z+ext.z);
      });
      const ox=(mnx+mxx)/2, oz=(mnz+mxz)/2;
      const rad=Math.max(0.42, Math.max(mxx-mnx, mxy-mny, mxz-mnz)/2);
      // 원점 recenter + 바닥 장식은 받침대 위(y=0.1)로
      // 공중 장식(별)은 떠 있는 상품 → 받침대 숨김
      const isFloat = shown.some(m=>m.name.indexOf('star')===0);
      const ped = scene.getMeshByName('pedestal');
      if(isFloat && ped) ped.setEnabled(false);
      let lift = 0;
      if(mny <0.3) lift = 0.1 - mny;              // 바닥 장식 → 받침대 위
      else if(mny> 0.6) lift = 0.42 - mny;          // 공중 장식(별) → 눈높이 중앙
      shown.forEach(m=>{ m.position.x -= ox; m.position.z -= oz; m.position.y += lift; });
      // 별 스티커는 납작한 다면체라 recenter 후 옆면이 카메라를 향할 수 있다 → 정면으로 회전
      const cy = (mny+mxy)/2 + lift;
      cam.setTarget(new BABYLON.Vector3(0, cy, 0));
      cam.radius = rad*4.6 + 1.0;
      cam.lowerRadiusLimit = cam.radius*0.5; cam.upperRadiusLimit = cam.radius*2.5;
    }
    applyShadow(scene, dir, model);
    // 드래그 회전
    let drag=false, lx=0;
    scene.onPointerObservable.add(p=>{
      if(p.type===BABYLON.PointerEventTypes.POINTERDOWN){ drag=true; lx=p.event.clientX; }
      else if(p.type===BABYLON.PointerEventTypes.POINTERMOVE && drag){ const dx=p.event.clientX-lx; lx=p.event.clientX; root.rotation.y += dx*0.012; }
      else if(p.type===BABYLON.PointerEventTypes.POINTERUP){ drag=false; }
    });
    scene.onBeforeRenderObservable.add(()=>{
      const t = performance.now()*0.001;
      if(solo){
        // 납작한 장식(별 등)은 자동 회전 시 옆면만 보여 곤란 → 정면 고정 + 미세 흔들림만
        root.rotation.y = 0.18 + Math.sin(performance.now()*0.0006)*0.06;
        bob.position.y = 0;
        return;
      }
      bob.position.y=Math.sin(t*2)*0.03;
      updateIdle(refs, t, 0);
    });
  });
  canvas.addEventListener('contextmenu', e=>e.preventDefault());
  engine.runRenderLoop(()=>scene.render());
  setTimeout(()=>engine.resize(), 60);
}
// 미리보기 모달 바인딩 (1회)
$('#preview-close').addEventListener('click', closePreview);
$('#preview-modal').addEventListener('click', e=>{ if(e.target.id==='preview-modal') closePreview(); });
$('#preview-buy').addEventListener('click', async ()=>{
  if($('#preview-buy').disabled) return;
  try{ await buyItem($('#preview-buy').dataset.buy);
    $('#preview-buy').textContent='보유 중 '; $('#preview-buy').disabled=true;
  }catch(e){ alert(e.message); }
});

// ---------- 리포트 ----------
async function loadBoard(){
  const j = await api('/api/board/me');
  const s = j.stats;
  const srcMap = {welcome:'가입 보너스', robot_create:'로봇 제작 보상', daily_quest:'오늘의 과제',
                  shop:'부품 구매', streak:'연속 방문 보상', game:'미니게임 보상'};
  // ★ 각 지표에 '실시간/누적/평균' 라벨을 붙인다.
  //   수치만 나열되면 사용자가(=기업 심사자가) 지표를 해석할 수 없다.
  $('#board-stats').innerHTML = `
    <div class="stat hi"><b>${esc(s.returnRate)}%</b><span>재접속률</span>
      <span class="tagline">누적 ${esc(s.activeDays)}일 중 ${esc(Math.max(0,s.activeDays-1))}일 재방문</span></div>
    ${s.streak?`<div class="stat"><b> ${esc(s.streak)}일</b><span>현재 연속</span>
      <span class="tagline">최대 기록은 계속 쌓여요</span></div>`:''}
    <div class="stat"><b>Lv.${esc(s.level)}</b><span>현재 레벨</span>
      <span class="tagline">${esc(s.exp)}/${esc(s.expNeeded)} XP</span></div>
    <div class="stat"><b>${esc(s.balance)}</b><span>셀 잔액</span>
      <span class="tagline">지금 가진 재화</span></div>
    <div class="stat"><b>${esc(s.activeDays)}일</b><span>활동 일수</span>
      <span class="tagline">기간 중 접속한 날</span></div>
    <div class="stat"><b>${esc(s.playMinutes)}분</b><span>총 체류시간</span>
      <span class="tagline">누적 ${esc(s.returnSpanDays)}일 기준</span></div>
    <div class="stat"><b>${esc(s.avgMinutes)}분</b><span>일당 평균</span>
      <span class="tagline">평균 체류시간</span></div>
    <div class="stat"><b>${esc(s.visitCount)}회</b><span>총 접속 횟수</span>
      <span class="tagline">마이룸 방문 누적</span></div>
    <div class="stat"><b>${esc(s.questDone)}개</b><span>과제 완료</span>
      <span class="tagline">오늘의 과제 포함</span></div>
    <div class="stat"><b>+${esc(s.txIn)}</b><span>획득한 셀</span>
      <span class="tagline">재화 유입</span></div>
    <div class="stat"><b>-${esc(Math.abs(s.txOut))}</b><span>사용한 셀</span>
      <span class="tagline">재화 유출</span></div>`;
  // 최근 7일 접속 추이(막대 그래프)
  const daily = j.daily || [];
  const maxV = Math.max(1, ...daily.map(d=>d.visits));
  $('#board-trend').innerHTML = daily.length
    ? daily.map(d=>{
        const h = Math.round(d.visits / maxV * 62) + 3;
        const min = Math.round((d.secs||0)/60);
        const wd = ['일','월','화','수','목','금','토'][(new Date(d.d).getDay())];
        return `<div class="col" title="${esc(d.d)} · ${min}분 체류">
          <span class="cnt">${esc(d.visits)}</span>
          <div class="bar${d.visits?'':' empty'}" style="height:${h}px"></div>
          <span class="lbl">${esc(String(new Date(d.d).getDate()))}일(${wd})</span>
        </div>`;
      }).join('')
    : '<div class="trend-empty">아직 접속 기록이 없어요.</div>';
  $('#tx-table tbody').innerHTML = j.txs.map(t=>
    `<tr><td>${esc(srcMap[t.source]||t.source)}</td>
     <td class="${t.amount>=0?'plus':'minus'}">${t.amount>=0?'+':''}${esc(t.amount)}</td>
     <td>${esc(t.ts)}</td></tr>`).join('') || '<tr><td colspan="3" class="tx-empty">아직 기록이 없어요</td></tr>';
}

// ★ 마이룸 하단 '오늘의 진행 단계' — 아이가 지금 무엇을 해야 하는지 한눈에 알 수 있게 한다.
//   4단계(간식 → 칭찬 → 과제 → 게임) 중 어디까지 했는지 표시한다.
function renderSteps(){
  const box = $('#room-steps');
  if(!box) return;
  const done = new Set((state.quests.done||[]).map(Number));
  const st = [];
  state.quests.list.forEach(q=>{ if(q.type==='feed')   st.push({k:'feed',   t:'간식 주기', d:done.has(q.id)}); });
  state.quests.list.forEach(q=>{ if(q.type==='praise') st.push({k:'praise', t:'칭찬하기', d:done.has(q.id)}); });
  state.quests.list.forEach(q=>{ if(q.type==='ai_mission') st.push({k:'quest', t:'AI 과제', d:done.has(q.id)}); });
  st.push({k:'game', t:'미니게임', d:false});
  const cur = st.findIndex(x=>!x.d);
  const tip = cur === -1 ? '오늘 할 일을 다 했어요! ' : null;
  box.innerHTML = st.map((x,i)=>
    `<span class="st ${x.d?'done':(i===cur?'now':'')}">
       <span class="dot">${x.d?'✓':i+1}</span>${esc(x.t)}
     </span>${i<st.length-1?'<span class="arrow">›</span>':''}`).join('')
    + (tip ? `<span class="tip">${esc(tip)}</span>` : '');
}

// ★ 상점 하단 '내 부품함' — 규격(wireframe)에 있는 인벤토리 영역
function renderOwned(){
  const box = $('#shop-owned');
  if(!box) return;
  const qty = state.itemQty || {};
  const list = [
    ...state.parts.map(n=>({ n, kind:'로봇 부품' })),
    ...state.decors.map(n=>({ n, kind:'방 장식' })),
    ...state.skins.map(n=>({ n, kind:'색칠 스킨' })),
    ...state.shards.map(n=>({ n, kind:'부품 조각' })),
  ];
  if(!list.length){ box.innerHTML = '<div class="none">아직 구매한 부품이 없어요. 과제를 완료하면 셀을 모을 수 있어요!</div>'; return; }
  box.innerHTML = list.map(o=>{
    const q = qty[o.n] || 1;
    // 수량이 2개 이상이면 배지로 표시한다(V2-10).
    // 소비품을 여러 번 사도 '몇 개나 갖고 있는지' 가 안 보이면
    // 두 번 결제된 사실을 아이가 알아채기 어렵다.
    const qtyBadge = q> 1 ? `<span class="qty">×${q}</span>` : '';
    return `<div class="own"><span class="em">${ITEM_EMOJI[o.n]||''}</span>
      <span class="nm">${esc(o.n)}</span><span class="kind">${esc(o.kind)}</span>${qtyBadge}</div>`;
  }).join('');
  // 부품 조각 교환 진행도 + 교환 UI(V2-1)
  // ★ V4: 부품마다 필요한 조각 수가 다르다(가격 비례).
  //   예전엔 '3개면 아무 부품이나 교환' 이라 로켓 부스터를 절반 값에 살 수 있었다.
  const sp = state.shardProgress;
  if(sp && sp.have> 0){
    const targets = (state.shardTargets||[]);
    // 현재 조각 수로 교환 가능한 부품만 고른다
    const affordable = targets.filter(t=>sp.have>= t.need);
    box.insertAdjacentHTML('beforeend', `
      <div class="own shard-box">
        <span class="em"></span>
        <span class="nm">부품 조각 ${sp.have}개</span>
        <div class="ex-list">
          ${targets.length ? targets.map(t=>{
            const ok = sp.have>= t.need;
            return `<button class="ex-item ${ok?'':'off'}" data-ex="${t.id}" ${ok?'':'disabled'}>
              <span class="nm">${esc(t.name)}</span>
              <span class="cost">조각 ${t.need}개</span>
              <span class="org">정가 ${t.price}셀</span>
            </button>`;
          }).join('') : `<span class="ex-hint">${sp.have}/${sp.need} 개 모으면 부품으로 교환</span>`}
        </div>
      </div>`);
  }
  $$('#shop-owned .ex-item').forEach(b=>b.addEventListener('click', async ()=>{
    if(b.disabled) return;
    b.disabled = true;
    try{
      const r = await api('/api/shop/exchange', { partId:Number(b.dataset.ex) });
      bubble(` 조각 ${r.used}개로 [${r.part}] 을 만들었어!`);
      const jr = await api('/api/robots/me');
      absorbRobotMe(jr);
      await api('/api/shop/exchange-info').then(info=>{
        state.shardTargets = info.targets||[];
        if(info.need) state.shardProgress = { have: info.have, need: info.need };
      }).catch(()=>{});
      await refreshGrowth();     // ★ V9: 교환으로 늘어난 부품도 보너스에 반영
      if(bjs.ready && state.robot) rebuildRobot(state.robot);
      renderOwned();
      setBalance(r.balance);
    }catch(e){ alert(e.message); b.disabled = false; }
  }));
  const ex = $('#btn-exchange');
  if(ex) ex.addEventListener('click', async ()=>{
    // V4: 개별 부품 버튼(#shop-owned .ex-item)으로 대체되었다.
    // 이 단일 버튼 경로는 '가장 싼 부품' 교환용으로만 남겨 둔다.
    if(ex.disabled) return;
    ex.disabled = true; ex.textContent = '교환 중…';
    try{
      const r = await api('/api/shop/exchange', { partId: 0 });
      bubble(` 조각 ${r.used}개로 [${r.part}] 을 만들었어!`);
      const jr = await api('/api/robots/me');
      absorbRobotMe(jr);
      await loadShardTargets();
      await refreshGrowth();     // ★ V9: 교환으로 늘어난 부품도 보너스에 반영
      if(bjs.ready && state.robot) rebuildRobot(state.robot);
      renderOwned();
      setBalance(r.balance);
    }catch(e){ alert(e.message); ex.disabled=false; ex.textContent='다시 시도'; }
  });
}
// 부품 조각 교환 목표 목록(가격 비례 필요 개수)을 서버에서 가져온다
async function loadShardTargets(){
  try{
    const info = await api('/api/shop/exchange-info');
    state.shardTargets = info.targets || [];
    if(info.need) state.shardProgress = { have: info.have, need: info.need };
  }catch(e){ state.shardTargets = []; }
}

// 초기화: 계정 지우고 처음 화면으로 (데모/재시작용)
// ★ P0-4 서버에서도 내 계정 데이터를 실제로 삭제한다(개인정보 리셋).
// ---------- 3D 리소스 해제 ----------
// ★ V3: 주 엔진(마이룸)이 한 번도 dispose 된 적이 없었다.
//   재접속으로 canvas 를 다시 만들면 이전 Engine/장면/타이머가 남는다.
//   previewEngine 처럼 여기도 명시적으로 정리한다.
function disposeRoom3D(){
  if(bjs.wanderTimer){ clearInterval(bjs.wanderTimer); bjs.wanderTimer = null; }
  if(bjs.engine){
    try{ bjs.engine.stopRenderLoop(); }catch(e){}
    try{ bjs.engine.dispose(); }catch(e){}
  }
  if(bjs.scene){ try{ bjs.scene.dispose(); }catch(e){} }
  bjs = { engine:null, scene:null, root:null, bob:null, model:null, ready:false, _t:0, wanderTimer:null, _starting:false };
}
// 페이지를 벗어날 때(새로고침/탭 종료 전) 남은 자원을 정리
addEventListener('pagehide', ()=>{ try{ disposeRoom3D(); }catch(e){} });
addEventListener('beforeunload', ()=>{ try{ if(bjs.wanderTimer) clearInterval(bjs.wanderTimer); }catch(e){} });

$('#btn-reset').addEventListener('click', async ()=>{
  if(!confirm('처음부터 다시 시작할까요? (현재 계정 정보가 DB에서도 지워져요)')) return;
  try{ await api('/api/user/delete', {}); }catch(e){ /* 서버 삭제 실패해도 로컬은 정리 */ }
  localStorage.removeItem(SK.uid); localStorage.removeItem(SK.nick); localStorage.removeItem(SK.token);
  location.reload();
});

// ★ V4 데모 계정 버튼: 7일치 성장 데이터가 채워진 계정으로 즉시 전환(발표용)
$('#btn-demo').addEventListener('click', async ()=>{
  const b = $('#btn-demo');
  b.disabled = true; b.textContent = '데모 계정 만드는 중…';
  try{
    // ★ V5-b: 고정 닉네임 하나만 쓴다.
    //   예전엔 '시연_' + Date.now() 로 매번 새 계정을 만들었는데,
    //   그 계정들은 아무도 다시 쓰지 않으면서 통계 분모를 늘리고
    //   (재접속률 86% → 17%), /api/admin/stats 가 쓰레기 데이터로 가득 찼다.
    //   seed 가 '데모_루미' 를 멱등하게 재사용하므로 여기도 같은 이름만 쓴다.
    const DEMO_NICK = '데모_루미';
    const j = await api('/api/user', { nickname: DEMO_NICK });
    state.user = j.user; state.quests = j.quests;
    if(j.user.token) localStorage.setItem(SK.token, j.user.token);
    localStorage.setItem(SK.uid, j.user.id);
    localStorage.setItem(SK.nick, DEMO_NICK);
    // 시드 생성 → 새 토큰 반환
    const r = await api('/api/demo/seed', {});
    localStorage.setItem(SK.token, r.token);
    localStorage.setItem(SK.nick, r.nickname);
    // 시드가 만든 계정 정보를 다시 읽어 화면에 반영
    const u2 = await api('/api/user', { nickname: r.nickname });
    state.user = u2.user; state.quests = u2.quests || state.quests;
    if(u2.user.token) localStorage.setItem(SK.token, u2.user.token);
    if(j.streakBonus) setTimeout(()=> bubble(` ${j.streakBonus}일 연속 방문 보상 +${j.streakBonus}셀!`), 800);
    startPlayTimer();
    await enter();
    setTimeout(()=> bubble(' 데모 계정 · 최근 7일 성장 기록을 준비했어요'), 1400);
  }catch(e){ alert(e.message); }
  finally{ b.disabled = false; b.textContent = ' 데모 계정으로 바로 보기'; }
});

// ---------- 자랑하기 (3D 화면을 그림으로 저장) ----------
// 자체 2-셀흐름도에 '전시·자랑' 단계가 있는데 구현이 없었다.
// 아이가 자기 로봇을 부모님·친구에게 보여줄 수 있게 한다(서버 불필요).
$('#btn-share').addEventListener('click', ()=>{
  const cv = $('#room3d');
  if(!bjs.ready || !cv || !bjs.scene){ alert('3D 로봇이 다 만들어지면 자랑할 수 있어요!'); return; }
  try{
    bjs.scene.render();                                  // 방금 그린 프레임 보장
    const url = cv.toDataURL('image/png');                // preserveDrawingBuffer:true 라 가능
    const r = state.robot || {};
    const g = state.growth || {};
    $('#share-img').src = url;
    $('#share-save').href = url;
    $('#share-save').download = `루미_${r.name || '로봇'}.png`;
    $('#share-title').textContent = `${r.name || '내 로봇'} · Lv.${g.level || 1} ${g.stageLabel || ''}`;
    $('#share-desc').textContent = `${r.personality || ''} · ${(state.parts || []).length}개 부품`;
    $('#share-modal').classList.remove('hidden');
    SFX.correct();
  }catch(e){ console.error('[share]', e); alert('자랑 카드를 만들지 못했어요 '); }
});
$('#share-close').addEventListener('click', ()=> $('#share-modal').classList.add('hidden'));
$('#share-modal').addEventListener('click', e=>{ if(e.target.id==='share-modal') $('#share-modal').classList.add('hidden'); });

// ---------- 오늘의 랭킹 ----------
// '1등'이라는 목표와 '자랑하고 싶다'는 동기를 만든다(실제 플랫폼도 타자게임 1등 보상이 있다).
async function openRank(){
  $('#rank-modal').classList.remove('hidden');
  $('#rank-body').innerHTML = '<div class="none">불러오는 중…</div>';
  try{
    const r = await api('/api/rank/daily');
    const block = (title, emoji, data, fmt)=>{
      const rows = (data.rows || []).map(x=>
        `<div class="rk-row${x.me?' me':''}"><b>${x.rank}</b><span class="rk-name">${esc(x.name)}</span><span class="rk-score">${esc(fmt(x.score))}</span></div>`
      ).join('') || '<div class="none">아직 기록이 없어요. 첫 1등이 되어보세요!</div>';
      const mine = (data.myScore != null)
        ? `<div class="rk-mine">내 기록 ${esc(fmt(data.myScore))}${data.myRank?` · ${data.myRank}위`:''}</div>`
        : `<div class="rk-mine">오늘은 아직 안 했어요 — 도전해 볼까요?</div>`;
      return `<div class="rk-block"><h4>${emoji} ${title}</h4>${rows}${mine}</div>`;
    };
    $('#rank-body').innerHTML =
      block('반사 속도', '', r.reaction, s=>`${s}ms`) +
      block('기억 순서', '', r.memory, s=>`${s}단계`) +
      `<div class="rk-note">${esc(r.note || '')}</div>`;
  }catch(e){ $('#rank-body').innerHTML = '<div class="none">랭킹을 불러오지 못했어요</div>'; }
}
$('#btn-rank').addEventListener('click', openRank);
$('#rank-close').addEventListener('click', ()=> $('#rank-modal').classList.add('hidden'));
$('#rank-modal').addEventListener('click', e=>{ if(e.target.id==='rank-modal') $('#rank-modal').classList.add('hidden'); });

// ---------- 첫 실행 온보딩 ----------
// 실제 DOROBUS 는 첫 로그인 5단계 가이드가 있다. 여기선 3단계로 같은 역할을 한다.
const OB_STEPS = [
  { emoji:'', title:'로봇을 만들어요', desc:'마음에 드는 로봇을 고르고, 색을 칠하고, 이름을 지어주세요.' },
  { emoji:'', title:'매일 과제로 셀을 모아요', desc:'간식 주기 · 칭찬하기 · AI 과제 — 하루 3가지! 연속으로 오면 보상이 커져요.' },
  { emoji:'', title:'부품으로 꾸며요', desc:'모은 셀로 부품을 사서 로봇과 마이룸을 꾸밀 수 있어요.' },
];
let obIdx = 0;
function renderOnboard(){
  const s = OB_STEPS[obIdx];
  $('#ob-emoji').textContent = s.emoji;
  $('#ob-title').textContent = s.title;
  $('#ob-desc').textContent = s.desc;
  $('#ob-dots').innerHTML = OB_STEPS.map((_,i)=>`<i class="${i===obIdx?'on':''}"></i>`).join('');
  $('#ob-next').textContent = (obIdx === OB_STEPS.length - 1) ? '시작하기 ' : '다음';
}
function closeOnboard(){
  $('#onboard').classList.add('hidden');
  try{ localStorage.setItem('roomi_onboard', '1'); }catch(e){}
}
$('#ob-next').addEventListener('click', ()=>{
  if(obIdx <OB_STEPS.length - 1){ obIdx++; renderOnboard(); SFX.click(); }
  else { closeOnboard(); SFX.start(); }
});
$('#ob-skip').addEventListener('click', closeOnboard);
(function maybeShowOnboard(){
  let seen = false;
  try{ seen = localStorage.getItem('roomi_onboard') === '1'; }catch(e){}
  if(!seen){ renderOnboard(); $('#onboard').classList.remove('hidden'); }
})();

// ---------- 자동 로그인 ----------
(async function init(){
  const uid = localStorage.getItem(SK.uid), nick = localStorage.getItem(SK.nick);
  if(uid && nick){
    try{
      const j = await api('/api/user',{nickname:nick});
      state.user=j.user; state.quests=j.quests||{list:[],done:[]};
      if(j.user.token) localStorage.setItem(SK.token, j.user.token);
      if(j.streakBonus) setTimeout(()=> bubble(` ${j.streakBonus}일 연속 방문 보상 +${j.streakBonus}셀!`), 1200);
      // ★ 오버플레이 차단은 자동 로그인 경로에도 반드시 적용한다.
      //   여기를 빠뜨리면 새로고침만으로 시간 제한을 우회할 수 있다.
      if(j.play && j.play.overLimit){
        show('start');
        showOverplay({ minutes: j.play.minutes });
        return;
      }
      startPlayTimer();
      await enter(); return;
    }catch(e){}
  }
  show('start');
})();
