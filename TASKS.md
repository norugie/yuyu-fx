# TASKS — YuyuFX

Status: **approved 2026-10-27** · Last updated: 2026-10-27

How to use this file:
- Work on **one task at a time**, top to bottom, following the loop in `CLAUDE.md`.
- Each task names the PRD criteria (AC) or evals (E) it covers and **how it's verified**. A task is done only when its "Verify" step has been run and shown.
- Tick the box when done, and note it in `PROGRESS.md`.
- New ideas go to the "Later" list at the bottom, not into the current task.
- 🧑‍🎓 marks tasks where Claude asks whether Youmu wants to write it (skeleton + description) or wants the full implementation.

---

## Phase 0 — Environment
- [ ] 0.1 Install Node.js (LTS).
  - **Verify:** `node -v` and `npm -v` print versions.
- [ ] 0.2 Install PostgreSQL and create a `yuyufx` database and user.
  - **Verify:** `psql -U <user> -d yuyufx -c "select version();"` prints the version.
- [ ] 0.3 Install Ollama and pull a Qwen model (size TBD, see PRD Q4).
  - **Verify:** `ollama list` shows the model; `ollama run <model> "hello"` replies.
- [ ] 0.4 (Before Phase 4) Open a Questrade account and get a read-only API token for TSX data (PRD Q2/Q5, if confirmed).
  - **Verify:** the token is in `.env` (not committed) and a test quote for a TSX symbol (e.g. XIU) comes back.

## Phase 1 — Project docs
- [x] 1.1 `CLAUDE.md` approved (2026-10-27)
- [x] 1.2 `PRD.md` approved (open questions answered or parked)
- [x] 1.3 `ARCHITECTURE.md` approved
- [x] 1.4 `DESIGN.md` approved
- [x] 1.5 Fold in findings from the open-source trading systems research (2026-10-27; `ARCHITECTURE.md` rewritten and re-approved)
- [x] 1.6 `TASKS.md` approved (this file)
- [x] 1.7 `PROGRESS.md` created
- [ ] 1.8 Youmu commits and pushes the docs

## Phase 2 — Skeleton and login
### 2.1 Project skeleton
Server and web apps, strict TypeScript, test runner, env validation at startup.
- **Verify:** `npm run dev` starts both apps; `npm test` runs one passing test; starting without required env vars fails with a clear message.

### 2.2 Database connection and first migration
Drizzle schema for users; migration applied.
- **Verify:** migration runs against local Postgres; table exists.

### 2.3 Login (F1) 🧑‍🎓 for the auth tests
- Covers AC1.1–AC1.3.
- **Verify:** integration tests for redirect/401, login, rate limit pass.

### 2.4 Dashboard shell (F2, DESIGN)
Logged-in layout with empty states.
- **Verify:** manual check against `DESIGN.md` at desktop and phone width.

Outline of later phases, following the research report's learning path. Each phase is split into numbered tasks with Verify steps when we get to it.

## Phase 3 — Manual paper trading (F3)
`simulated` broker adapter; order ticket (market, limit, bracket), positions, order history. Uses stored or delayed TSX prices.
- **Phase check:** place and close 20 manual paper trades and explain each one.

## Phase 4 — Data and backtester (F6, E1)
Free data source (PRD Q5) into Postgres, event loop, simulated broker, metrics vs. benchmark.
- **Phase check:** a moving-average strategy backtest you can reproduce exactly.

## Phase 5 — Risk engine (F5, E4)
All rules in `ARCHITECTURE.md` §6 plus the kill switch. 🧑‍🎓
- **Phase check:** every rule has a test proving it blocks a bad order.

## Phase 6 — Automation on paper (F4)
Daily run in the 7:30–9:30 AM PT window, reconciliation with the broker, auto-pause.
- **Phase check:** four weeks unattended with paper results close to the backtest.

## Phase 7 — AI layer (F7, E2, E3)
Pick the Qwen model (E3), summaries and explanations, then the analyst team, "ask me first" switch. 🧑‍🎓 for evals
- **Phase check:** the AI-assisted strategy beats the plain rules version in backtest and on paper, or it gets dropped.

## Phase 8 — Real money (F8)
`manual` adapter: prepared orders Youmu places in the broker app, fill entry, optional read-only sync. Small capped amount, tighter limits; paper keeps running alongside.
- **Phase check:** a month live with results in line with paper.

---

## Later (not scheduled)
- Switching a strategy to live trading (after it has run in paper and the results are reviewed, PRD F8).
- Deploying online (still single user, PRD non-goals).
- 2FA (not in MVP, per Youmu).
