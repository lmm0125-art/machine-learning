# CODEX_CONTEXT — 루미 (RooMi) handoff

> **How to use**: paste the prompt below into Codex/Claude Code with this repo open.

```
You are continuing the RooMi project (Korean youth education content module).
Read CODEX_CONTEXT.md at the repo root fully before writing any code.
Then work on §12 tasks in order. Constraints you must not break:
Korean code comments, bound SQL params only, idempotent migrations,
log-then-grant for rewards, LLM output must pass isSafeText/sanitizeLine,
admin APIs stay fail-closed. Run the §13 smoke test after every change.
```

> **Purpose**: give a coding agent everything needed to continue this project from its current state
> without re-reading the whole repo. Written 2026-10-19 (W7). Facts verified against the running
> code, not from memory.
>
> **Read this first, then start at §12 (Next tasks).**

---

## 1. What this product is

A **DOROBUS content module** for ㈜도로 (Korean youth AI-edu company), built as an IC-PBL course project
at Hanyang ERICA. Target users: **upper elementary ~ middle school (ages 10–15)**.

One-sentence pitch:
> A robot the child paints by hand becomes a 3D roommate that waits for them — creating a daily
> reason to reopen DOROBUS on days with no class.

The company's problem: DLS online classes are **once a week**, so kids don't log in the other 6 days.

**Live demo**: https://my-dorobot.app.workbuddy.host/ (button 「🎬 데모 계정으로 바로 보기」 seeds a
7-day history: Lv.5, streak 6, 320 cells).
**Admin console**: `/admin.html` (header `X-Admin-Key`, default deploy key `dorobus-admin`).
**Class attendance code**: `1004` (env `CLASS_CODE`).

---

## 2. Repo map

```
dorobot/
├── server.js              (1,698 lines)  Express 5 API + SQLite schema + LLM pipeline + admin API
├── public/
│   ├── index.html         (322)  single page, 7 screens, modals
│   ├── app.js             (2,825)  all client logic, vanilla JS, no framework
│   ├── style.css          (399)
│   └── admin.html         (215)  operator console (stats / topic / mail / CSV)
├── package.json           express ^5.2.1 only
├── start.command          macOS double-click launcher
├── roomi.db               local SQLite file (gitignored in spirit; contains test data)
├── gemini_key.txt         optional key fallback (DO NOT COMMIT)
├── deepseek_key.txt       optional key fallback (DO NOT COMMIT)
└── docs/                  28 design/review/presentation docs (Korean + Chinese)
```

Entry point: `server.js` at repo root. No build step. No bundler. No TypeScript.

---

## 3. Run & deploy

**Requirements**: Node **>= 22** (`node:sqlite` is built in; flag `--experimental-sqlite` required).

```bash
npm install                       # installs express only
node --experimental-sqlite server.js          # http://localhost:3000
# or: npm start
```

**Env vars**

| var | default | meaning |
|---|---|---|
| `PORT` | 3000 | HTTP port |
| `DB_PATH` | `./roomi.db` | SQLite file path — **must be persistent in deploy** |
| `ADMIN_KEY` | `''` | admin endpoints; **empty ⇒ all admin APIs return 503 (fail-closed)** |
| `CLASS_CODE` | `1004` | weekly class attendance code |
| `GEMINI_API_KEY` | file `gemini_key.txt` | primary LLM |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | first model in chain |
| `LLM_DAILY_LIMIT[_2/_3/_4]` | 490/490/20/20 | per-model daily quotas |
| `LLM_TOTAL_BUDGET_MS` | 8000 | wall-clock budget for one LLM call |
| `DEEPSEEK_API_KEY` | file `deepseek_key.txt` | fallback LLM |


> **Local machine note (this Mac has no system `node`)**: use the managed runtime
> `/Users/limengmeng/.workbuddy/binaries/node/versions/22.12.0/bin/node`,
> or put it on PATH first: `export PATH="/Users/limengmeng/.workbuddy/binaries/node/versions/22.12.0/bin:$PATH"`.

**Production start command used today**

```bash
DB_PATH=/tmp/roomi-online.db CLASS_CODE=1004 ADMIN_KEY=dorobus-admin \
  node --experimental-sqlite server.js
```

> ⚠️ Rotate `ADMIN_KEY` before sharing the link publicly; `/tmp` DB is wiped on redeploy.

---

## 4. Architecture

```
Browser (vanilla JS, 1280×720 canvas-ish layout)
   │  fetch, JSON, header X-Token (session) / X-Admin-Key (admin)
   ▼
Express 5 (server.js)
   ├─ static: public/
   ├─ auth: users.token (opaque, generated at signup)
   ├─ domain logic: quests, economy, growth, mailbox, class, workshop, games
   ├─ LLM pipeline: prompt → isSafeText guard → Gemini chain → DeepSeek → preset fallback
   └─ SQLite (node:sqlite, synchronous DatabaseSync)
```

No cache layer, no queue, no websockets. All state in one SQLite file.

**Auth model**: `POST /api/user {nickname}` returns `{user:{id, token,...}}`. Client stores token in
`localStorage` (`roomi_token`) and sends `X-Token`. There is no password — this is a prototype.

**LLM chain** (`server.js` top):
`gemini-3.5-flash-lite` (490/day) → `gemini-3.1-flash-lite` (490) → `gemini-flash-latest` (20) →
`gemini-3.5-flash` (20) → DeepSeek → **preset line from `robot_lines`**.
Every model output passes `sanitizeLine()` / `isSafeText()`; failure ⇒ preset fallback (never blank).

---

## 5. Data model — 15 tables

`users` is the root; every other table carries `user_id`.

| table | key columns | notes |
|---|---|---|
| **users** | id PK, nickname UNIQUE, cell_balance, level, exp, streak, last_visit, parent_ok, play_minutes, token | one row per child |
| **robots** | id PK, user_id → users **UNIQUE**, name, template, palette(JSON), personality, greeting | 1 robot per child |
| **robot_lines** | id, personality, situation, line | preset dialogue bank |
| **items** | id, name, type(part/decor/skin/shard), price, consumable, limited_days | shop catalog |
| **inventory** | id, user_id, item_id, qty | owned items |
| **cell_tx** | id, user_id, amount(±), source, ts | **currency ledger** |
| **daily_quests** | id, quest_date, type, title, reward, topic | generated content |
| **quest_logs** | id, user_id, quest_id, reward, ts | **UNIQUE(user_id, quest_id)** |
| **visits** | id, user_id, entered_at, duration, last_beat | retention + dwell source |
| **weekly_topics** | id, week_start **UNIQUE**, chapter, topic, keywords | links AI quests to class |
| **mailbox** | id, user_id, title, body, cell, item_id, tag, claimed, ts | **UNIQUE(user_id, tag)** |
| **class_logs** | id, user_id, week_start, reward, ts | **UNIQUE(user_id, week_start)** |
| **interact_logs** | id, user_id, day, situation, ts | **UNIQUE(user_id, day, situation)** |
| **workshop_logs** | id, user_id, day, kind, ts | **UNIQUE(user_id, day, kind)** — daily limits |
| **game_logs** | id, user_id, day, kind, score, reward, ts | **UNIQUE(user_id, day, kind)** |

Indexes: `visits(user_id, entered_at)`, `mailbox(user_id, claimed)`, `interact_logs(user_id, day, situation)`.

**Invariant**: game rules are enforced by UNIQUE constraints, not app code. Do not "helpfully" catch and
ignore these errors — the 400 response is the anti-cheat mechanism.

---

## 6. API surface — 38 endpoints

**Session / lifecycle**
`POST /api/user` (create-or-load by nickname) · `POST /api/visit` · `POST /api/visit/duration` ·
`POST /api/visit/playtime` · `POST /api/user/delete` · `POST /api/demo/seed` (resets demo account)

**Parent gate**
`GET /api/parent/quiz` · `POST /api/parent/verify` · `GET /api/parent/status` · `POST /api/parent/reset`

**Growth / robot**
`GET /api/growth/me` · `POST /api/robots` · `GET /api/robots/me` · `POST /api/interact`

**Quests**
`POST /api/quest/complete` (feed/praise) · `POST /api/quest/answer` (AI mission, 1/day) — also mails a weekly bonus

**Shop / economy**
`GET /api/items` · `POST /api/shop/buy` · `POST /api/shop/exchange` · `GET /api/shop/exchange-info`

**Games / ranking**
`POST /api/game/result` · `GET /api/rank/daily`

**Mailbox**
`GET /api/mailbox` · `POST /api/mailbox/claim` · `POST /api/mailbox/claim-all`

**Class attendance**
`GET /api/class/status` · `POST /api/class/attend` (`{code}`)

**Workshop (공작소)**
`GET /api/workshop/status` · `POST /api/workshop/recolor` (1/day) ·
`POST /api/workshop/regenerate` (AI personality, 1/day) · `POST /api/workshop/ask` (5/day)

**Report / public**
`GET /api/board/me` · `GET /api/public/stats` (aggregate only, no PII)

**Admin** (require `X-Admin-Key`)
`GET /api/admin/stats` · `GET /api/admin/export.csv` · `POST /api/admin/topic` ·
`POST /api/admin/mail` · `POST /api/admin/cleanup-demo`

---

## 7. Business rules & constants

```js
STREAK_REWARDS = {1:10, 2:15, 3:25, 4:35, 5:50, 6:60, 7:100}   // 7-day cycle, master +200
PART_BONUS_PER = 2, PART_BONUS_MAX = 10      // each owned part adds +2 to daily quest reward
DAILY_PLAY_LIMIT = 40                        // minutes/day, hard cap x6
INTERACT_DAILY_LIMIT = 5
SHARD_PER_PART = 3, SHARD_SURPLUS = 0.9, SHARD_PRICE = 20
CLASS_REWARD = 100, CLASS_ATTEMPT_LIMIT = 5  // class code < 100,000 KRW-scale reward: bigger than quest (30)
MISSION_POOL_SIZE = 3
expNeeded(level) = 100 * level               // linear
growthStage: 1–3 baby, 4–7 teen, 8+ adult
TEMPLATES = ['doro','roundy','boxy','tally'] // DOROLAND characters
```

**Cell sources (6)**: welcome 100 · robot complete 50 · daily quest 30+ · minigame 10–110 ·
streak · **class_attend 100**.
**Sinks (5)**: parts · decor · skins · shard exchange (3→1 at list price) · display.

**Color → personality** is deterministic (`COLOR_PERSONA`), LLM only rephrases. Never let the model
pick the personality — that would break "same colors ⇒ same character".

---

## 8. Frontend map

`index.html` has 7 screens (`screen-start/create/myroom/workshop/shop/mail/board`) plus modals:
`#modal` (generic), `#onboard` (first-run 4 steps), `#privacy-modal`, `#consent-modal`,
`#game-reflex`, `#game-memory`, `#rank-modal`, `#parent-modal`.

`app.js` structure:
- `state` — `{user, robot, template, palette, recolor, growth, ...}`
- `api(path, body, timeout)` — fetch wrapper adding `X-Token`
- `goNav(name)` — single navigation entry (also used programmatically)
- renderers: `renderMyroom()`, `loadWorkshop()`, `loadMailbox()`, `loadClassCard()`, `loadShop()`, `loadBoard()`
- `robotSVG(template, palette)` — 2D fallback + paint canvas render
- Babylon 3D: `bjs` module, `rebuildRobot(robot)`; if CDN fails, 2D SVG is used automatically

**Never** hardcode a displayed value (cells, level, streak). All numbers come from API responses;
two bugs were previously caused by hardcoded `+50` / stale balances.

---

## 9. Conventions & hard constraints

1. **All code comments must be Korean.** This is a standing project rule (existing files are fully Korean).
2. **Always `db.prepare(...).run/get/all` with bound params.** No string interpolation into SQL
   (159 prepared-statement call sites today).
3. **Migrations are idempotent**: `try{ db.exec('ALTER TABLE ...') }catch{}` — the app must boot on an
   old DB file without manual steps.
4. **Grant-after-log pattern**: insert the log row (UNIQUE) first, then grant currency. Prevents double rewards
   on retry/concurrency.
5. **All LLM text passes `isSafeText` + `sanitizeLine`** before reaching a child's screen.
6. **Admin endpoints fail closed** when `ADMIN_KEY` is empty (503).
7. **No new npm dependencies** unless unavoidable. Current footprint is express only.
8. **Korean UI copy**, child-level vocabulary (short sentences, no honorifics overload).
9. Deploy keeps `DB_PATH` outside the repo so redeploys don't wipe data.

---

## 10. Known issues / tech debt

| # | Issue | Impact |
|---|---|---|
| 1 | **0 real users.** All accounts are test accounts; W13 metrics cannot be produced yet. | blocks 05-④ of the rubric |
| 2 | **Season system not implemented** (company approved a typing-game season on 09-28). | 05-③ partial |
| 3 | Admin UI covers only 3 ops (topic / mail / stats). Editing items or quests still requires SQL. | 01-③ partial |
| 4 | Stack differs from DOROBUS: no TypeScript, Vite, PostgreSQL, Redis, GLB, Socket.IO. | 01-② partial |
| 5 | No automated tests (only manual smoke). | refactor risk |
| 6 | `palette` is a JSON string column, not normalized. | fine at this scale |
| 7 | `interact_logs(kind='class_try'+n)` abuses the `kind` column for attempt counting. | smelly, works |
| 8 | Local `roomi.db` may predate the latest migrations (e.g. missing `weekly_topics`). | use a fresh DB for testing |
| 9 | 3D is Babylon primitives, not company GLB assets. | factory-porting discussion |

---

## 11. Current status vs plan (15-week schedule)

| Week | Planned | Actual |
|---|---|---|
| W1–2 research + plan doc | done | ✅ |
| W3 strategy | done | ✅ |
| W4–5 feature spec + 3 diagrams | done | ✅ (+ 2 ER diagrams) |
| W6–7 skeleton | done | ✅ |
| **W8–11 core loop** | in progress at midterm | ✅ **finished in W6, before the W8–11 window** |
| W12 internal test | — | 🟡 14 self-review rounds done (V2–V15) |
| W13 effect measurement | — | 🔴 no data |
| W14–15 final deck | — | 🟡 deck ready, 1 rehearsal |

Midterm is W8 (10/26); requirement is 기획 / DB설계 / 데모 — already satisfied; demo is replaced by
screenshots (user decision: no live 3D demo at midterm).

---

## 12. Next tasks (in priority order)

**T1 — Real user validation (highest value, external dependency)**
Recruit 5–10 kids (ages 10–15, with parental consent), run 3–5 days, export `/api/admin/export.csv`,
produce before/after table for the 4 metrics.
*Acceptance*: a CSV + a table with 재접속률 / 체류시간 / 셀 사용량 / 과제 제출률, plus a one-paragraph finding.

**T2 — Season system (smallest useful slice)**
Reuse `weekly_topics` + `class_logs` week keys. Add `seasons(id, name, start_week, end_week, reward_cell)`
and a ranking reset per season. Surface it on the report screen as "시즌 N주차".
*Acceptance*: admin can create a season; report shows current season week; season end grants one mailbox reward.

**T3 — Admin: content CRUD for items/quests**
Add forms to `public/admin.html` for `items` (create/edit price/type) and `daily_quests` templates.
*Acceptance*: operator can add an item and see it in the shop without SQL.

**T4 — GLB export path**
Export one robot template to GLB (Blender), load with Babylon `SceneLoader`, keep the procedural mesh as fallback.
*Acceptance*: `?glb=1` query flag renders the GLB robot; failure falls back silently.

**T5 — Portability note**
Write `docs/PORTING.md`: exact mapping SQLite→PostgreSQL, JS→TS/Vite, and which endpoints stay identical.

**Do not** build: chat/Socket.IO, payments, real 3D art, multi-language. They are explicitly out of scope
(see `docs/기능기획서.md` §9).

---

## 13. Smoke test (copy-paste)

```bash
export PATH="/Users/limengmeng/.workbuddy/binaries/node/versions/22.12.0/bin:$PATH"   # if node is not on PATH
BASE=http://localhost:3000
TK=$(curl -s -X POST $BASE/api/user -H 'Content-Type: application/json' \
      -d '{"nickname":"smoke_'$RANDOM'"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).user.token')
A="X-Token: $TK"

curl -s $BASE/api/mailbox -H "$A" | head -c 200            # welcome mail exists
curl -s -X POST $BASE/api/robots -H "$A" -H 'Content-Type: application/json' \
     -d '{"name":"루미","template":"doro","palette":{"body":"#5cae7f"}}' | head -c 200
curl -s $BASE/api/workshop/status -H "$A" | head -c 200
curl -s -X POST $BASE/api/workshop/recolor -H "$A" -H 'Content-Type: application/json' \
     -d '{"palette":{"body":"#f2a65a"}}' | head -c 120      # 1/day
curl -s -X POST $BASE/api/class/attend -H "$A" -H 'Content-Type: application/json' \
     -d '{"code":"1004"}' | head -c 140                       # +100 cells, once/week
curl -s $BASE/api/board/me -H "$A" | head -c 200
curl -s -H 'X-Admin-Key: dorobus-admin' $BASE/api/admin/stats | head -c 200
```

Expected: repeated calls to recolor/attend/quest return `400` with a Korean message — that is correct behaviour.

---

## 14. Gotchas

1. **Same filename rebuild = stale preview.** If you regenerate the deck/pptx with the same name, external
   viewers may keep the cached copy. Use a new filename (this bit us on `중간발표-10월26일.pptx` → `-v2`).
2. **`node:sqlite` needs the flag.** `node server.js` without `--experimental-sqlite` fails on Node 22.
3. **Demo seed wipes the demo account.** `POST /api/demo/seed` deletes that user's rows first; don't point it
   at a real test subject.
4. **`ADMIN_KEY` unset ⇒ 503 everywhere in /api/admin.** That is intentional; set it in the deploy env.
5. **LLM keys may live in text files** (`gemini_key.txt`, `deepseek_key.txt`). Never commit or share them.
6. **Class code is global**, not per-teacher. If multiple classes use the service, extend `weekly_topics`
   or add a `classes` table before scaling.
7. **`users.nickname` is UNIQUE** — signup is create-or-load, so a returning child with the same nickname
   gets the same account (no password). Fine for a prototype, not for production.
8. **Timezone**: all dates use `Asia/Seoul` via `Intl.DateTimeFormat('sv-SE')`. Don't switch to UTC.
