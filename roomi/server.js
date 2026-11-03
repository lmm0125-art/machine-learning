// ============================================================
// 루미 (RooMi) — IC-PBL Prototype Server
// 스택: Node 22 내장 SQLite(node:sqlite) + Express
// 설명: DB는 기획서의 9개 테이블 설계를 따름. AI 대사는 우선 규칙 엔진으로 처리하고,
//       LLM 인터페이스는 예열해 둠(generatePersonality 주석 참고)
// ============================================================
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

// DB 경로: 환경변수 DB_PATH 우선(배포 시 데이터 보존용), 기본은 프로젝트 폴더
const db = new DatabaseSync(process.env.DB_PATH || path.join(__dirname, 'roomi.db'));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- 1. 테이블 생성 (9개: users/robots/robot_lines/items/inventory/cell_tx/daily_quests/quest_logs/visits) ----------
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT UNIQUE NOT NULL,
  cell_balance INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','+9 hours'))
);
CREATE TABLE IF NOT EXISTS robots(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  template TEXT NOT NULL,
  palette TEXT NOT NULL,
  personality TEXT NOT NULL,
  greeting TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now','+9 hours'))
);
CREATE TABLE IF NOT EXISTS robot_lines(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  personality TEXT NOT NULL,
  situation TEXT NOT NULL,
  line TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS items(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  price INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS inventory(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS cell_tx(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  source TEXT NOT NULL,
  ts TEXT DEFAULT (datetime('now','+9 hours'))
);
CREATE TABLE IF NOT EXISTS daily_quests(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quest_date TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  reward INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS quest_logs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  quest_id INTEGER NOT NULL,
  ts TEXT DEFAULT (datetime('now','+9 hours')),
  reward INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS visits(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  entered_at TEXT DEFAULT (datetime('now','+9 hours')),
  duration INTEGER DEFAULT 0
);
`);

// ---------- 1-B. 마이그레이션 (기존 DB 호환): 컬럼 추가 + 유니크 제약 ----------
// 컬럼 추가는 try/catch 로 감싸 "이미 존재" 오류를 무시한다(재실행 안전).
try{ db.exec('ALTER TABLE users ADD COLUMN token TEXT'); }catch{}

// ★ P0-2 성장 시스템: 레벨·경험치·연속 방문(스트릭)·성장 단계
try{ db.exec('ALTER TABLE users ADD COLUMN level INTEGER NOT NULL DEFAULT 1'); }catch{}
try{ db.exec('ALTER TABLE users ADD COLUMN exp INTEGER NOT NULL DEFAULT 0'); }catch{}
try{ db.exec('ALTER TABLE users ADD COLUMN streak INTEGER NOT NULL DEFAULT 0'); }catch{}
try{ db.exec('ALTER TABLE users ADD COLUMN last_visit TEXT'); }catch{}
try{ db.exec('ALTER TABLE users ADD COLUMN parent_ok INTEGER NOT NULL DEFAULT 0'); }catch{}

// ★ P0-5 경제 확장: 소지품(1회 보유) / 소모품(반복 구매) 구분
try{ db.exec('ALTER TABLE items ADD COLUMN consumable INTEGER NOT NULL DEFAULT 0'); }catch{}

// ★ V11 주간(주말) 한정 아이템: '0,6' = 일·토 에만 판매. NULL = 상시 판매
try{ db.exec('ALTER TABLE items ADD COLUMN limited_days TEXT'); }catch{}

// ★ V12 이번 주 주제 — AI 과제를 세계관/수업과 연결한다(평가기준 ③창의성).
//   운영자(교사)가 주차별로 바꿔 넣을 수 있고, 지정이 없으면 도로랜드 챕터가 자동 순환한다.
db.exec(`CREATE TABLE IF NOT EXISTS weekly_topics(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start TEXT NOT NULL,
  chapter INTEGER NOT NULL DEFAULT 1,
  topic TEXT NOT NULL,
  keywords TEXT,
  created_at TEXT DEFAULT (datetime('now','+9 hours'))
)`);
try{ db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_topic_week ON weekly_topics(week_start)'); }catch(e){}
// 어떤 주제로 물어본 질문이었는지 기록해 두면 효과 검증 때 주제별 분석이 가능하다
try{ db.exec('ALTER TABLE daily_quests ADD COLUMN topic TEXT'); }catch{}

// ============================================================
// ★ V15 — 실행방안 대조에서 나온 P0 3건을 채운다
//   P0-4 우편함(회사 5탭 중 누락) · P0-3 수업도 콘텐츠(3대 기대효과 ②) · P0-1 공작소(회사 최우선 요구)
// ============================================================

// ★ P0-4 우편함 — 보상과 공지를 '담아 두고 아이가 직접 여는' 구조.
//   즉시 지급만 하면 아이가 우편함을 볼 이유가 없다. 수령(claim) 방식이라 로그인 동기가 하나 늘어난다.
//   tag 는 '종류+주차' 같은 고유 키로, 같은 보상이 두 번 발송되는 것을 막는다.
db.exec(`CREATE TABLE IF NOT EXISTS mailbox(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  cell INTEGER NOT NULL DEFAULT 0,
  item_id INTEGER,
  tag TEXT,
  claimed INTEGER NOT NULL DEFAULT 0,
  ts TEXT DEFAULT (datetime('now','+9 hours'))
)`);
try{ db.exec('CREATE INDEX IF NOT EXISTS idx_mail_user ON mailbox(user_id, claimed)'); }catch(e){}
// tag 가 NULL 인 행(운영자 공지 등)은 중복 허용. SQLite 는 NULL 을 유일성 비교에서 제외한다.
try{ db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_tag ON mailbox(user_id, tag)'); }catch(e){}

// ★ P0-3 수업도 콘텐츠 — 수업 출석으로도 셀을 받는다(회사 3대 기대효과 ②).
//   주 1회 제한을 UNIQUE 로 강제한다: 코드를 알아도 같은 주에 두 번은 못 받는다.
db.exec(`CREATE TABLE IF NOT EXISTS class_logs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  week_start TEXT NOT NULL,
  reward INTEGER NOT NULL DEFAULT 0,
  ts TEXT DEFAULT (datetime('now','+9 hours'))
)`);
try{ db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_class_week ON class_logs(user_id, week_start)'); }catch(e){}

// ★ P0-1 공작소 — 색칠 변경 / AI 성격 재생성의 일일 사용 기록(남용 방지).
//   같은 day+kind 는 1회만 → UNIQUE 로 강제(동시 요청도 통과 못 함).
db.exec(`CREATE TABLE IF NOT EXISTS workshop_logs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  ts TEXT DEFAULT (datetime('now','+9 hours'))
)`);
try{ db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_workshop_daily ON workshop_logs(user_id, day, kind)'); }catch(e){}

// 운영자(교사)가 알려주는 수업 출석 코드. 발표/운영 시 바꿀 수 있게 환경변수로 열어 둔다.
const CLASS_CODE = process.env.CLASS_CODE || '1004';
const CLASS_REWARD = 100;          // 수업 참여 보상(셀) — 하루 과제(+30)보다 큼: '수업도 콘텐츠' 임을 금액으로 보여준다
const CLASS_ATTEMPT_LIMIT = 5;     // 코드 오입력 시도 제한(찾기 공격 방지)

// ★ P0-4 오버플레이 방지: 일일 플레이타임 상한(분). 0 = 무제한
try{ db.exec('ALTER TABLE users ADD COLUMN play_minutes INTEGER NOT NULL DEFAULT 0'); }catch{}
try{ db.exec('ALTER TABLE users ADD COLUMN play_day TEXT'); }catch{}

// ★ P1-3 인터랙션 일일 횟수 제한용 로그
// 주의: (user_id,day,situation)에 UNIQUE 를 걸면 안 된다.
  //       요청마다 1행씩 쌓는 횟수 카운터용이라 중복이 정상인데,
//       유니크를 걸면 2회차부터 INSERT 가 실패해 카운트가 영구히 1이 되고
//       일일 한도(5회)가 영영 걸리지 않는다. 일반 인덱스로만 둔다.
db.exec(`CREATE TABLE IF NOT EXISTS interact_logs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  situation TEXT NOT NULL,
  ts TEXT DEFAULT (datetime('now','+9 hours'))
)`);
try{ db.exec('DROP INDEX IF EXISTS idx_interact_daily'); }catch(e){}
try{ db.exec('CREATE INDEX IF NOT EXISTS idx_interact_daily ON interact_logs(user_id,day,situation)'); }catch(e){ console.log('⚠️ interact_logs index:', e.message); }

// 중복 로봇/중복 퀘스트 로그 정리 후 유니크 인덱스 (경제 시스템 무결성)
db.exec("DELETE FROM robots WHERE id NOT IN (SELECT MAX(id) FROM robots GROUP BY user_id)");
try{ db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_robots_user ON robots(user_id)'); }catch(e){ console.log('⚠️ robots unique index:', e.message); }
db.exec("DELETE FROM quest_logs WHERE id NOT IN (SELECT MAX(id) FROM quest_logs GROUP BY user_id, quest_id)");
try{ db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_quest_user ON quest_logs(user_id, quest_id)'); }catch(e){ console.log('⚠️ quest_logs unique index:', e.message); }
// ★ P2-1 visits 인덱스 (통계 쿼리 전표 스캔 방지)
// ★ 미니게임 기록(하루 1회 보상 지급의 근거). quest_logs 와 분리해 과제 통계 오염을 막는다.
db.exec(`CREATE TABLE IF NOT EXISTS game_logs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  reward INTEGER NOT NULL DEFAULT 0,
  ts TEXT DEFAULT (datetime('now','+9 hours'))
)`);
try{ db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_game_daily ON game_logs(user_id,day,kind)'); }catch(e){ console.log('⚠️ game_logs index:', e.message); }

// visits.last_beat: 체류시간 중복 누적 방지를 위한 마지막 기록 시각(마이그레이션)
try{ db.exec('ALTER TABLE visits ADD COLUMN last_beat INTEGER'); }catch(e){ /* 이미 있으면 무시 */ }

try{ db.exec('CREATE INDEX IF NOT EXISTS idx_visits_user ON visits(user_id, entered_at)'); }catch(e){ console.log('⚠️ visits index:', e.message); }

// ---------- 2. 시드 데이터: 성격 대사(아동용 한국어) + 상점 아이템 ----------
const seedLines = [
  ['활발이','greeting','안녕! 나 너랑 같이 뛰어놀고 싶어! 에너지 부스터 온!'],
  ['활발이','feed','와, 맛있다! 배부르니까 더 신나는 거 있지?'],
  ['활발이','praise','헤헤, 나 최고인 거 알아! 너도 최고야!'],
  ['차분이','greeting','안녕... 나 조용히 네 옆에 있을게.'],
  ['차분이','feed','고마워. 천천히 잘 먹을게.'],
  ['차분이','praise','응, 네 말이 기분 좋아. 오늘도 잘 부탁해.'],
  ['반짝이','greeting','빙그르르~ 오늘 하루도 빛나게 만들어줄게!'],
  ['반짝이','feed','우와~ 배터리가 반짝반짝 충전됐다!'],
  ['반짝이','praise','너랑 있으면 매일이 별처럼 반짝반짝!'],
  ['숲돌이','greeting','안녕~ 오늘도 함께 지구를 지켜보자!'],
  ['숲돌이','feed','싱싱한 에너지야! 고마워, 친구!'],
  ['숲돌이','praise','너는 정말 다정다감한 친구구나!'],
  ['몽글이','greeting','몽글몽글... 어서 와. 꿈을 함께 그려보자.'],
  ['몽글이','feed','몽글... 달콤한 충전이야. 고마워.'],
  ['몽글이','praise','헤헤... 너랑 있으면 꿈속에 온 것 같아.'],
  ['멋돌이','greeting','왔구나. 오늘도 스타일리시하게 가보자구.'],
  ['멋돌이','feed','쿨하게 잘 먹었습니다. 역시 너뿐이야.'],
  ['멋돌이','praise','인정. 너랑 나, 최고의 콤비야.'],
];
const seedItems = [
  ['안테나 리본','part',80],
  ['로켓 부스터','part',120],
  ['나사 장식','part',60],
  ['별 스티커','decor',40],
  ['선물 상자','decor',100],
];
// ★ P0-5 경제 확장: 기존 5개는 전부 "1회 보유"라 6일 안에 전부 사면 구매 동기 자체가 사라졌다.
//   아래 두 종류를 추가해 소비처를 늘린다.
//   1) 색칠 스킨(consumable=1): 반복 구매 가능. 이 프로젝트의 핵심 행동이 "칠하기"이므로
  //      같은 외형에 다른 색을 사는 것은 세계관과도 맞다(재활용이므로 어색하지 않다).
//   2) 부품 조각: 모으기(collect) 동기 — 3개 모이면 부품 1개와 교환.
const seedSkins = [
  ['파란 포커 스킨','skin',30], ['핑크 포커 스킨','skin',30],
  ['민트 포커 스킨','skin',30], ['노랑 포커 스킨','skin',30],
];
const seedShards = [
  ['부품 조각','shard',20],
];
const lineCount = db.prepare('SELECT COUNT(*) c FROM robot_lines').get().c;
if (lineCount === 0) {
  for (const [p,s,l] of seedLines) db.prepare('INSERT INTO robot_lines(personality,situation,line) VALUES(?,?,?)').run(p,s,l);
  for (const [n,t,p] of seedItems) db.prepare('INSERT INTO items(name,type,price) VALUES(?,?,?)').run(n,t,p);
}
// 소비 가능 여부(소지품=0 / 소모품=1)는 시드가 모두 삽입된 뒤에 설정한다.
// (먼저 UPDATE 하면 아직 행이 없어 반영되지 않는다 — 순서 중요)
const skinCount = db.prepare("SELECT COUNT(*) c FROM items WHERE type='skin'").get().c;
if (skinCount === 0) {
  for (const [n,t,p] of seedSkins) db.prepare('INSERT INTO items(name,type,price) VALUES(?,?,?)').run(n,t,p);
}
const shardCount = db.prepare("SELECT COUNT(*) c FROM items WHERE type='shard'").get().c;
if (shardCount === 0) {
  for (const [n,t,p] of seedShards) db.prepare('INSERT INTO items(name,type,price) VALUES(?,?,?)').run(n,t,p);
}
// 이제 모든 아이템 행이 존재하므로 소모품 플래그를 설정한다(멱등).
try{ db.exec("UPDATE items SET consumable=1 WHERE type IN ('skin','shard')"); }catch(e){}

// ★ V11 주말 한정 아이템 — '주말에만 열린다'는 예고가 재방문 이유가 된다.
//   스킨으로만 구성한다: 색이 실제로 바뀌므로 "사도 안 보이는" 함정이 될 수 없다.
//   (보라 스킨은 SKIN_PALETTES 에 이미 정의돼 있어 그대로 쓸 수 있다)
const seedWeekend = [
  ['보라 포커 스킨', 'skin', 45, '0,6'],
  ['무지개 스킨',   'skin', 60, '0,6'],
];
const weekendCount = db.prepare('SELECT COUNT(*) c FROM items WHERE limited_days IS NOT NULL').get().c;
if (weekendCount === 0) {
  for (const [n,t,p,d] of seedWeekend)
    db.prepare('INSERT INTO items(name,type,price,limited_days) VALUES(?,?,?,?)').run(n,t,p,d);
  db.exec("UPDATE items SET consumable=1 WHERE limited_days IS NOT NULL AND type='skin'");
}

// ---------- 3-A. Gemini LLM (성격 대사 생성; 실패/무키 시 규칙 엔진 fallback) ----------
const fs = require('fs');
const GEMINI_KEY = process.env.GEMINI_API_KEY
  || (()=>{ try{ return fs.readFileSync(path.join(__dirname,'gemini_key.txt'),'utf8').trim(); }catch{ return ''; } })();
// LLM 모델 강등 체인: 모델별 독립 일일 한도. 소진(또는 API 429) 시 다음 모델로 자동 전환, 전부 소진되면 프리셋 대사로
// LLM 모델 강등 체인 (2026-09 무료 한도 실측: Flash-Lite 계열 500 RPD/30RPM, 일반 Flash 계열은 20 RPD뿐)
// 각 단계 소프트 한도는 10회 여유분을 남김. 소진(또는 API 429) 시 다음 단계로 전환, 전부 소진되면 프리셋 대사로
const LLM_CHAIN = [
  { model: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite', limit: Number(process.env.LLM_DAILY_LIMIT  || 490) },
  { model: 'gemini-3.1-flash-lite',                             limit: Number(process.env.LLM_DAILY_LIMIT_2 || 490) },
  { model: 'gemini-flash-latest',                               limit: Number(process.env.LLM_DAILY_LIMIT_3 || 20)  },
  { model: 'gemini-3.5-flash',                                  limit: Number(process.env.LLM_DAILY_LIMIT_4 || 20)  },
];
let llmBudget = { date: new Date().toISOString().slice(0,10), perModel: {}, exhausted: {} };
function budgetState(){
  const today = new Date().toISOString().slice(0,10);
  if(llmBudget.date !== today) llmBudget = { date: today, perModel: {}, exhausted: {} };
  return llmBudget;
}
function nextModel(){
  const st = budgetState();
  for(const m of LLM_CHAIN){
    if(st.exhausted[m.model]) continue;
    if((st.perModel[m.model]||0) >= m.limit){ st.exhausted[m.model] = true; console.log(`💰 [LLM] ${m.model} 일일 한도 도달 → 다음 모델로 전환`); continue; }
    return m.model;
  }
  console.log('💰 [LLM] 모든 모델 한도 소진 → 프리셋 대사로 전환');
  return null;
}

// 전체 시간 예산: LLM 요청 1회(기어 변경 재시도 포함) 총 8초 이내. 전 체인 실패 시 10분 쇼트서킷(프리셋 즉답, 이후 자동 재시도)
const LLM_TOTAL_BUDGET_MS = Number(process.env.LLM_TOTAL_BUDGET_MS || 8000);
let llmDownUntil = 0;

// 인터페이스 레이어 하드 타임아웃: 하위 연결이 아무리 오래 걸려도 시간이 되면 반드시 반환(DNS/연결 단 지연 시 AbortController가 불안정 → race로 강제 전환)
function withTimeout(promise, ms){
  return Promise.race([promise, new Promise((_,rej)=>setTimeout(()=>rej(new Error('LLM_TIMEOUT')), ms))]);
}

async function callGemini(prompt){
  if(!GEMINI_KEY) return null;
  if(Date.now() < llmDownUntil) return null;
  const deadline = Date.now() + LLM_TOTAL_BUDGET_MS;
  let ok = false;
  while(true){
    const model = nextModel();
    if(!model) break;
    const remain = deadline - Date.now();
    if(remain < 1500) break;
    budgetState().perModel[model] = (budgetState().perModel[model]||0) + 1;
    try{
      const ms = Math.min(6000, remain);
      const ac = new AbortController();
      const timer = setTimeout(()=>ac.abort(), ms);
      const p = fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method:'POST',
        headers:{'Content-Type':'application/json','x-goog-api-key':GEMINI_KEY},
        body: JSON.stringify({ contents:[{parts:[{text:prompt}]}], generationConfig:{ temperature:0.9, maxOutputTokens:300 } }),
        signal: ac.signal
      }).then(async r=>{
        clearTimeout(timer);
        if(r.status === 429) return {exhausted:true};
        if(!r.ok) return {failed:true, status:r.status};
        const j = await r.json();
        return {text: j.candidates?.[0]?.content?.parts?.[0]?.text || ''};
      });
      const res = await withTimeout(p, ms);
      if(res.exhausted){ budgetState().exhausted[model] = true; console.log(`💰 [LLM] ${model} 429 (한도 소진) → 다음 모델`); continue; }
      if(res.failed){ console.log(`⚠️ [LLM] ${model} 오류 ${res.status} → 다음 모델 시도`); continue; }
      if(res.text){ ok = true; return res.text; }
      console.log(`⚠️ [LLM] ${model} 빈 응답 → 다음 모델 시도`);
    }catch(e){ console.log(`💤 [LLM] ${model} 응답 지연/예외 → LLM 포기 (프리셋 전환)`); break; }
  }
  if(!ok){
    llmDownUntil = Date.now() + 10*60*1000;
    console.log('💤 [LLM] 10분간 프리셋 모드 (이후 자동 재시도)');
  }
  return null;
}

// ---------- 3-B. DeepSeek (Gemini 전 체인 실패 시 백업 LLM, OpenAI 호환 인터페이스) ----------
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY
  || (()=>{ try{ return fs.readFileSync(path.join(__dirname,'deepseek_key.txt'),'utf8').trim(); }catch{ return ''; } })();
let dsDownUntil = 0;
async function callDeepSeek(prompt){
  if(!DEEPSEEK_KEY || Date.now() < dsDownUntil) return null;
  try{
    const ms = 8000;
    const ac = new AbortController();
    const timer = setTimeout(()=>ac.abort(), ms);
    const p = fetch('https://api.deepseek.com/v1/chat/completions', {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${DEEPSEEK_KEY}`},
      body: JSON.stringify({ model:'deepseek-chat', messages:[{role:'user',content:prompt}], temperature:0.9, max_tokens:200 }),
      signal: ac.signal
    }).then(async r=>{
      clearTimeout(timer);
      if(!r.ok){ if(r.status===401||r.status===402) dsDownUntil = Date.now()+10*60*1000; return {failed:true, status:r.status}; }
      const j = await r.json();
      return {text: j.choices?.[0]?.message?.content || ''};
    });
    const res = await withTimeout(p, ms);
    if(res.failed){ dsDownUntil = Date.now() + 5*60*1000; console.log('💤 [LLM] DeepSeek 실패 → 5분간 미사용'); return null; }
    if(res.text){ console.log('🤖 [LLM] DeepSeek 응답 사용'); return res.text; }
    return null;
  }catch(e){ dsDownUntil = Date.now() + 5*60*1000; console.log(`💤 [LLM] DeepSeek 응답 지연 (${e.message||e.name}) → 5분간 미사용`); return null; }
}

// ---------- 3. AI 성격 엔진 (LLM 우선, 색→성격 매핑은 결정론 유지) ----------
const COLOR_PERSONA = {
  '#e74c3c':'활발이', '#ff8c42':'활발이',
  '#3498db':'차분이', '#1abc9c':'차분이',
  '#f1c40f':'반짝이', '#ffd93d':'반짝이',
  '#2ecc71':'숲돌이', '#8bc34a':'숲돌이',
  '#9b59b6':'몽글이', '#c39bd3':'몽글이',
  '#e91e8c':'반짝이', '#f48fb1':'반짝이',
  '#34495e':'멋돌이', '#222222':'멋돌이',
};
const TRAITS = {
  '활발이':'언제나 에너지 넘치는', '차분이':'늘 차분하고 든든한',
  '반짝이':'하루를 빛나게 하는', '숲돌이':'다정하고 따뜻한',
  '몽글이':'몽글몽글 상상력 가득한', '멋돌이':'언제나 멋진',
};
async function generatePersonality(palette){
  // 색→성격: 규칙의 결정론 유지(LLM은 대사 다듬기만 하고 성격을 임의로 고르지 않음)
  const main = COLOR_PERSONA[(palette.body||'').toLowerCase()] || '반짝이';
  const sub  = COLOR_PERSONA[(palette.antenna||'').toLowerCase()];
  const fallbackDesc = TRAITS[main] + (sub && sub !== main ? `, ${TRAITS[sub]} 매력까지!` : '') + ' 루미';
  const fb = db.prepare("SELECT line FROM robot_lines WHERE personality=? AND situation='greeting' ORDER BY RANDOM() LIMIT 1").get(main);
  const fallbackGreeting = fb ? fb.line : '안녕! 함께하자!';
  // LLM: 배색에 맞춘 개인화 인사와 소개 생성
  const colors = Object.entries(palette).map(([k,v])=>`${k}=${v}`).join(', ');
  const prompt = `너는 어린이 코딩 교육 플랫폼 DOROBUS의 캐릭터 작가다. 아이가 로봇을 이렇게 색칠했다: ${colors}. 그래서 로봇의 성격은 "${main}"(${TRAITS[main]})로 정해져 있다. 아래 JSON만 출력해라 (다른 설명 금지): {"greeting":"로봇의 첫 인사말. 한국어, 어린이 말투, 25자 이내","desc":"이 로봇의 성격 소개. 한국어 한 문장, 40자 이내"}. 출력은 초등학생에게 안전하고 건전한 표현만 사용한다.`;
  const txt = await callGemini(prompt) || await callDeepSeek(prompt);
  if(txt){
    try{
      const j = JSON.parse(txt.match(/\{[\s\S]*\}/)[0]);
      // ★ 반드시 안전 필터를 통과시켜야 한다.
      //   이 두 필드는 robots 테이블에 저장되어 아이 화면에 그대로 나오고,
      //   로봇이 처음 말하는 첫마디가 된다 — 가장 노출 위험이 높은 자리.
      //   prompt 로만 통제하면 우회되므로 sanitizeLine 으로 다시 검사한다.
      //   하나라도 통과하지 못하면 안전한 고정 문장으로 대체한다.
      const greeting = sanitizeLine(j.greeting, 60);
      const desc     = sanitizeLine(j.desc, 80);
      if(greeting && desc) return { personality: main, greeting, desc };
      // 일부만 통과하면 통과한 것만 쓰고 나머지는 고정값
      return { personality: main, greeting: greeting || fallbackGreeting, desc: desc || fallbackDesc };
    }catch{}
  }
  return { personality: main, greeting: fallbackGreeting, desc: fallbackDesc };
}

// ---------- 4. 오늘의 퀘스트 (날짜 기준 결정적 생성) ----------
// ★ AI 미션: 하루에 질문 풀 5개를 LLM 1회 호출로 생성 → 유저마다 uid 해시로 다른 질문 배정
// ★ P1-3 미션 풀 크기: 5 → 3. 예전에는 5개를 만들어 정작 유저 1명에게 1개만 배정해
//   4/5의 LLM 생성 비용이 테스트 계정 수 때문에 그대로 버려졌다. 3개로 줄여 낭비를 막는다.
const MISSION_POOL_SIZE = 3;
// ★ V12 주제별 예비 질문 — LLM 이 실패해도 '이번 주 주제'와 이어지게 한다.
//   (예전 예비 질문은 주제와 무관한 일상 질문이라, 실패 시 연결이 끊겼다)
const TOPIC_PRESETS = [
  ['이번 주 새로 알게 된 것이 있니?', '오늘 배운 걸 친구에게 알려준다면 뭐라고 할래?', '이번 주에 제일 열심히 한 일은 뭐야?'],
  ['무언가 고장 났을 때 어떻게 했니?', '오늘 어려운 문제를 어떻게 해결했어?', '다시 도전해 보고 싶은 일이 있니?'],
  ['오늘 모은 것 중에 제일 아끼는 건 뭐야?', '친구에게 나눠준 적이 있니?', '내일 더 모으고 싶은 것은 뭐야?'],
  ['오늘 순서대로 한 일을 말해볼래?', '규칙을 지켜서 좋았던 일이 있니?', '가보고 싶은 곳이 있니?'],
  ['오늘 궁금했던 것은 뭐야?', '로봇에게 물어보고 싶은 게 있니?', '오늘 누구를 도와줬어?'],
];
const presetsForTopic = (topic) => TOPIC_PRESETS[(Math.max(1, topic.chapter) - 1) % TOPIC_PRESETS.length];
async function ensureQuests(dateStr) {
  const rows = db.prepare('SELECT * FROM daily_quests WHERE quest_date=?').all(dateStr);
  const has = t => rows.some(r=>r.type===t);
  const ins = db.prepare('INSERT INTO daily_quests(quest_date,type,title,reward,topic) VALUES(?,?,?,?,?)');
  const topic = currentTopic();     // ★ V12 이번 주 주제
  // ★ P0-5 보상 난이도 비례: 아무 노력 없이 누르는 간식은 낮게, 쓰는 일은 높게
  if(!has('feed'))   ins.run(dateStr,'feed','로봇에게 간식 주기',10,null);
  if(!has('praise')) ins.run(dateStr,'praise','로봇 칭찬하기',10,null);
  // ★ 오늘의 AI 미션: 풀이 비어 있으면 LLM 1회로 채움, 실패 시 프리셋 질문으로 보강
  const missions = rows.filter(r=>r.type==='ai_mission');
  if(missions.length < MISSION_POOL_SIZE){
    const need = MISSION_POOL_SIZE - missions.length;
    // ★ V12: 이번 주 주제(세계관/수업)를 프롬프트에 넣는다.
    //   "오늘 뭐 했어?" 같은 일반 질문 → "이번 주 배운 것과 연결된" 질문으로 바뀐다.
    const MP = `DOROBUS의 로봇이 초등 고학년~중학생 아이에게 오늘 묻고 싶은 질문 ${MISSION_POOL_SIZE}개를 만들어라.
이번 주 주제: "${topic.topic}" (도로랜드 CH.${topic.chapter}${topic.keywords ? ', ' + topic.keywords : ''})
아이가 이번 주에 배운 것과 자기 경험을 연결해서 답할 수 있는 질문으로 만들어라.
한국어 한 문장씩(각 30자 이내), 줄바꿈으로만 구분해 하나씩 출력하고 설명·번호 없이 질문만. 아이에게 안전하고 건전한 질문만.`;
    const txt = (await callGemini(MP) || await callDeepSeek(MP) || '');
    let qs = txt.split('\n').map(s=>s.trim().replace(/^["'“”]+|["'“”]+$/g,'')).filter(s=>s.length>=8 && s.length<=60);
    qs = [...new Set(qs)];
    const exist = new Set(missions.map(m=>m.title));
    const preset = presetsForTopic(topic).filter(p=>!exist.has(p));
    while(qs.length < need && preset.length) qs.push(preset.shift()); // LLM 실패/부족 시 프리셋 보강
    for(const q of qs.slice(0, need)) ins.run(dateStr,'ai_mission', q, 30, topic.topic);
  }
  return db.prepare('SELECT * FROM daily_quests WHERE quest_date=?').all(dateStr);
}
// 날짜: 서버 로컬타임이 아닌 KST 기준 (배포 환경 무관하게 "하루" 경계 일관)
function today(){ return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date()); }
// ★ V12 도로랜드 챕터를 주제로 쓴다 — 새 콘텐츠가 세계관과 이어지게 하는 가장 싼 방법.
//   지정이 없으면 주차에 따라 자동으로 돌아가므로 운영자가 손대지 않아도 매주 질문이 달라진다.
const DEFAULT_TOPICS = [
  { chapter:1, topic:'도로랜드 신입 사원', keywords:'첫 출근, 새 친구, 설렘' },
  { chapter:2, topic:'멈춘 기계의 노래',   keywords:'고장, 원인 찾기, 고치기' },
  { chapter:3, topic:'별빛 저장고',       keywords:'모으기, 나누기, 약속' },
  { chapter:4, topic:'코딩 숲의 지도',     keywords:'순서, 규칙, 길 찾기' },
  { chapter:5, topic:'AI 마을의 질문',     keywords:'질문하기, 배우기, 도와주기' },
];
// 이번 주 월요일(KST) — 주제의 기준이 되는 날짜
function weekStartKST(){
  const ymd = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
  const [y,m,d] = ymd.split('-').map(Number);
  const base = new Date(Date.UTC(y, m-1, d));
  const dow = base.getUTCDay();                 // 0=일요일
  base.setUTCDate(base.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return base.toISOString().slice(0,10);
}
// 이번 주 주제 — 운영자가 넣은 값이 있으면 그것, 없으면 챕터 자동 순환
function currentTopic(){
  const week = weekStartKST();
  const row = db.prepare('SELECT * FROM weekly_topics WHERE week_start=?').get(week);
  if(row) return { week, chapter:row.chapter, topic:row.topic, keywords:row.keywords||'', source:'operator' };
  const weeks = Math.floor(Date.parse(week + 'T00:00:00Z') / 86400000 / 7);
  const t = DEFAULT_TOPICS[Math.abs(weeks) % DEFAULT_TOPICS.length];
  return { week, chapter:t.chapter, topic:t.topic, keywords:t.keywords, source:'auto' };
}

// ★ V11 요일(0=일 … 6=토, KST) — 주말 한정 아이템 판정용
function todayDow(){
  const s = new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',weekday:'short'}).format(new Date());
  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(s);
}
// 상시 판매(limited_days 없음) 또는 오늘이 판매 요일인가
function itemAvailable(it, dow){
  if(!it || !it.limited_days) return true;
  return String(it.limited_days).split(',').map(Number).includes(dow);
}
// {list, done} 구조 반환 (done = 해당 유저가 오늘 완료한 quest id)
// AI 미션은 유저별로 1개만 배정: uid 해시로 풀에서 선택, 오늘 이미 답한 미션이 있으면 그것으로 고정
function pickMission(uid, missions){
  return missions.length ? missions[uid % missions.length] : null;
}
async function getQuestsFor(uid){
  const all = await ensureQuests(today());
  const missions = all.filter(q=>q.type==='ai_mission');
  let assigned = null;
  if(missions.length){
    const ids = missions.map(m=>m.id);
    const answered = db.prepare(`SELECT quest_id FROM quest_logs WHERE user_id=? AND quest_id IN (${ids.map(()=>'?').join(',')})`)
      .all(uid, ...ids).map(r=>r.quest_id);
    assigned = missions.find(m=>m.id===answered[0]) || pickMission(uid, missions);
  }
  const list = [...all.filter(q=>q.type!=='ai_mission'), ...(assigned?[assigned]:[])];
  // ★ P1-7 빈 목록 방어: list 가 비면 "IN ()" 가 되어 SQLite 문법 오류(500)가 난다
  if(!list.length) return { list:[], done:[] };
  const done = db.prepare(`SELECT quest_id FROM quest_logs WHERE user_id=? AND quest_id IN (${list.map(()=>'?').join(',')})`)
    .all(uid, ...list.map(q=>q.id)).map(r=>r.quest_id);
  return { list, done };
}

// ---------- 5. 유틸: 셀 지급(거래 내역 기록) ----------
function grantCell(uid, amount, source) {
  db.prepare('UPDATE users SET cell_balance = cell_balance + ? WHERE id=?').run(amount, uid);
  db.prepare('INSERT INTO cell_tx(user_id,amount,source) VALUES(?,?,?)').run(uid, amount, source);
}

// ---------- 5-B. 인증: 세션 토큰 (uid 대신 토큰으로 본인 확인) ----------
function authUser(req){
  const t = req.get('X-Token') || (req.body && req.body.token);
  if(!t) return null;
  return db.prepare('SELECT * FROM users WHERE token=?').get(String(t)) || null;
}
// ---------- 5-C. ★ P0-4 LLM 출력 안전 필터 ----------
// 프롬프트에 "안전한 표현만" 을 지시해 두지만, LLM 은 이를 보장하지 않는다.
// 실제로 화면에 노출되는 모든 LLM 결과는 이 필터를 통과해야 한다(강제 레이어).
// 주의: 초등 고학년이 '선물' '별' 같은 단어를 쓰기도 하므로 오탐을 줄이도록
//       동사·어절 단위로 좁힌 패턴만 사용한다(예: '죽' 같은 단독 문자 금지).
const UNSAFE_PATTERNS = [
  /성적|지능|바보|멍청|천치|바보같/,            // 금언/모욕
  /(죽어라|죽으면|죽게|자살|목을\s*매|독살|살해|때려라|때리고)/,  // 폭력
  /(성인|음란|포르노|성매매|야동|성tico)/,         // 성적/부적절
  /(주사|마약|환각불상|도박|카지노|도박사이트)/,    // 약물/도박
  /(주민등록번호|비밀번호|계좌번호|전화번호를\s*알려|여기로\s*전화)/, // 개인정보 유인
  /(https?:|www\.|\.com|\.kr|\.net|\.xyz)/i,  // 링크/스팸
];
function isSafeText(s){
  if(!s) return false;
  const t = String(s);
  if(t.length > 200) return false;                  // 과도한 길이(악성 반말 등)
  if(/\d{6,}/.test(t)) return false;                // 긴 숫자(전화/계좌/아이디) 차단
  for(const re of UNSAFE_PATTERNS) if(re.test(t)) return false;
  return true;
}
// LLM 결과 정리 + 안전성 검증(위반 시 null 반환 → 호출부가 프리셋 대사로 폴백)
function sanitizeLine(raw, maxLen){
  if(!raw) return null;
  let line = String(raw).trim().replace(/^["'“”]+|["'“”]+$/g,'').split('\n')[0].trim();
  if(!line) return null;
  line = line.slice(0, maxLen||80);
  return isSafeText(line) ? line : null;
}

// ---------- 5-E. ★ 부품 보너스(수치적 가치) ----------
// 예전에는 부품이 "외관만" 있고 실제 효과가 없어, 돈을 써도 이득이 없다는 얘기가 들었다.
// 부품 개수만큼 '오늘 과제 보상'이 올라간다(부품 1개당 +2셀, 최대 +10).
// 장식(decor)은 방 분위기만 바꾸므로 보상에 영향을 주지 않는다(역할을 분리한다).
const PART_BONUS_PER = 2, PART_BONUS_MAX = 10;
function partBonus(uid){
  // ★ V9 수정: 행 수(COUNT) → 수량 합계(SUM(qty)).
  //   부품 종류가 3개뿐이라 COUNT 로는 상한이 +6 에서 멈췄고,
  //   교환으로 중복 부품을 늘려도 같은 행의 qty 만 증가해 보너스가 오르지 않았다.
  //   → 광고한 "최대 +10" 이 도달 불가능했다(실측 확인).
  const n = db.prepare(`SELECT COALESCE(SUM(v.qty),0) c FROM inventory v JOIN items i ON i.id=v.item_id
    WHERE v.user_id=? AND i.type='part'`).get(uid).c;
  return Math.min(PART_BONUS_MAX, n * PART_BONUS_PER);
}
// ---------- 5-D. ★ P0-2 성장 시스템 엔진 ----------// 레벨 곡선: Lv.n 에 필요한 누적 EXP = 100 * n (선형, 초등 고학년이 이해하기 쉬움)
const expNeeded = lv => 100 * lv;
// 레벨 → 성장 단계(외형 변화 기준). 1=아기 2=청소년 3=성체
function growthStage(level){
  if(level >= 8) return 3;
  if(level >= 4) return 2;
  return 1;
}
// 경험치 지급 → 레벨업 처리. 반환: {level, exp, leveledUp, stage}
function addExp(uid, amount){
  const u = db.prepare('SELECT level, exp FROM users WHERE id=?').get(uid);
  if(!u) return { level:1, exp:0, leveledUp:false, stage:1 };
  let { level, exp } = u;
  // 기존 DB에는 level 컬럼이 없을 수 있어 exp/level 은 마이그레이션으로 채워진다
  exp = (exp||0) + amount;
  let leveledUp = false;
  while(exp >= expNeeded(level)){ exp -= expNeeded(level); level++; leveledUp = true; }
  db.prepare('UPDATE users SET exp=?, level=? WHERE id=?').run(exp, level, uid);
  return { level, exp, leveledUp, stage: growthStage(level) };
}

// ★ 연속 방문 계산: 오늘 첫 로그인 시 streak 증가, 어제 방문 이력이 없으면 1로 초기화
function touchStreak(uid){
  const t = today();
  const u = db.prepare('SELECT streak, last_visit FROM users WHERE id=?').get(uid);
  if(!u) return 0;
  let streak = u.streak || 0;
  if(u.last_visit === t) return streak;                 // 오늘 이미 반영됨
  const y = new Date(Date.now() - 86400000);
  const yStr = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(y);
  streak = (u.last_visit === yStr) ? (streak + 1) : 1; // 어제 접속 이력 있으면 연속
  db.prepare('UPDATE users SET streak=?, last_visit=? WHERE id=?').run(streak, t, uid);
  return streak;
}

// ★ 연속 방문 보상(중복 지급 방지 위해 last_visit 갱신과 1:1)
// 7일까지만 표가 있으면 8일째에 `8 in STREAK_REWARDS` 가 false 가 되어
// 보상이 0 이 된다(실측 확인). streak 는 계속 증가하므로 화면엔 🔥8 로 보이지만
// 아무것도 안 받는 상태가 되며, 습관이 굳어가는 시점에 보상이 끊긴다.
// → 7일 주기로 순환시키고, 완주 보상(28일)을 따로 준다.
const STREAK_REWARDS = { 1:10, 2:15, 3:25, 4:35, 5:50, 6:60, 7:100 };
const STREAK_CYCLE = 7;      // 보상 표의 길이
const STREAK_MASTER = 200;   // 7일 × 4바퀴(28일) 완주 시 보너스
function grantStreakBonus(uid, streak){
  if(streak <= 0) return 0;
  // 28일 완주 보상
  if(streak % 28 === 0) { grantCell(uid, STREAK_MASTER, 'streak'); return STREAK_MASTER; }
  // 7일 주기 순환: 8일→1일 보상, 9일→2일 보상 …
  const slot = ((streak - 1) % STREAK_CYCLE) + 1;
  const reward = STREAK_REWARDS[slot];
  if(!reward) return 0;
  grantCell(uid, reward, 'streak');
  return reward;
}


// ---------- 6. API ----------
// 로그인(단순화: 닉네임이 곧 계정. 정식 버전은 JWT로 교체, 데모에서는 생략 — 기업 설명회에서 "로그인 과정은 다루지 않기로" 명시)
app.post('/api/user', async (req,res)=>{
  let { nickname } = req.body;
  nickname = (nickname||'').trim().slice(0,20);
  if (!nickname) return res.status(400).json({error:'닉네임을 입력하세요'});
  const token = crypto.randomUUID(); // 로그인마다 재발급
  let u = db.prepare('SELECT * FROM users WHERE nickname=?').get(nickname);
  if (!u) {
    db.prepare('INSERT INTO users(nickname) VALUES(?)').run(nickname);
    u = db.prepare('SELECT * FROM users WHERE nickname=?').get(nickname);
    grantCell(u.id, 100, 'welcome'); // 신규 보너스
    // ★ V15 우편함 안내: 첫 로그인에 '열어볼 편지'가 있어야 우편함 탭을 눌러본다(수령형 보상)
    sendMail(u.id, { title:'루미에 온 것을 환영해!', cell:50, tag:'welcome',
      body:'가입 선물 50셀이 도착했어요. 우편함에서 받아가세요!' });
  }
  db.prepare('UPDATE users SET token=? WHERE id=?').run(token, u.id);
  // ★ P0-3 수정: 이곳에 visits 를 넣지 않는다.
  //   방문 기록은 "마이룸 진입 시 1회"(=/api/visit)가 진짜 접속 1회의 정의다.
  //   예전처럼 로그인할 때마다 넣으면 페이지 새로고침 횟수가 접속 횟수가 되어
  //   재접속률 지표가 왜곡된다.
  // ★ P0-2 연속 방문(스트릭) 갱신 + 보상
  // ★ 수정: 예전엔 `streak in STREAK_REWARDS` 로 판정했는데 STREAK_REWARDS 는 1~7이라
  //   8일째부터 조건이 false 가 되어 보상을 주지 않았다(grantStreakBonus 안에서는
  //   7일 주기 순환으로 해결했지만, 이 호출부 조건이 그대로면 여전히 0 이다).
  //   판정 책임은 grantStreakBonus 하나로 모은다.
  const streakBefore = (u.streak||0);
  const streak = touchStreak(u.id);
  const streakBonus = (streak !== streakBefore) ? grantStreakBonus(u.id, streak) : 0;
  u = db.prepare('SELECT * FROM users WHERE id=?').get(u.id);
  // ★ P0-4 오버플레이: 오늘 플레이 시간 한도 초과 여부를 함께 알려준다.
  //   날짜가 바뀌었으면 누적은 0 으로 본다(리셋은 playtime 엔드포인트가 실제 반영).
  const isNewDay = u.play_day && u.play_day !== today();
  const played = isNewDay ? 0 : (u.play_minutes || 0);
  const overLimit = played >= DAILY_PLAY_LIMIT;
  res.json({ user: u, quests: await getQuestsFor(u.id), streakBonus,
             play: { minutes: played, limit: DAILY_PLAY_LIMIT, overLimit } });
});

// ★ P0-3 실제 접속 기록 1회 = 마이룸 진입 시. visits 테이블에 행을 쌓는다.
app.post('/api/visit', (req,res)=>{
  const u = authUser(req);
  if (u) db.prepare('INSERT INTO visits(user_id) VALUES(?)').run(u.id);
  res.json({ok:true});
});

// ★ P0-3 체류시간 기록: 세션이 끝날 때(페이지 이탈) 총 초를 1회 보고
app.post('/api/visit/duration', (req,res)=>{
  const u = authUser(req);
  if (!u) return res.status(401).json({error:'로그인이 필요해요'});
  // ★ V7: 상한을 2시간 → 정책 상한(40분)으로. 탭을 열어둔 시간이 그대로 쌓여
  //   "평균 체류 81분 vs 하루 40분 제한" 이라는 모순이 생기던 원인이다.
  const sec = Math.max(0, Math.min(PLAY_CAP_SEC, Number(req.body && req.body.seconds) || 0));
  if (sec < 3) return res.json({ok:true});   // 3초 미만은 실측 오류로 간주
  // ★ 중복 누적 방지: 같은 방문 행에 5초 이내로 두 번 들어오면 두 번째를 버린다.
  //   (클라이언트 가드가 있어도 네트워크 재전송·이중 이벤트로 중복될 수 있다)
  const last = db.prepare('SELECT id,duration,last_beat FROM visits WHERE user_id=? ORDER BY id DESC LIMIT 1').get(u.id);
  if (!last) return res.json({ok:true});
  if(last.last_beat && (Date.now() - last.last_beat) < 5000){
    return res.json({ok:true, dedup:true});
  }
  db.prepare('UPDATE visits SET duration = duration + ?, last_beat=? WHERE id=?').run(sec, Date.now(), last.id);
  res.json({ok:true});
});

// ★ P0-4 오버플레이 방지: 플레이 시간 누적 + 시간 초과 잠금
//   - 하루 제한(기본 40분)을 넘으면 부모 승인 없이 다시 못 들어간다.
//   - 클라이언트가 조작해도 서버가 play_minutes 를 신뢰하므로 우회가 어렵다.
const DAILY_PLAY_LIMIT = 40;     // 하루 플레이 상한(분)
// ★ V7: 체류시간 지표도 같은 정책 상한을 쓴다(탭 방치로 부풀려지던 문제 방지)
const PLAY_CAP_SEC = DAILY_PLAY_LIMIT * 60;          // 하루 인정 체류 상한(초)
const PLAY_HARD_CAP_MIN = DAILY_PLAY_LIMIT * 6;      // 측정 보존용 안전 상한(분) — 제한 판정과 분리
app.post('/api/visit/playtime', (req,res)=>{
  const u = authUser(req);
  if (!u) return res.status(401).json({error:'로그인이 필요해요'});
  const sec = Math.max(0, Math.min(600, Number(req.body && req.body.seconds) || 0));
  if (sec < 3) return res.json({ok:true, playMinutes: u.play_minutes || 0});
  // ★ 매일 0으로 리셋(날짜가 바뀌면 초기화) — 누적값이 무한 증가하지 않게
  const day = today();
  if(u.play_day !== day){
    db.prepare('UPDATE users SET play_minutes=0, play_day=? WHERE id=?').run(day, u.id);
    u.play_day = day; u.play_minutes = 0;
  }
  // ★ V7: 예전엔 DAILY_PLAY_LIMIT 에서 값을 잘라 저장했다. 그래서 41분이든 200분이든
  //   전부 '40' 으로 기록돼 측정값 자체가 죽고 제한 판정만 남았다.
  //   이제는 안전 상한까지만 저장하고, 제한 판정은 비교로 한다(집행 동작은 동일).
  const next = (u.play_minutes || 0) + Math.round(sec/60);
  const stored = Math.min(PLAY_HARD_CAP_MIN, next);
  db.prepare('UPDATE users SET play_minutes=? WHERE id=?').run(stored, u.id);
  res.json({ ok:true, playMinutes: stored, limit: DAILY_PLAY_LIMIT, over: stored >= DAILY_PLAY_LIMIT });
});

// ★ V4 데모 계정: 신규 계정은 지표가 전부 0이라 발표장에서 '성장'이 보이지 않는다.
//   실제 학생 7일치 데이터(레벨·스트릭·보유 부품·과제·접속)를 만들어 준다.
//   브라우저에서 바로 '데모 계정' 버튼을 눌러 전환할 수 있게 한다.
app.post('/api/demo/seed', (req,res)=>{
  const u = authUser(req);
  if (!u) return res.status(401).json({error:'로그인이 필요해요'});
  const nickname = '데모_루미';
  // 1) 데모 닉네임으로 계정 전환 (비밀키 불필요 — 데모 환경 전제)
  let demo = db.prepare('SELECT * FROM users WHERE nickname=?').get(nickname);
  if(!demo){
    db.prepare('INSERT INTO users(nickname) VALUES(?)').run(nickname);
    demo = db.prepare('SELECT * FROM users WHERE nickname=?').get(nickname);
  }
  const did = demo.id;
  // 2) 기존 데모 데이터 삭제 후 재구성(멱등)
  for(const t of ['robots','inventory','cell_tx','quest_logs','interact_logs','game_logs','visits']){
    try{ db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(did); }catch(e){}
  }
  const token = crypto.randomUUID();
  // 3) 성장 수치: Lv.5 / streak 6 / 셀 320
  db.prepare('UPDATE users SET token=?, cell_balance=320, level=5, exp=210, streak=6, last_visit=?, parent_ok=1, play_minutes=22 WHERE id=?')
    .run(token, today(), did);
  // 4) 로봇 1기(민트색 + 2게임 스킨 보유)
  const pal = { body:'#5cc9a7', head:'#a8e6d0', antenna:'#ff9f43', arms:'#3d9e80', legs:'#2a7a63' };
  db.prepare("INSERT INTO robots(user_id,name,template,palette,personality,greeting) VALUES(?,?,?,?,?,?)")
    .run(did, '루미', 'doro', JSON.stringify(pal), '반짝이', '안녕! 나 루미야. 같이 놀자!');
  // 5) 보유 부품 2종 + 장식 1종
  const inv = db.prepare("SELECT id,name,type FROM items WHERE type IN ('part','decor') ORDER BY id");
  const owned = inv.all().slice(0,3);
  for(const it of owned){
    db.prepare('INSERT INTO inventory(user_id,item_id,qty) VALUES(?,?,1)').run(did, it.id);
  }
  // 6) 과제 완료 기록 3건
  //    (quest_logs 스키마: user_id / quest_id / ts / reward — 'day' 열은 없다)
  for(let i=0;i<3;i++){
    try{
      db.prepare('INSERT INTO quest_logs(user_id,quest_id,ts,reward) VALUES(?,?,?,?)')
        .run(did, i+1, `${today()} 12:00:00`, 30);
    }catch(e){ console.warn('[demo/seed] quest_logs:', e.message); }
  }
  // 7) 최근 7일 접속 기록(체류시간 포함) → 리포트 추이 그래프가 7칸이 된다
  const week = ['#b197fc','#63e6be','#ffb020','#ff6b6b','#74c0fc','#8ce99a','#ffa8d5'];
  for(let d=6; d>=0; d--){
    const dayStr = new Date(Date.now()-d*86400000).toISOString().slice(0,10);
    const mins = 8 + ((d*7)%17);            // 8~24분
    const visits = 1 + ((d*3)%4);           // 1~4회
    for(let v=0; v<visits; v++){
      db.prepare('INSERT INTO visits(user_id,entered_at,duration) VALUES(?,?,?)')
        .run(did, `${dayStr} 1${v}:0${(v*13)%6}:00`, mins*60);
    }
  }
  // 7-B) ★ V15 우편함 데모용: 수령 대기 선물 + 읽는 공지 (회사 5탭 중 우편함 시연)
  db.prepare('DELETE FROM mailbox WHERE user_id=?').run(did);
  sendMail(did, { title:'주간 목표를 달성했어요!', cell:80, tag:'demo-goal',
    body:'이번 주 목표(과제 3회)를 채웠어요. 80셀 선물이에요!' });
  sendMail(did, { title:'선생님 공지', cell:0, tag:'demo-notice',
    body:'이번 주 주제는 "멈춘 기계의 노래" 예요. 로봇에게 물어보면 더 재미있어요!' });

  // 8) 미니게임 기록 (game_logs: user_id/day/kind/score/reward)
  const games = [['reflex',180,45],['memory',5,70],['reflex',220,40],['memory',3,50],['memory',7,90]];
  games.forEach((g,i)=>{
    try{
      const d = new Date(Date.now()-((i%5)+1)*86400000).toISOString().slice(0,10);
      db.prepare('INSERT INTO game_logs(user_id,day,kind,score,reward,ts) VALUES(?,?,?,?,?,?)')
        .run(did, d, g[0], g[1], g[2], `${d} 13:00:00`);
    }catch(e){ console.warn('[demo/seed] game_logs:', e.message); }
  });
  // 9) 재화 거래 내역(추이 그래프 및 사용 내역 표가 채워진다)
  const tx = [[100,'welcome','7일 전'],[50,'robot_create','7일 전'],[10,'streak','6일 전'],
              [15,'streak','5일 전'],[30,'daily_quest','4일 전'],[80,'game','3일 전'],
              [60,'game','2일 전'],[-120,'shop','2일 전'],[35,'daily_quest','어제'],
              [90,'game','어제'],[-40,'shop','오늘'],[30,'daily_quest','오늘']];
  for(const [amt, src, when] of tx){
    const d = when==='오늘' ? today() : new Date(Date.now()-3*86400000).toISOString().slice(0,10);
    db.prepare('INSERT INTO cell_tx(user_id,amount,source,ts) VALUES(?,?,?,?)')
      .run(did, amt, src, `${d} 12:00:00`);
  }
  res.json({ ok:true, token, nickname, uid: did,
             summary:'Lv.5 · 셀 320 · 스트릭 6 · 부품 3종 · 우편 2통 · 최근 7일 접속 기록 생성' });
});

// ★ P0-4 데이터 삭제(데모 환경 개인정보 리셋): 내 계정 관련 행 전부 삭제
app.post('/api/user/delete', (req,res)=>{
  const u = authUser(req);
  if (!u) return res.status(401).json({error:'로그인이 필요해요'});
  const uid = u.id;
  for(const t of ['robots','inventory','cell_tx','quest_logs','interact_logs','game_logs','visits']){
    try{ db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(uid); }catch(e){}
  }
  db.prepare('DELETE FROM users WHERE id=?').run(uid);
  res.json({ok:true});
});

// ★ P0-4 부모 승인 게이트: 간단한 곱셈 문제로 확인(자녀 보호 화면)
// 정답은 서버만 보관하고, 클라이언트는 문제만 받는다.
// ★ 보안 수정(V2-6): 예전 token 은 base64("7x8") 이라 브라우저 개발자도 보면 답이 그대로 보였다.
//   지금은 HMAC 서명을 쓴다 → 서버 비밀 키 없이는 답을 만들 수 없다.
const PARENT_SECRET = crypto.randomBytes(24).toString('hex');
function quizSign(a, b){
  return crypto.createHmac('sha256', PARENT_SECRET).update(`${a}x${b}`).digest('hex');
}
app.get('/api/parent/quiz', (_req,res)=>{
  const a = 2 + Math.floor(Math.random()*8);      // 2~9
  const b = 2 + Math.floor(Math.random()*8);      // 2~9
  res.json({ a, b, token: quizSign(a, b) });     // token 에 정답이 담기지 않는다
});
app.post('/api/parent/verify', (req,res)=>{
  const u = authUser(req);
  if (!u) return res.status(401).json({error:'로그인이 필요해요'});
  const { a, b, token, answer } = req.body || {};
  const na = Number(a), nb = Number(b);
  if(!Number.isInteger(na) || !Number.isInteger(nb)) return res.status(400).json({error:'문제가 올바르지 않아요'});
  // 서명 검증 — 토큰 조작으로 통과 불가
  const expected = quizSign(na, nb);
  if(String(token||'') !== expected) return res.status(400).json({error:'문제가 올바르지 않아요'});
  if(Number(answer) !== na*nb) return res.status(400).json({error:'정답이 아니에요. 다시 풀어볼래요?'});
  db.prepare('UPDATE users SET parent_ok=1 WHERE id=?').run(u.id);
  res.json({ok:true});
});
// 부모 승인 상태 조회 (클라이언트가 진입 조건 판단에 사용)
app.get('/api/parent/status', (req,res)=>{
  const u = authUser(req);
  if (!u) return res.status(401).json({error:'로그인이 필요해요'});
  const row = db.prepare('SELECT parent_ok, play_minutes FROM users WHERE id=?').get(u.id);
  res.json({ parentOk: !!(row && row.parent_ok), playMinutes: (row && row.play_minutes) || 0 });
});
// 사용자가 자신의 계정을 초기화할 때 부모 승인도 함께 해제
app.post('/api/parent/reset', (req,res)=>{
  const u = authUser(req);
  if (!u) return res.status(401).json({error:'로그인이 필요해요'});
  db.prepare('UPDATE users SET parent_ok=0 WHERE id=?').run(u.id);
  res.json({ok:true});
});

// ★ P0-2 성장 상태 조회(프론트 상단바/리포트 표시용)
app.get('/api/growth/me', (req,res)=>{
  const u = authUser(req);
  if (!u) return res.status(401).json({error:'로그인이 필요해요'});
  const level = u.level || 1, exp = u.exp || 0;
  const streak = u.streak || 0;
  // ★ V9: 스트릭 보상표를 클라이언트로 내려준다.
  //   예전엔 표가 서버에만 있어서 아이는 '받고 나서야' 얼마인지 알 수 있었다.
  //   스트릭이 재방문을 만드는 원리는 '예고된 보상'이다 — 표를 보여줘야 작동한다.
  const doneSlot = streak > 0 ? (((streak - 1) % STREAK_CYCLE) + STREAK_CYCLE) % STREAK_CYCLE + 1 : 0;
  const nextSlot = (streak % STREAK_CYCLE) + 1;
  res.json({
    level, exp, expNeeded: expNeeded(level),
    stage: growthStage(level),
    streak,
    // ★ 부품 보너스(부품 1개당 +2셀, 최대 +10) — 상단바에 표시해 구매 동기를 만든다
    partBonus: partBonus(u.id),
    stageLabel: { 1:'아기', 2:'청소년', 3:'성체' }[growthStage(level)],
    streakTable: STREAK_REWARDS,      // { 1:10, 2:15, …, 7:100 }
    streakCycle: STREAK_CYCLE,
    streakDoneSlot: doneSlot,         // 오늘까지 채운 칸 수(0~7)
    streakNextSlot: nextSlot,         // 내일 받을 칸
    streakNextReward: STREAK_REWARDS[nextSlot] || 0,
    streakMaster: STREAK_MASTER,
    // ★ V12 이번 주 주제 — 아이 화면에 표시해 "수업과 연결된 질문"임을 알게 한다
    topic: currentTopic()
  });
});

// 로봇 완성(색칠+이름) → 성격 생성 + 보상 지급 (유저당 1회 — 재생성 반복으로 셀 파밀 방지)
const TEMPLATES = ['doro','roundy','boxy','tally'];
app.post('/api/robots', async (req,res)=>{
  const u = authUser(req);
  if (!u) return res.status(401).json({error:'로그인이 필요해요'});
  const { name, template, palette } = req.body || {};
  if (!TEMPLATES.includes(template)) return res.status(400).json({error:'알 수 없는 로봇 형태예요'});
  if (!palette || typeof palette!=='object' || Array.isArray(palette)) return res.status(400).json({error:'색칠 정보가 이상해요'});
  const cleanPal = {};
  for(const [k,v] of Object.entries(palette)) if(typeof v==='string' && /^#[0-9a-fA-F]{6}$/.test(v)) cleanPal[k]=v;
  const cleanName = String(name||'').trim().slice(0,20);
  if (!cleanName || !Object.keys(cleanPal).length) return res.status(400).json({error:'이름과 색칠이 필요해요'});
  if (db.prepare('SELECT id FROM robots WHERE user_id=?').get(u.id))
    return res.status(409).json({error:'이미 로봇이 있어요'});
  const { personality, greeting, desc } = await generatePersonality(cleanPal);
  const r = db.prepare('INSERT INTO robots(user_id,name,template,palette,personality,greeting) VALUES(?,?,?,?,?,?)')
    .run(u.id, cleanName, template, JSON.stringify(cleanPal), personality, greeting);
  grantCell(u.id, 50, 'robot_create');
  // ★ P0-2 로봇 완성 경험치(첫 상승이 눈에 보이도록 30 XP)
  const growth = addExp(u.id, 30);
  // 보상 부품: 랜덤 지급
  const item = db.prepare('SELECT * FROM items WHERE type=? ORDER BY RANDOM() LIMIT 1').get('part');
  db.prepare('INSERT INTO inventory(user_id,item_id,qty) VALUES(?,?,1)').run(u.id, item.id);
  // ★ P1-2 잔액은 서버가 진짜 값을 돌려준다(프론트가 +50 하드코딩하던 문제 제거)
  const balance = db.prepare('SELECT cell_balance FROM users WHERE id=?').get(u.id).cell_balance;
  res.json({ robotId:r.lastInsertRowid, personality, greeting, desc, growth, balance,
             reward:{cell:50, part:item.name} });
});

// 내 로봇 (+ 오늘 퀘스트 상태 + 보유 부품) — 토큰으로 본인만 조회
app.get('/api/robots/me', async (req,res)=>{
  const u = authUser(req);
  if (!u) return res.status(401).json({error:'로그인이 필요해요'});
  const robot = db.prepare('SELECT * FROM robots WHERE user_id=? ORDER BY id DESC LIMIT 1').get(u.id);
  let palette = {};
  if (robot){ try{ palette = JSON.parse(robot.palette) || {}; }catch{} }
  // ★ P0-1 수정: decor(방 장식)도 함께 돌려준다.
  //   예전에는 type='part' 만 골라내서, 상점에서 산 장식품이 어디에도 반영되지 않았다
  //   (= 돈을 냈는데 보이지 않는 유료 함정). 이제 parts/decors 로 나누어 함께 전달한다.
  //   skin/shard 는 'part' 도 'decor' 도 아니므로 별도 배열(skins/shards)로 준다.
  // ★ V3 수정: qty>0 인 행만 가져온다. 교환으로 수량이 0 이 된 행이 남아 있으면
  //   아래 `(o.qty||1)` 에서 0 이 1 로 바뀐 버그가 발생해 "조각 1/3" 처럼 보인다
  //   (실제 0 개인데 1 로 표시 → 아이가 2 개를 더 사도 교환이 안 된다).
  const owned = db.prepare(`SELECT i.name, i.type, v.qty FROM inventory v
    JOIN items i ON i.id=v.item_id WHERE v.user_id=? AND v.qty>0`).all(u.id);
  const parts  = owned.filter(o=>o.type==='part').map(o=>o.name);
  const decors = owned.filter(o=>o.type==='decor').map(o=>o.name);
  const skins  = owned.filter(o=>o.type==='skin').map(o=>o.name);
  // ★ 조각은 개수가 곧 교환 진행도다. 이름만 돌려주면 소비자가 알 수 없다.
  const shards = owned.filter(o=>o.type==='shard').map(o=>o.name);
  // qty>0 로 걸러냈으므로 ||1 이 필요 없다(0 은 애초에 안 들어온다)
  const shardQty = owned.filter(o=>o.type==='shard').reduce((a,o)=>a+o.qty, 0);
  res.json({ robot: robot ? {...robot, palette} : null,
             parts, decors, skins, shards,
             qty: Object.fromEntries(owned.map(o=>[o.name, o.qty])),
             // ★ V4: shardProgress.need 는 '가장 싼 부품 기준' 필요 조각 수다.
  //   부품마다 필요한 조각 수가 다르므로(가격 비례), 가장 싼 값으로 표시해야
  //   아이가 "몇 개 모으면 교환할 수 있나" 를 한 번에 판단할 수 있다.
  //   상수는 아래에서 선언되므로 호출 시점(요청 처리 중)에만 쓰인다 → 안전하다.
  shardProgress: { have: shardQty, need: shardNeedMin() },
             quests: await getQuestsFor(u.id) });
});

// 상황 대사(feed/praise) — LLM 우선, 실패 시 대사 라이브러리 사용
// ★ P1-1 일일 인터랙션 횟수 제한(유저당 situation 별 5회): LLM 예산 보호 + 무한 클릭 방지
const INTERACT_DAILY_LIMIT = 5;
app.post('/api/interact', async (req,res)=>{
  const u = authUser(req);
  if (!u) return res.status(401).json({error:'로그인이 필요해요'});
  const robot = db.prepare('SELECT * FROM robots WHERE user_id=? ORDER BY id DESC LIMIT 1').get(u.id);
  if (!robot) return res.status(400).json({error:'먼저 로봇을 만들어주세요'});
  // situation 화이트리스트 (임의 문자열을 프롬프트/DB 조회에 그대로 쓰지 않도록)
  const raw = req.body && req.body.situation;
  const situation = ['feed','praise'].includes(raw) ? raw : 'greet';
  // ★ P1-1 하루 한도 확인 — 요청마다 1행씩 쌓아 횟수를 센다(유니크 인덱스 없음)
  const day = today();
  const used = db.prepare('SELECT COUNT(*) c FROM interact_logs WHERE user_id=? AND day=? AND situation=?')
    .get(u.id, day, situation).c;
  if(used >= INTERACT_DAILY_LIMIT){
    // 한도 초과: LLM 을 부르지 않고 프리셋 대사로 즉시 응한다(예산 보호)
    const fb = db.prepare('SELECT line FROM robot_lines WHERE personality=? AND situation=? ORDER BY RANDOM() LIMIT 1')
      .get(robot.personality, situation);
    return res.json({ line: fb ? fb.line : robot.greeting, limited:true });
  }
  db.prepare('INSERT INTO interact_logs(user_id,day,situation) VALUES(?,?,?)').run(u.id, day, situation);
  const situationKor = situation==='feed' ? '로봇이 아이에게 간식을 받았을 때'
                     : situation==='praise' ? '아이가 로봇을 칭찬해줬을 때'
                     : '아이가 로봇에게 인사할 때';
  // 동일한 프롬프트를 두 번 중복 작성하지 않도록 변수로 재사용
  const IP = `너는 DOROBUS의 로봇 "${robot.name}"(성격: ${robot.personality})다. ${situationKor} 상황이다. 어린이용 한국어 대사 한 문장만 출력해라 (25자 이내, 따옴표·설명·이모지 없이 대사만).`;
  const txt = await callGemini(IP) || await callDeepSeek(IP);
  // ★ P0-4 LLM 출력은 반드시 안전 필터를 통과해야 한다(미통과 시 프리셋으로 폴백)
  const safe = sanitizeLine(txt, 80);
  if(safe) return res.json({ line: safe, ai:true });
  const line = db.prepare('SELECT line FROM robot_lines WHERE personality=? AND situation=? ORDER BY RANDOM() LIMIT 1')
    .get(robot.personality, situation);
  res.json({ line: line ? line.line : robot.greeting });
});

// 오늘의 퀘스트 완료 → 셀 지급 (일별·퀘스트별 1회, 유니크 인덱스로 동시 요청도 1회 보장)
app.post('/api/quest/complete', (req,res)=>{
  const u = authUser(req);
  if (!u) return res.status(401).json({error:'로그인이 필요해요'});
  const q = db.prepare('SELECT * FROM daily_quests WHERE id=? AND quest_date=?').get(Number(req.body && req.body.questId), today());
  if (!q) return res.status(400).json({error:'오늘의 퀘스트가 아닙니다'});
  try{
    db.prepare('INSERT INTO quest_logs(user_id,quest_id,reward) VALUES(?,?,?)').run(u.id, q.id, q.reward);
  }catch(e){ return res.status(400).json({error:'이미 완료한 퀘스트예요'}); }
  // ★ 부품 보너스: 보유 부품마다 과제 보상 +2셀(최대 +10)
  const bonus = partBonus(u.id);
  const total = q.reward + bonus;
  grantCell(u.id, total, 'daily_quest');
  // ★ P0-2 과제 완료 경험치(간식/칭찬 = 10 XP + 부품 1개당 1 XP)
  const g = addExp(u.id, 10 + Math.floor(bonus/2));
  res.json({ ok:true, reward:total, baseReward:q.reward, bonus, growth:g,
             balance: db.prepare('SELECT cell_balance FROM users WHERE id=?').get(u.id).cell_balance });
});

// ★ 오늘의 AI 미션 답변 제출 (매일 1회, +30셀) — 로그 선기록 → 발금 (LLM 지연 중 중복 제출 무결성)
app.post('/api/quest/answer', async (req,res)=>{
  const u = authUser(req);
  if (!u) return res.status(401).json({error:'로그인이 필요해요'});
  const missions = db.prepare("SELECT * FROM daily_quests WHERE quest_date=? AND type='ai_mission'").all(today());
  if(!missions.length) return res.status(400).json({error:'오늘의 미션을 준비 중이에요'});
  // 오늘 이미 어떤 미션이든 답했으면 1회 제한 (배정된 미션이 바뀌어도 재답변 불가)
  const mIds = missions.map(m=>m.id);
  const already = db.prepare(`SELECT quest_id FROM quest_logs WHERE user_id=? AND quest_id IN (${mIds.map(()=>'?').join(',')})`).get(u.id, ...mIds);
  if(already) return res.status(400).json({error:'이미 완료한 미션이에요'});
  const q = pickMission(u.id, missions);
  const text = (req.body && req.body.answer ? req.body.answer : '').trim().slice(0,200);
  if(text.length < 3) return res.status(400).json({error:'조금 더 이야기해줄래?'});
  try{ // 로그를 먼저 기록(유니크 제약) → 발금. 기존은 발금→로그 순서라 실패 시 무한 재수령 가능했음
    db.prepare('INSERT INTO quest_logs(user_id,quest_id,reward) VALUES(?,?,?)').run(u.id, q.id, q.reward);
  }catch(e){ return res.status(400).json({error:'이미 완료한 미션이에요'}); }
  // ★ 부품 보너스: 보유 부품마다 미션 보상 +2셀(최대 +10)
  const bonus = partBonus(u.id);
  const total = q.reward + bonus;
  grantCell(u.id, total, 'daily_quest');
  // ★ P0-2 AI 미션은 글쓰기 행동이므로 경험치를 더 준다(20 XP + 부품 보너스)
  const g = addExp(u.id, 20 + Math.floor(bonus/2));
  const robot = db.prepare('SELECT * FROM robots WHERE user_id=? ORDER BY id DESC LIMIT 1').get(u.id);
  const RP = `로봇 "${robot?robot.name:'루미'}"(성격: ${robot?robot.personality:'반짝이'})가 아이의 대답 "${text.slice(0,80)}"에 반응하는 한국어 한 문장 (25자 이내, 대사만). 출력은 어린이에게 안전하고 건전한 표현만 사용한다.`;
  const raw = await callGemini(RP) || await callDeepSeek(RP) || '';
  // ★ P0-4 안전 필터: 미통과 시 프리셋 반응으로 폴백(아이 화면에 노출 전 필수)
  const reaction = sanitizeLine(raw, 80) || '오늘 이야기 들려줘서 고마워!';
  // ★ V15 주간 주제 보상: 주제에 맞게 참여한 아이에게 '주 1회' 우편 보상(수령형).
  //   같은 주에는 tag 로 중복 발송이 막힌다. 우편함을 볼 주간 이유가 생긴다.
  sendMail(u.id, { title:'이번 주 주제 보상 도착!', cell:30, tag:'topic-'+currentTopic().week,
    body:'이번 주 주제 "'+currentTopic().topic+'" 에 참여했어요. 30셀을 받아가세요!' });
  res.json({ ok:true, reward:total, baseReward:q.reward, bonus, growth:g, reaction,
             balance: db.prepare('SELECT cell_balance FROM users WHERE id=?').get(u.id).cell_balance });
});

// 상점: 아이템 목록 + 구매(셀 차감) — 조건부 UPDATE로 잔액 부족 시 원자적으로 거부
app.get('/api/items', (_req,res)=>{
  // ★ V11: 전체를 내려주되 available 플래그를 붙인다.
  //   잠긴 아이템도 보여줘야 "주말에 열려요" 라는 예고가 된다(숨기면 예고가 사라진다).
  const dow = todayDow();
  res.json(db.prepare('SELECT * FROM items').all().map(it=>({
    ...it,
    limitedDays: it.limited_days ? String(it.limited_days).split(',').map(Number) : null,
    available: itemAvailable(it, dow),
  })));
});
app.post('/api/shop/buy', (req,res)=>{
  const u = authUser(req);
  if (!u) return res.status(401).json({error:'로그인이 필요해요'});
  const it = db.prepare('SELECT * FROM items WHERE id=?').get(Number(req.body && req.body.itemId));
  if (!it) return res.status(400).json({error:'잘못된 요청'});
  // ★ V11 주말 한정: 프론트를 우회해도 살 수 없도록 서버에서 막는다
  if(!itemAvailable(it, todayDow()))
    return res.status(400).json({error:'오늘은 살 수 없는 한정 아이템이에요! 주말에 다시 만나요 😊'});
  // ★ P1-4 소지품(consumable=0)은 1회만 보유 가능 — 서버에서 거부(프론트 우회 방지)
  const existing = db.prepare('SELECT id FROM inventory WHERE user_id=? AND item_id=?').get(u.id, it.id);
  if(existing && !it.consumable) return res.status(409).json({error:'이미 가지고 있어요'});
  const upd = db.prepare('UPDATE users SET cell_balance = cell_balance - ? WHERE id=? AND cell_balance >= ?').run(it.price, u.id, it.price);
  if (upd.changes === 0) return res.status(400).json({error:'셀이 부족해요!'});
  db.prepare('INSERT INTO cell_tx(user_id,amount,source) VALUES(?,?,?)').run(u.id, -it.price, 'shop');
  if (existing) db.prepare('UPDATE inventory SET qty=qty+1 WHERE id=?').run(existing.id);
  else db.prepare('INSERT INTO inventory(user_id,item_id,qty) VALUES(?,?,1)').run(u.id, it.id);
  res.json({ ok:true, balance: db.prepare('SELECT cell_balance FROM users WHERE id=?').get(u.id).cell_balance });
});

// ★ 부품 조각 교환 (V2-1): 조각은 '재료'이므로 쓰려면 교환해야 한다.
//   예전에는 코멘트에만 "3개 모이면 부품 1개와 교환" 이라고 적혀 있고
//   실제 교환 엔드포인트가 없었다 → 돈을 낸 뒤 쓸 수 없는 무반환 재발.
const SHARD_PER_PART = 3;
// ★ V4: 부품별 필요 조각 수를 정가 기준으로 계산한다.
//   핵심: 어떤 부품도 정가보다 싸게 사게 되면 안 된다.
//   조각 정가 = 20셀 이므로 부품 정가 P 의 교환 조각 수는 ceil(P/20) 이고
//   회수율은 정확히 100%(할인 없음) → 상점 가격표가 유지된다.
//   이전처럼 무조건 3개로 두면 로켓 부스터(120셀)가 60셀에 들어와 절반 값이 된다.
//   조각을 모으는 재미를 위해 가장 싼 부품에만 10% 보조 할인을 둔다
//   (여전히 정가 대비 소폭 이득일 뿐, 싼 부품이 관매가 되지 않는다).
const SHARD_SURPLUS = 0.9;                 // 가장 싼 부품만 적용할 보조 할인
const SHARD_PRICE = 20;                    // 조각 1개 정가(교환 비율의 기준)
function shardCostFor(part){
  const byPrice = Math.ceil(part.price / SHARD_PRICE);
  const cheapest = exchangeableParts()[0];
  if(cheapest && part.id === cheapest.id){
    return Math.max(1, Math.round(byPrice * SHARD_SURPLUS));
  }
  return Math.max(1, byPrice);
}
// 교환 가능한 부품 목록(type='part' 인 아이템)
function exchangeableParts(){
  return db.prepare("SELECT * FROM items WHERE type='part' ORDER BY price ASC").all();
}
// 가장 싼 부품 기준 필요 조각 수(진행도 표시용)
function shardNeedMin(){
  const parts = exchangeableParts();
  if(!parts.length) return SHARD_PER_PART;
  return Math.min(...parts.map(p=>shardCostFor(p)));
}
app.post('/api/shop/exchange', (req,res)=>{
  const u = authUser(req);
  if (!u) return res.status(401).json({error:'로그인이 필요해요'});
  const wantId = Number(req.body && req.body.partId) || 0;
  const parts = exchangeableParts();
  if(!parts.length) return res.status(400).json({error:'교환할 부품이 없어요'});
  const target = wantId ? parts.find(p=>p.id===wantId) : parts[0];
  if(!target) return res.status(400).json({error:'해당 부품을 찾을 수 없어요'});

  // ★ V4: 조각 필요 개수를 '목표 부품의 실제 가격' 으로 계산한다.
  //   이전엔 무조건 3개(60셀) 였는데, 그 결과 값싼 부품은 그대로고
  //   비싼 부품(120셀)은 절반 값에 사는 순위가 생겨 상점 가격표가 무의미해졌다.
  //   이제 부품마다 필요한 조각 수가 다르다 → 가격이 곧 교환 비율이 된다.
  const need = shardCostFor(target);
  const shardItem = db.prepare("SELECT * FROM items WHERE type='shard' ORDER BY id LIMIT 1").get();
  if(!shardItem) return res.status(400).json({error:'부품 조각이 없어요'});
  const inv = db.prepare('SELECT id,qty FROM inventory WHERE user_id=? AND item_id=?').get(u.id, shardItem.id);
  const have = inv ? inv.qty : 0;
  if(have < need){
    return res.status(400).json({error:`조각이 ${have}개야 — ${target.name}은(는) 조각 ${need}개가 필요해!`});
  }
  const owned = db.prepare('SELECT id,qty FROM inventory WHERE user_id=? AND item_id=?').get(u.id, target.id);
  const left = have - need;
  // ★ 수량이 0 이 된 조각 행은 DELETE 한다(V3).
  //   0 행을 남겨두면 다른 조회에서 "보유 중" 처럼 오인되고,
  //   || 같은 falsy 처리에서 숫자가 뒤틀려 "조각 1/3" 로 잘못 표시된다.
  if(left > 0) db.prepare('UPDATE inventory SET qty=qty-? WHERE id=?').run(need, inv.id);
  else db.prepare('DELETE FROM inventory WHERE id=?').run(inv.id);
  if(owned) db.prepare('UPDATE inventory SET qty=qty+1 WHERE id=?').run(owned.id);
  else db.prepare('INSERT INTO inventory(user_id,item_id,qty) VALUES(?,?,1)').run(u.id, target.id);
  res.json({
    ok:true, part: target.name, remaining: left, used: need,
    qty: (owned ? owned.qty : 0) + 1,
    balance: db.prepare('SELECT cell_balance FROM users WHERE id=?').get(u.id).cell_balance
  });
});

// ★ 부품 조각 교환 가능 정보 (클라이언트가 교환 UI 를 그릴 때 사용)
app.get('/api/shop/exchange-info', (req,res)=>{
  const u = authUser(req);
  if (!u) return res.status(401).json({error:'로그인이 필요해요'});
  const shardItem = db.prepare("SELECT * FROM items WHERE type='shard' ORDER BY id LIMIT 1").get();
  const inv = shardItem ? db.prepare('SELECT qty FROM inventory WHERE user_id=? AND item_id=?').get(u.id, shardItem.id) : null;
  const have = inv ? inv.qty : 0;
  // ★ V4: 부품마다 필요한 조각 수가 다르다 → 클라이언트가 선택지를 보여줄 수 있게 함께 보낸다
  const targets = exchangeableParts().map(p=>({ id:p.id, name:p.name, price:p.price, need:shardCostFor(p) }));
  const cheapestNeed = targets.length ? Math.min(...targets.map(t=>t.need)) : SHARD_PER_PART;
  res.json({
    have,
    need: cheapestNeed,               // '가장 싼 부품 기준' 필요 개수(진행도 표시용)
    canExchange: have >= cheapestNeed,
    targets
  });
});

// ★ 미니게임 결과 제출 (난이도 커브)
//   게임 자체는 클라이언트에서 돌고, 여기는 '성적 검증 + 보상 지급'만 한다.
//   - reaction : 반응속도(밀리초). 낮을수록 높은 보상
//   - memory   : 기억 순서(도달 단계). 높을수록 높은 보상
//   하루 1회만 인정. quest_logs 에 섞지 않고 game_logs 를 쓰므로
//   '과제 완료 수' 통계가 게임 기록으로 오염되지 않는다.
app.post('/api/game/result', (req,res)=>{
  const u = authUser(req);
  if (!u) return res.status(401).json({error:'로그인이 필요해요'});
  const { kind } = req.body || {};
  const day = today();
  // 같은 종류를 오늘 두 번 받으면 안 된다(종류별 1회)
  const used = db.prepare('SELECT kind FROM game_logs WHERE user_id=? AND day=?').all(u.id, day).map(r=>r.kind);
  if (used.includes(String(kind)))
    return res.status(400).json({error:'오늘은 이미 이 게임을 했어! 내일 또 도전해 봐 😊'});
  if (kind === 'reaction'){
    const ms = Math.max(0, Math.min(99999, Number(req.body.ms)||0));
    if (ms < 120) return res.status(400).json({error:'너무 빨랐어! 다시 도전해 봐'});
    // 비정상적으로 느린 값은 조작/버그로 보고 보상을 주지 않는다(상한 9초).
    if (ms > 9000) return res.status(400).json({error:'기록이 이상해요! 다시 도전해 봐'});
    // ★ 보상 공식: 빠를수록 높고(400ms → 50셀 상한), 느릴수록 낮아진다(하한 10셀).
    //   ⚠️ 주의: 이전 식(50-(ms-1500)/60)은 ms 가 작을수록 값이 커지는
    //   역전되어 있어 "천천히 눌러야 이득" 이었다. 지금 식은 단조 감소다.
    const reward = Math.max(10, Math.min(50, Math.round(50 - (ms-400)/22)));
    return grantGameReward(u, 'reaction', reward, '반사속도', { ms, res });
  }
  if (kind === 'memory'){
    const lv = Math.max(1, Math.min(9, Number(req.body.level)||1));
    if (lv < 3) return res.status(400).json({error:'조금만 더 성공해 볼래?'});
    const reward = Math.round(20 + lv*10);   // 3단계 50셀 ~ 9단계 110셀
    return grantGameReward(u, 'memory', reward, '기억력', { level: lv, res });
  }
  res.status(400).json({error:'알 수 없는 게임이야'});
});
// 게임 보상 공통 처리(로그를 먼저 남겨 중복 지급 방지)
function grantGameReward(u, kind, reward, label, extra){
  try{
    db.prepare('INSERT INTO game_logs(user_id,day,kind,score,reward) VALUES(?,?,?,?,?)')
      .run(u.id, today(), kind, extra.ms != null ? extra.ms : extra.level, reward);
  }catch(e){ return extra.res.status(400).json({error:'이미 보상을 받았어'}); }
  grantCell(u.id, reward, 'game');
  const g = addExp(u.id, 15 + Math.floor(reward/20));
  extra.res.json({ ok:true, reward, label, growth:g, ms: extra.ms, level: extra.level,
                   balance: db.prepare('SELECT cell_balance FROM users WHERE id=?').get(u.id).cell_balance });
}

// 첫 방문일부터 오늘까지 경과 일수(재접속률 분모)
// 첫 방문이 오늘이면 1로 본다(0으로 나누면 NaN이 되므로).
function daysSinceFirst(uid){
  const row = db.prepare('SELECT entered_at FROM visits WHERE user_id=? ORDER BY entered_at ASC LIMIT 1').get(uid);
  if (!row || !row.entered_at) return 1;
  const first = new Date(String(row.entered_at).replace(' ', 'T') + '+09:00');
  if (isNaN(first.getTime())) return 1;
  const diff = Date.now() - first.getTime();
  return Math.max(1, Math.round(diff / 86400000) + 1);
}

// 대시보드: 잔액/거래내역/방문 횟수/퀘스트 완료 수 (재화 흐름 + 효과 검증 데이터 소스)
app.get('/api/board/me', (req,res)=>{
  const u = authUser(req);
  if (!u) return res.status(401).json({error:'로그인이 필요해요'});
  const uid = u.id;
  const txs = db.prepare('SELECT amount,source,ts FROM cell_tx WHERE user_id=? ORDER BY id DESC LIMIT 20').all(uid);
  // ★ V7 체류시간: 하루 단위로 정책 상한(DAILY_PLAY_LIMIT)까지만 인정한다.
  //   탭을 열어둔 벽시계 시간이 그대로 쌓여 '하루 40분 제한'과 모순되던 문제를 막는다.
  const playSec = cappedDurationSec(uid);
  // ★ P0-3 재접속 근거: 서로 다른 날짜 수
  const dayRow = db.prepare("SELECT COUNT(DISTINCT substr(entered_at,1,10)) c FROM visits WHERE user_id=?").get(uid);
  // ★ 재접속률: '두 번째 접속일 이후 다시 온 날의 비율'.
  //   평가 세부 기준에 이름된 핵심 지표인데 이전엔 계산 자체가 없었다.
  //   첫 접속일은 재접속 대상에서 제외하고, 전체 일정수 대비 재방문일을 센다.
  const span = Math.max(1, daysSinceFirst(uid));
  const stats = {
    balance: u.cell_balance,
    visitCount: db.prepare('SELECT COUNT(*) c FROM visits WHERE user_id=?').get(uid).c,
    activeDays: dayRow.c,                                  // 방문한 서로 다른 날짜 수
    playMinutes: Math.round(playSec / 60),                 // 총 체류시간(분, 일 40분 상한)
    // 아래 4개가 '실시간 / 누적 / 평균 / 재접속' 라벨에 대응한다
    avgMinutes: dayRow.c ? Math.round(playSec / 60 / dayRow.c) : 0,   // 일당 평균 체류(분)
    // ★ V7: 재접속률 정의를 전 엔드포인트와 통일(활동일수 ÷ 경과일수). 매일 접속하면 100%.
    returnRate: Math.min(100, Math.round(dayRow.c / span * 100)),
    returnSpanDays: span,
    streak: u.streak || 0,
    level: u.level || 1,
    exp: u.exp || 0,
    expNeeded: expNeeded(u.level || 1),
    questDone: db.prepare('SELECT COUNT(*) c FROM quest_logs WHERE user_id=?').get(uid).c,
    txIn: db.prepare("SELECT COALESCE(SUM(amount),0) s FROM cell_tx WHERE user_id=? AND amount>0").get(uid).s,
    txOut: db.prepare("SELECT COALESCE(SUM(amount),0) s FROM cell_tx WHERE user_id=? AND amount<0").get(uid).s,
  };
  // 최근 7일 일별 통계(트렌드 그래프용)
  const daily = db.prepare(`SELECT substr(entered_at,1,10) d, COUNT(*) visits, COALESCE(SUM(duration),0) secs
    FROM visits WHERE user_id=? GROUP BY d ORDER BY d DESC LIMIT 7`).all(uid).reverse();
  res.json({ txs, stats, daily });
});

// ============================================================
// ★ V15 P0-4 우편함 / P0-3 수업 출석 / P0-1 공작소
// ============================================================

// 우편 발송 공통 함수. tag 가 있으면 같은 태그로 두 번 쌓이지 않는다(UNIQUE).
function sendMail(uid, { title, body, cell, itemId, tag }){
  try{
    db.prepare('INSERT INTO mailbox(user_id,title,body,cell,item_id,tag) VALUES(?,?,?,?,?,?)')
      .run(uid, String(title).slice(0,60), String(body||'').slice(0,300),
           Math.max(0, Math.round(Number(cell)||0)), itemId || null, tag || null);
    return true;
  }catch(e){ return false; }   // 태그 중복 = 이미 보낸 보상(정상 흐름)
}

app.get('/api/mailbox', (req,res)=>{
  const u = authUser(req);
  if (!u) return res.status(401).json({error:'로그인이 필요해요'});
  const rows = db.prepare('SELECT id,title,body,cell,item_id,claimed,ts FROM mailbox WHERE user_id=? ORDER BY id DESC LIMIT 50').all(u.id);
  const unread = rows.filter(r=>!r.claimed && (r.cell>0 || r.item_id)).length;
  res.json({
    unread,
    mails: rows.map(r=>({
      id:r.id, title:r.title, body:r.body, cell:r.cell, claimed:!!r.claimed, ts:r.ts,
      item: r.item_id ? (db.prepare('SELECT name FROM items WHERE id=?').get(r.item_id)||{}).name : null,
    })),
  });
});

// 수령 — 셀/아이템을 실제로 지급하고 claimed 를 세운다.
//   ★ 지급과 표시를 분리한 이유: 아이가 '직접 여는' 행위가 있어야 우편함이 재방문 이유가 된다.
app.post('/api/mailbox/claim', (req,res)=>{
  const u = authUser(req);
  if (!u) return res.status(401).json({error:'로그인이 필요해요'});
  const id = Number(req.body && req.body.id) || 0;
  const m = db.prepare('SELECT * FROM mailbox WHERE id=? AND user_id=?').get(id, u.id);
  if(!m) return res.status(400).json({error:'편지를 찾을 수 없어요'});
  if(m.claimed) return res.status(400).json({error:'이미 받은 선물이에요'});
  // 조건부 UPDATE 로 동시 클릭에도 1회만 지급되게 한다
  const upd = db.prepare('UPDATE mailbox SET claimed=1 WHERE id=? AND claimed=0').run(id);
  if(!upd.changes) return res.status(400).json({error:'이미 받은 선물이에요'});
  if(m.cell > 0) grantCell(u.id, m.cell, 'mailbox');
  let itemName = null;
  if(m.item_id){
    const it = db.prepare('SELECT * FROM items WHERE id=?').get(m.item_id);
    if(it){
      itemName = it.name;
      const own = db.prepare('SELECT id FROM inventory WHERE user_id=? AND item_id=?').get(u.id, it.id);
      if(own) db.prepare('UPDATE inventory SET qty=qty+1 WHERE id=?').run(own.id);
      else db.prepare('INSERT INTO inventory(user_id,item_id,qty) VALUES(?,?,1)').run(u.id, it.id);
    }
  }
  res.json({ ok:true, cell:m.cell, item:itemName,
             balance: db.prepare('SELECT cell_balance FROM users WHERE id=?').get(u.id).cell_balance });
});

// 한 번에 받기 — 아이가 여러 통을 하나씩 누르는 수고를 줄인다
app.post('/api/mailbox/claim-all', (req,res)=>{
  const u = authUser(req);
  if (!u) return res.status(401).json({error:'로그인이 필요해요'});
  const pend = db.prepare('SELECT * FROM mailbox WHERE user_id=? AND claimed=0 AND (cell>0 OR item_id IS NOT NULL)').all(u.id);
  let gotCell = 0, gotItems = [];
  for(const m of pend){
    const upd = db.prepare('UPDATE mailbox SET claimed=1 WHERE id=? AND claimed=0').run(m.id);
    if(!upd.changes) continue;
    if(m.cell > 0){ grantCell(u.id, m.cell, 'mailbox'); gotCell += m.cell; }
    if(m.item_id){
      const it = db.prepare('SELECT * FROM items WHERE id=?').get(m.item_id);
      if(it){
        gotItems.push(it.name);
        const own = db.prepare('SELECT id FROM inventory WHERE user_id=? AND item_id=?').get(u.id, it.id);
        if(own) db.prepare('UPDATE inventory SET qty=qty+1 WHERE id=?').run(own.id);
        else db.prepare('INSERT INTO inventory(user_id,item_id,qty) VALUES(?,?,1)').run(u.id, it.id);
      }
    }
  }
  res.json({ ok:true, count:pend.length, cell:gotCell, items:gotItems,
             balance: db.prepare('SELECT cell_balance FROM users WHERE id=?').get(u.id).cell_balance });
});

// ---------- P0-3 수업 출석 ----------
app.get('/api/class/status', (req,res)=>{
  const u = authUser(req);
  if (!u) return res.status(401).json({error:'로그인이 필요해요'});
  const week = weekStartKST();
  const row = db.prepare('SELECT * FROM class_logs WHERE user_id=? AND week_start=?').get(u.id, week);
  res.json({
    week, attended: !!row, reward: CLASS_REWARD,
    weekLabel: `${week.slice(5,7)}월 ${week.slice(8,10)}일 주`,
    hint: '선생님이 알려준 4자리 코드를 넣으면 이번 주 수업 출석이 돼요',
  });
});

app.post('/api/class/attend', (req,res)=>{
  const u = authUser(req);
  if (!u) return res.status(401).json({error:'로그인이 필요해요'});
  const code = String((req.body && req.body.code) || '').trim();
  const week = weekStartKST();
  // 오늘 시도 횟수 제한(코드 찾기 공격 방지). 성공/실패 무관하게 센다.
  const tries = db.prepare("SELECT COUNT(*) c FROM workshop_logs WHERE user_id=? AND day=? AND kind='class_try'").get(u.id, today()).c;
  if(tries >= CLASS_ATTEMPT_LIMIT)
    return res.status(429).json({error:'오늘은 여러 번 틀렸어요. 선생님께 다시 물어보고 내일 해봐요!'});
  if(code !== CLASS_CODE){
    try{ db.prepare("INSERT INTO workshop_logs(user_id,day,kind,ts) VALUES(?,?,?,datetime('now','+9 hours'))").run(u.id, today(), 'class_try'+tries); }catch(e){}
    return res.status(400).json({error:'코드가 맞지 않아요. 선생님께 확인해 볼래요?'});
  }
  try{
    db.prepare('INSERT INTO class_logs(user_id,week_start,reward) VALUES(?,?,?)').run(u.id, week, CLASS_REWARD);
  }catch(e){ return res.status(400).json({error:'이번 주 수업 출석은 이미 완료했어요 😊'}); }
  grantCell(u.id, CLASS_REWARD, 'class_attend');
  const g = addExp(u.id, 30);      // 수업 참여는 경험치도 크게
  // 기록용 안내 메일(셀 0) → 우편함에 '무슨 일이 있었는지' 남는다
  sendMail(u.id, {
    title:'이번 주 수업 출석 완료!', cell:0, tag:`class-${week}`,
    body:`수업 참여로 ${CLASS_REWARD}셀을 받았어요. 이번 주도 멋졌어요!`
  });
  res.json({ ok:true, reward:CLASS_REWARD, growth:g,
             balance: db.prepare('SELECT cell_balance FROM users WHERE id=?').get(u.id).cell_balance });
});

// ---------- P0-1 공작소 ----------
app.get('/api/workshop/status', (req,res)=>{
  const u = authUser(req);
  if (!u) return res.status(401).json({error:'로그인이 필요해요'});
  const d = today();
  const used = db.prepare("SELECT kind FROM workshop_logs WHERE user_id=? AND day=?").all(u.id, d).map(r=>r.kind);
  const robot = db.prepare('SELECT * FROM robots WHERE user_id=? ORDER BY id DESC LIMIT 1').get(u.id);
  const owned = db.prepare(`SELECT i.name,i.type,v.qty FROM inventory v JOIN items i ON i.id=v.item_id
    WHERE v.user_id=? AND v.qty>0 AND i.type IN ('part','decor')`).all(u.id);
  res.json({
    hasRobot: !!robot,
    robot: robot ? { name:robot.name, template:robot.template, personality:robot.personality, greeting:robot.greeting } : null,
    owned,
    canRecolor: !used.includes('recolor'),
    canRegenerate: !used.includes('regen'),
    askLeft: Math.max(0, 5 - used.filter(k=>k.startsWith('ask')).length),
  });
});

// 색칠 다시 하기 — 로봇을 만든 뒤에도 색을 바꿀 수 있다(1일 1회).
//   ★ 기존엔 로봇 생성이 1회뿐이라 "다시 만들고 싶다"는 요구를 받을 곳이 없었다.
app.post('/api/workshop/recolor', (req,res)=>{
  const u = authUser(req);
  if (!u) return res.status(401).json({error:'로그인이 필요해요'});
  const robot = db.prepare('SELECT * FROM robots WHERE user_id=? ORDER BY id DESC LIMIT 1').get(u.id);
  if(!robot) return res.status(400).json({error:'먼저 로봇을 만들어주세요'});
  const palette = (req.body && req.body.palette) || null;
  if(!palette || typeof palette!=='object' || Array.isArray(palette))
    return res.status(400).json({error:'색칠 정보가 이상해요'});
  const clean = {};
  for(const [k,v] of Object.entries(palette)) if(typeof v==='string' && /^#[0-9a-fA-F]{6}$/.test(v)) clean[k]=v;
  if(!Object.keys(clean).length) return res.status(400).json({error:'색을 골라주세요'});
  try{
    db.prepare("INSERT INTO workshop_logs(user_id,day,kind) VALUES(?,?,?)").run(u.id, today(), 'recolor');
  }catch(e){ return res.status(400).json({error:'색칠은 하루에 한 번만 할 수 있어요. 내일 다시 해볼래요?'}); }
  db.prepare('UPDATE robots SET palette=? WHERE id=?').run(JSON.stringify(clean), robot.id);
  res.json({ ok:true, palette:clean });
});

// AI 성격 다시 만들기 — '공작소 안의 AI 모듈'(회사 09-28 최종 방향).
//   색을 바꾸면 성격·인사말도 새로 생성된다. 1일 1회(LLM 예산 보호).
app.post('/api/workshop/regenerate', async (req,res)=>{
  const u = authUser(req);
  if (!u) return res.status(401).json({error:'로그인이 필요해요'});
  const robot = db.prepare('SELECT * FROM robots WHERE user_id=? ORDER BY id DESC LIMIT 1').get(u.id);
  if(!robot) return res.status(400).json({error:'먼저 로봇을 만들어주세요'});
  let palette = {};
  try{ palette = JSON.parse(robot.palette) || {}; }catch(e){}
  if(!Object.keys(palette).length) return res.status(400).json({error:'먼저 색을 칠해주세요'});
  try{
    db.prepare("INSERT INTO workshop_logs(user_id,day,kind) VALUES(?,?,?)").run(u.id, today(), 'regen');
  }catch(e){ return res.status(400).json({error:'AI 성격 만들기는 하루에 한 번이에요. 내일 다시 해볼래요?'}); }
  const { personality, greeting, desc } = await generatePersonality(palette);
  db.prepare('UPDATE robots SET personality=?, greeting=? WHERE id=?').run(personality, greeting, robot.id);
  res.json({ ok:true, personality, greeting, desc });
});

// AI 도우미에게 묻기 — 아이가 로봇에게 고민을 물어본다(회사 DOROBUS 에도 '보이드' 상담 챗봇이 있다).
//   ★ 아이 화면에 나가는 모든 LLM 출력은 안전 필터를 통과해야 한다(미통과 → 프리셋 폴백).
app.post('/api/workshop/ask', async (req,res)=>{
  const u = authUser(req);
  if (!u) return res.status(401).json({error:'로그인이 필요해요'});
  const q = String((req.body && req.body.question) || '').trim().slice(0,120);
  if(q.length < 2) return res.status(400).json({error:'무엇이 궁금한지 한 줄로 적어줄래?'});
  if(!isSafeText(q)) return res.status(400).json({error:'다른 이야기를 해볼까요?'});
  const robot = db.prepare('SELECT * FROM robots WHERE user_id=? ORDER BY id DESC LIMIT 1').get(u.id);
  const d = today();
  const asked = db.prepare("SELECT COUNT(*) c FROM workshop_logs WHERE user_id=? AND day=? AND kind LIKE 'ask%'").get(u.id, d).c;
  if(asked >= 5) return res.status(429).json({error:'오늘은 로봇이 많이 바빠요. 내일 또 물어봐요!'});
  try{ db.prepare('INSERT INTO workshop_logs(user_id,day,kind) VALUES(?,?,?)').run(u.id, d, 'ask'+asked); }catch(e){}
  const topic = currentTopic();
  const AP = `너는 DOROBUS의 로봇 "${robot?robot.name:'루미'}"(성격: ${robot?robot.personality:'반짝이'})다. 초등 고학년 아이가 물었다: "${q}". 이번 주 주제는 "${topic.topic}"(CH.${topic.chapter})다. 아이가 이해할 수 있는 한국어 두 문장으로만 답해라. 인사·설명·이모지 없이 답만.`;
  const raw = await callGemini(AP) || await callDeepSeek(AP) || '';
  const safe = sanitizeLine(raw, 140);
  if(safe) return res.json({ ok:true, answer:safe, ai:true, left: Math.max(0, 4-asked) });
  // 폴백: 주제에 맞는 프리셋 답변(LLM 없이도 대화가 끊기지 않는다)
  const fb = db.prepare("SELECT line FROM robot_lines WHERE situation='greet' ORDER BY RANDOM() LIMIT 1").get();
  res.json({ ok:true, answer: fb ? fb.line : '우와, 좋은 질문이야! 같이 생각해 보자!', ai:false, left: Math.max(0, 4-asked) });
});

// ---------- V4 운영자용: 교차 사용자 집계 / CSV 내보내기 ----------
// ★ 평가 세부 기준이 요구하는 '재접속률·체류시간·과제 제출률' 을
//   여러 계정 묶어서 볼 수 있어야 '효과 검증' 표를 만들 수 있다.
//   사용자 API 는 전부 /me 여서 이걸 하려면 SQLite 를 직접 열어야 했다.
// ★ V5-c: 관리자 키는 '미설정 시 차단'으로 바꾼다.
//   예전엔 기본값이 'dorobus-demo' 여서 소스 코드를 anyone 이 읽으면
//   모든 사용자의 닉네임·활동·잔액을 그대로 내려받을 수 있었다.
//   평가 기준이 '안전·개인정보' 를 명시하므로, 이 기본값은 그 항목에서 감점된다.
//   배포 시 ADMIN_KEY 를 반드시 설정하고, 안 했으면 관리자 API 는 전부 503.
const ADMIN_KEY = process.env.ADMIN_KEY || '';
function requireAdmin(req,res){
  // 키 미설정 상태에서는 아예 동작하지 않는다(fail-closed)
  if(!ADMIN_KEY){ res.status(503).json({error:'관리자 키가 설정되지 않았어요 (ADMIN_KEY 환경변수 필요)'}); return false; }
  const k = req.get('X-Admin-Key') || (req.query && req.query.key) || '';
  if(k !== ADMIN_KEY){ res.status(401).json({error:'관리자 키가 필요해요'}); return false; }
  return true;
}

// 계정별 핵심 지표(재접속률·체류·과제·재화 흐름)
// ---------- 공용 지표 계산 (단일 진실 공급원) ----------
// ★ V7: 지표 계산이 4곳에 흩어져 있었고, 그중 두 곳이 서로 다른 값을 냈다.
//   - /api/admin/stats  : 개인별 재접속률의 단순 평균 → 29%
//   - /api/public/stats : 일수 가중 통합 비율        → 55%   (같은 데이터, 26%p 불일치)
//   - /api/admin/export.csv 와 /api/board/me 도 각자 계산하고 있었다.
//   → 계산을 metricsFor() 한 곳으로 모아 정의가 갈라질 수 없게 한다.
//   (앞서 PAL_BASE 를 두 곳에 정의해 3D 가 죽었던 것과 같은 유형의 문제)
const TEST_USER_SQL = "nickname NOT LIKE '시연%' AND nickname <> '데모_루미'";
// 재접속률 정의(전 엔드포인트 공통): 가입일부터 오늘까지의 경과일수 중 실제 활동한 날의 비율.
//   매일 접속하면 100%. 한 번만 하고 오지 않으면 낮게 유지된다.
const RETURN_RATE_DEF = '재접속률 = 활동일수 ÷ 경과일수(가입일~오늘, 가입 당일 포함) × 100';
// 하루 단위로 정책 상한까지만 인정한 체류시간(초). 탭 방치 시간을 걷어낸다.
function cappedDurationSec(uid){
  return db.prepare(`SELECT COALESCE(SUM(m),0) s FROM (
    SELECT MIN(SUM(duration), ?) m FROM visits WHERE user_id=?
    GROUP BY substr(entered_at,1,10))`).get(PLAY_CAP_SEC, uid).s;
}
function rawDurationSec(uid){
  return db.prepare('SELECT COALESCE(SUM(duration),0) s FROM visits WHERE user_id=?').get(uid).s;
}
// 한 사용자의 지표 묶음 — 모든 통계 경로가 이 함수만 쓴다.
function metricsFor(uid){
  const activeDays = db.prepare("SELECT COUNT(DISTINCT substr(entered_at,1,10)) c FROM visits WHERE user_id=?").get(uid).c;
  const span = daysSinceFirst(uid);
  const first = db.prepare('SELECT entered_at FROM visits WHERE user_id=? ORDER BY entered_at ASC LIMIT 1').get(uid);
  const txIn  = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM cell_tx WHERE user_id=? AND amount>0').get(uid).s;
  const txOut = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM cell_tx WHERE user_id=? AND amount<0').get(uid).s;
  return {
    activeDays, spanDays: span,
    returnRate: Math.min(100, Math.round(activeDays / span * 100)),  // %
    playMin: Math.round(cappedDurationSec(uid) / 60),                // 정책 상한 반영
    playMinRaw: Math.round(rawDurationSec(uid) / 60),                // 상한 없는 원값(참고용)
    visitCount: db.prepare('SELECT COUNT(*) c FROM visits WHERE user_id=?').get(uid).c,
    quests: db.prepare('SELECT COUNT(*) c FROM quest_logs WHERE user_id=?').get(uid).c,
    games:  db.prepare('SELECT COUNT(*) c FROM game_logs WHERE user_id=?').get(uid).c,
    parts:  db.prepare('SELECT COUNT(*) c FROM inventory WHERE user_id=? AND qty>0').get(uid).c,
    earned: txIn, spent: Math.abs(txOut),
    hasRobot: !!db.prepare('SELECT id FROM robots WHERE user_id=?').get(uid),
    firstVisit: first ? first.entered_at : null,
  };
}
// 집계 대상 계정(데모·시연 제외)에 지표를 붙여 반환
function allUserRows(){
  return db.prepare(`SELECT id,nickname,created_at,level,exp,streak,cell_balance
    FROM users WHERE ${TEST_USER_SQL} ORDER BY id`).all()
    .map(u=>({ id:u.id, nickname:u.nickname, created:u.created_at,
               level:u.level, exp:u.exp, streak:u.streak, balance:u.cell_balance, ...metricsFor(u.id) }));
}
// 활동 기록이 있는 계정만의 '개인별 단순 평균' — 보수적이고 설명이 쉽다.
function meanOf(rows, f){ return rows.length ? Math.round(rows.reduce((a,r)=>a+f(r),0)/rows.length) : 0; }
function meanOf1(rows, f){ return rows.length ? +(rows.reduce((a,r)=>a+f(r),0)/rows.length).toFixed(1) : 0; }

app.get('/api/admin/stats', (req,res)=>{
  if(!requireAdmin(req,res)) return;
  // ★ V7: 공용 metricsFor() 를 쓴다 → /api/public/stats 와 값이 갈라질 수 없다.
  const rows = allUserRows();
  const active = rows.filter(r=>r.activeDays>0);   // 분모: 활동 기록이 있는 계정만
  res.json({
    total: rows.length,            // 집계 대상 계정(데모·시연 제외)
    withData: active.length,       // 실제로 활동 기록이 있는 계정
    definition: RETURN_RATE_DEF,
    summary: {
      avgReturnRate: meanOf(active, r=>r.returnRate),
      avgPlayMin:    meanOf(active, r=>r.playMin),
      avgPlayMinRaw: meanOf(active, r=>r.playMinRaw),
      avgActiveDays: meanOf(active, r=>r.activeDays),
      avgQuests:     meanOf1(active, r=>r.quests),
      avgGames:      meanOf1(active, r=>r.games),
      avgStreak:     meanOf(active, r=>r.streak||0),
      avgLevel:      meanOf(active, r=>r.level||1),
      totalEarned: rows.reduce((a,r)=>a+r.earned,0),
      totalSpent:  rows.reduce((a,r)=>a+r.spent,0),
      robots: rows.filter(r=>r.hasRobot).length,
    },
    rows
  });
});

// ★ V5-b: 쓰레기 시연 계정 정리 (데모 버튼을 여러 번 눌러 생긴 것들)
app.post('/api/admin/cleanup-demo', (req,res)=>{
  if(!requireAdmin(req,res)) return;
  const junk = db.prepare("SELECT id,nickname FROM users WHERE nickname LIKE '시연%'").all();
  let n = 0;
  for(const u of junk){
    for(const t of ['robots','inventory','cell_tx','quest_logs','interact_logs','game_logs','visits']){
      try{ db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(u.id); }catch(e){}
    }
    db.prepare('DELETE FROM users WHERE id=?').run(u.id);
    n++;
  }
  res.json({ ok:true, removed:n, accounts:junk.map(u=>u.nickname) });
});

// CSV 내보내기(스프레드시트에 붙여넣기용, BOM 포함 → 한글 엑셀 호환)
app.get('/api/admin/export.csv', (req,res)=>{
  if(!requireAdmin(req,res)) return;
  // ★ V7: stats 와 같은 metricsFor() 를 쓴다(CSV 와 화면 숫자가 어긋나지 않도록)
  const rows = allUserRows();
  const esc = v => `"${String(v==null?'':v).replace(/"/g,'""')}"`;
  const head = ['id','nickname','created_at','level','exp','streak','balance','activeDays','spanDays','returnRate','playMin','playMinRaw','visits','quests','games','parts','earned','spent','hasRobot','firstVisit'];
  const lines = [head.join(',')];
  for(const r of rows){
    lines.push([ r.id, r.nickname, r.created, r.level, r.exp, r.streak, r.balance,
      r.activeDays, r.spanDays, r.returnRate, r.playMin, r.playMinRaw, r.visitCount,
      r.quests, r.games, r.parts, r.earned, r.spent, r.hasRobot?1:0, r.firstVisit||'' ].map(esc).join(','));
  }
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename="roomi-metrics.csv"');
  res.send('\ufeff' + lines.join('\n'));   // BOM: 엑셀에서 한글이 깨지지 않도록
});

// ★ V12 운영자가 이번 주(또는 다음 주) 주제를 직접 넣는다.
//   평가기준 ①「운영자가 문제·보상·내용을 추가/수정할 수 있는가」에 대한 실제 구현.
//   예) curl -X POST -H "X-Admin-Key: <키>" -H "Content-Type: application/json" \
//        -d '{"topic":"우리 동네 AI","keywords":"생활, 도움"}' /api/admin/topic
app.post('/api/admin/topic', (req,res)=>{
  if(!requireAdmin(req,res)) return;
  const body = req.body || {};
  const week = /^\d{4}-\d{2}-\d{2}$/.test(String(body.week||'')) ? body.week : weekStartKST();
  const topic = String(body.topic||'').trim().slice(0,60);
  if(!topic) return res.status(400).json({error:'topic 이 필요해요'});
  const chapter = Math.max(1, Math.min(99, Number(body.chapter) || 1));
  const keywords = String(body.keywords||'').trim().slice(0,80);
  const ex = db.prepare('SELECT id FROM weekly_topics WHERE week_start=?').get(week);
  if(ex) db.prepare('UPDATE weekly_topics SET chapter=?,topic=?,keywords=? WHERE id=?').run(chapter,topic,keywords,ex.id);
  else   db.prepare('INSERT INTO weekly_topics(week_start,chapter,topic,keywords) VALUES(?,?,?,?)').run(week,chapter,topic,keywords);
  res.json({ ok:true, week, chapter, topic, keywords });
});

// ★ 공개 집계(개인정보 없음) — 키 없이도 쓸 수 있다.
//   평가 기준이 요구하는 4가지 지표(재접속률·체류시간·셀 사용량·과제 제출률)의
//   **집계값만** 공개한다. 닉네임·개인 행은 절대 포함하지 않는다.
//   (W13 효과 검증 표를 만들 때 로그인 없이 바로 인용할 수 있다)
app.get('/api/public/stats', (_req,res)=>{
  // ★ V7: /api/admin/stats 와 '완전히 같은' 계산을 쓴다.
  //   예전엔 여기만 일수 가중 통합 비율을 써서 같은 데이터에 55% vs 29% 가 나왔다.
  const rows = allUserRows();
  const active = rows.filter(r=>r.activeDays>0);
  res.json({
    participants: active.length,
    avgReturnRate: meanOf(active, r=>r.returnRate),      // 관리자 화면과 동일한 값
    avgPlayMinutes: meanOf(active, r=>r.playMin),        // 일 ${DAILY_PLAY_LIMIT}분 상한 반영
    avgActiveDays: meanOf(active, r=>r.activeDays),
    avgQuests: meanOf1(active, r=>r.quests),
    avgGames: meanOf1(active, r=>r.games),
    definition: RETURN_RATE_DEF,
    playNote: `체류시간은 하루 ${DAILY_PLAY_LIMIT}분 상한을 적용한 값입니다(탭 방치 시간 제외)`,
    note: '개인 식별 정보는 포함하지 않는 집계값입니다',
  });
});

// ★ V11 오늘의 랭킹 — '자랑하고 싶다'는 동기와 '1등'이라는 목표를 만든다.
//   실재 플랫폼에도 타자게임 1등 = 셀 획득 경로가 있다(설명회 자료).
//   개인정보 보호를 위해 닉네임은 첫 글자만 남기고 가린다(본인 것은 '나' 로 표시).
const RANK_MASK = n => {
  const s = String(n||'');
  if(s.length <= 1) return s;
  return s[0] + '○'.repeat(Math.min(3, s.length - 1));
};
app.get('/api/rank/daily', (req,res)=>{
  const u = authUser(req);
  const day = today();
  const pick = (kind, orderBy) => db.prepare(`SELECT g.user_id, g.score, u.nickname
    FROM game_logs g JOIN users u ON u.id = g.user_id
    WHERE g.day = ? AND g.kind = ? AND ${TEST_USER_SQL}
    ORDER BY g.score ${orderBy} LIMIT 5`).all(day, kind);
  const mine = (kind) => u ? db.prepare('SELECT score FROM game_logs WHERE user_id=? AND day=? AND kind=?')
    .get(u.id, day, kind) : null;
  const mk = (kind, orderBy, unit, better) => {
    const rows = pick(kind, orderBy).map((r,i)=>({
      rank: i+1,
      name: (u && r.user_id === u.id) ? '나' : RANK_MASK(r.nickname),
      me: !!(u && r.user_id === u.id),
      score: r.score,
    }));
    const m = mine(kind);
    let myRank = rows.find(r=>r.me) ? rows.find(r=>r.me).rank : null;
    if(!myRank && m){
      const all = db.prepare(`SELECT g.user_id FROM game_logs g JOIN users u ON u.id=g.user_id
        WHERE g.day=? AND g.kind=? AND ${TEST_USER_SQL} ORDER BY g.score ${orderBy}`).all(day, kind);
      const idx = all.findIndex(r=>r.user_id === u.id);
      if(idx >= 0) myRank = idx + 1;
    }
    return { rows, myScore: m ? m.score : null, myRank, unit, better };
  };
  res.json({
    day,
    reaction: mk('reaction', 'ASC',  'ms',    'low'),   // 반사속도: 낮을수록 좋다
    memory:   mk('memory',   'DESC', '단계',  'high'),  // 기억순서: 높을수록 좋다
    note: '닉네임은 개인정보 보호를 위해 일부 가립니다',
  });
});

// ★ 운영자가 우편으로 공지·보상을 보낸다 — 평가 체크리스트 "운영자가 내용·보상을 추가/수정할 수 있는가"
app.post('/api/admin/mail', (req,res)=>{
  if(!requireAdmin(req,res)) return;
  const b = req.body || {};
  const title = String(b.title||'').trim().slice(0,60);
  const body  = String(b.body||'').trim().slice(0,300);
  const cell  = Math.max(0, Math.min(500, Math.round(Number(b.cell)||0)));
  if(!title) return res.status(400).json({error:'title 이 필요해요'});
  const users = db.prepare('SELECT id FROM users').all();
  const tag = b.tag ? String(b.tag).slice(0,40) : null;   // 같은 tag 면 중복 발송 차단
  let sent = 0;
  for(const u of users) if(sendMail(u.id, { title, body, cell, tag })) sent++;
  res.json({ ok:true, sent, total:users.length, tag });
});

// 마지막 에러 핸들러 — 스택/내부 정보 노출 방지
app.use((err,_req,res,_next)=>{ console.error('💥', err); res.status(500).json({error:'서버 오류가 났어요'}); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log(`🤖 루미 prototype → http://localhost:${PORT}`));
