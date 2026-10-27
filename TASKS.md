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
- [x] 0.1 Install Node.js (LTS). (verified by Youmu 2026-10-27: Node 24.18)
  - **Verify:** `node -v` and `npm -v` print versions.
- [x] 0.2 Install PostgreSQL and create a `yuyufx` database and user. (verified by Youmu 2026-10-27: db `yuyufx`)
  - **Verify:** `psql -U <user> -d yuyufx -c "select version();"` prints the version.
- [x] 0.3 Install Ollama and pull a Qwen model (size TBD, see PRD Q4). (verified by Youmu 2026-10-27: `qwen3:14b`)
  - **Verify:** `ollama list` shows the model; `ollama run <model> "hello"` replies.
- [x] 0.4 (Before Phase 4) Open a Questrade account and get a read-only API token for TSX data (PRD Q2/Q5, if confirmed). (Youmu, 2026-10-27; live quote + candles verified with `npm run data:check`)
  - **Verify:** the token is in `.env` (not committed) and a test quote for a TSX symbol (e.g. XIU) comes back.

## Phase 1 — Project docs
- [x] 1.1 `CLAUDE.md` approved (2026-10-27)
- [x] 1.2 `PRD.md` approved (open questions answered or parked)
- [x] 1.3 `ARCHITECTURE.md` approved
- [x] 1.4 `DESIGN.md` approved
- [x] 1.5 Fold in findings from the open-source trading systems research (2026-10-27; `ARCHITECTURE.md` rewritten and re-approved)
- [x] 1.6 `TASKS.md` approved (this file)
- [x] 1.7 `PROGRESS.md` created
- [x] 1.8 Youmu commits and pushes the docs (2026-10-27)

## Phase 2 — Skeleton and login
### 2.1 Project skeleton
- [x] Done 2026-10-27 (verify output in `PROGRESS.md`).
Server and web apps, strict TypeScript, test runner, env validation at startup.
- **Verify:** `npm run dev` starts both apps; `npm test` runs one passing test; starting without required env vars fails with a clear message.

### 2.2 Database connection and first migration
- [x] Done 2026-10-27 (migration `drizzle/0000_create_users.sql` applied; verify output in `PROGRESS.md`).
Drizzle schema for users; migration applied.
- **Verify:** migration runs against local Postgres; table exists.

### 2.3 Login (F1) 🧑‍🎓 for the auth tests
- [x] Done 2026-10-27, full implementation chosen by Youmu (verify output in `PROGRESS.md`). Youmu's own account is still to be created with `npm run user:create`.
- Covers AC1.1–AC1.3.
- **Verify:** integration tests for redirect/401, login, rate limit pass.

### 2.4 Dashboard shell (F2, DESIGN)
- [x] Done 2026-10-27 (screenshots and checks in `PROGRESS.md`). DESIGN.md §3/§6 proposals await Youmu's review.
Logged-in layout with empty states.
- **Verify:** manual check against `DESIGN.md` at desktop and phone width.

Outline of later phases, following the research report's learning path. Each phase is split into numbered tasks with Verify steps when we get to it.

## Phase 3 — Manual paper trading (F3)
`simulated` broker adapter; order ticket (market, limit, bracket), positions, order history. Uses stored or delayed TSX prices.
- **Phase check:** place and close 20 manual paper trades and explain each one.

> **Split approved by Youmu 2026-10-27, with the recommended option for each decision (recorded in PRD F3 and Q5):**
> - **D1. Where prices come from before Phase 4.** Options: (a) Questrade read-only API: real quotes, but needs a Questrade account (task 0.4); (b) Alpha Vantage free tier: free key, 25 requests/day, TSX coverage not yet confirmed; (c) Youmu types the current price in the order ticket / a "set price" box, stored as a quote with source `manual`. **Chosen: (c)** now, behind a `PriceSource` interface, so Phase 4 swaps in Questrade (or Alpha Vantage) without touching the broker or UI. No account or key needed, and typing prices from the broker app teaches how fills relate to quotes. Downside: fills are only as real as the typed price.
> - **D2. Order types in the MVP.** Chosen: market, limit, and bracket (entry + stop-loss + take-profit), matching ARCHITECTURE §6 "every entry has a stop". No stand-alone stop orders yet.
> - **D3. Risk checks before Phase 5.** AC3.1 says orders pass the F5 risk checks, but the risk engine is Phase 5. Chosen: Phase 3 adds the risk-engine *slot* with only the sanity rules (allowed symbol format, quantity cap, price within a few % of the last quote, paper mode only); Phase 5 fills in the rest. Code and docs then agree.

### 3.1 Orders, fills and positions data model
- [x] Done 2026-10-27 (migration `drizzle/0002_add_trading.sql` applied).
Shared types + Zod schemas (`packages/shared`), Drizzle tables `orders`, `fills`, `quotes` (each with user id, source manual/rules/AI, timestamps), migration.
- Covers: AC3.2 (storage side).
- **Verify:** migration applied; unit tests for the schemas (bad symbol, zero/negative quantity, limit without price all rejected).

### 3.2 Price source: manual quotes
- [x] Done 2026-10-27.
`PriceSource` interface + `manual` implementation; API to set and read the latest quote for a symbol; quotes older than one trading day are marked stale.
- Covers: groundwork for AC5.3 (stale data).
- **Verify:** integration tests (set → read, stale flag, auth/CSRF required).

### 3.3 Simulated broker 🧑‍🎓
- [x] Done 2026-10-27 (full implementation, chosen by Youmu).
`Broker` interface + `simulated` adapter as pure functions: market fills at the quote ± slippage plus fees; limit fills when a new quote crosses the limit; bracket children activate after the entry fills; cancel.
- Covers: ARCHITECTURE §5; part of AC3.2 (simulated fill).
- **Verify:** unit tests with fixed price paths (fill, no fill, partial bracket exit, cancel).

### 3.4 Order path
- [x] Done 2026-10-27 (built before the pause, re-verified on resume: `tests/sanity.test.ts`, `tests/orders-api.test.ts`).
`POST /api/orders`: validate (AC3.1) → sanity risk checks → simulated broker → record order and fill (AC3.2) → audit log line. Paper mode only (AC8.1); anything else is refused (fail closed).
- Covers: AC3.1, AC3.2, AC8.1, first cases of E4.
- **Verify:** integration tests, including every rejected case logged with its reason and no fill recorded.

### 3.5 Positions and P&L 🧑‍🎓
- [x] Done 2026-10-27 (`tests/positions.test.ts`, portfolio cases in `tests/orders-api.test.ts`).
Pure functions: positions from fills (average cost), realised and unrealised P&L, fees; `GET /api/portfolio` (cash, equity, today's P&L, open positions), `GET /api/orders`.
- Covers: AC2.1 (data side).
- **Verify:** unit tests with worked examples (buy, add, partial sell, full close, fees).

### 3.6 Order ticket UI
- [x] Done 2026-10-27 (manual check + screenshots, see PROGRESS.md).
New order page: symbol, side, quantity, type (D2), prices; review-and-confirm step; states for validation error and rejected-by-risk. Mode badge stays visible.
- Covers: AC3.1 (UI), DESIGN §4 order form.
- **Verify:** manual check at 1440 and 390 px, light and dark; screenshots.

### 3.7 Positions & orders and Overview with real data
- [x] Done 2026-10-27 (manual check at 1440/390 px, light/dark; cancel covered by `tests/orders-api.test.ts` and checked in the UI).
Positions table and order history (stacked rows on phones), cancel open orders, Overview tiles filled (equity, today's P&L with sign + colour, open positions).
- Covers: AC2.1, DESIGN §5 (gain/loss not by colour alone), §6.
- **Verify:** manual check against DESIGN.md at both widths; integration test for cancel.

### 3.8 Phase check
- [x] Reported done by Youmu 2026-10-27 (20 manual paper trades). **Phase 3 complete.** Note 2026-10-27 18:05: the yuyufx database holds no orders or fills for any user, so the trades couldn't be checked. Asked Youmu where they were placed.
Youmu places and closes 20 manual paper trades and writes one line on each.
- **Verify:** 20 closed trades in the order history; P&L matches a hand calculation for 3 of them.

## Phase 4 — Data and backtester (F6, F10, E1)
Questrade (PRD Q5) into Postgres, event loop, simulated broker, metrics vs. benchmark.
- **Phase check:** a moving-average strategy backtest you can reproduce exactly.

Split 2026-10-27 (Youmu: build fully, stop only for real decisions or when the real token is needed).

### 4.1 Data model for symbols, daily bars and credentials
- [x] Done 2026-10-27 (migration 0003 applied).
Tables `instruments` (symbol, exchange, currency, Questrade symbol id), `daily_bars` (symbol + date unique; OHLC as numeric, volume), `broker_credentials` (encrypted refresh token); quote source `questrade`.
- Covers: AC10.1 (storage), AC10.3 (storage).
- **Verify:** migration applied; DB tests for uniqueness and OHLC checks.

### 4.2 Secret encryption
- [x] Done 2026-10-27.
AES-256-GCM helper, key from env `SECRETS_KEY` (32 bytes, hex), validated at startup when Questrade is configured.
- Covers: AC10.3, ARCHITECTURE §9.
- **Verify:** unit tests: round trip, wrong key fails, tampered data fails, no plaintext in the stored value.

### 4.3 Questrade client
- [x] Done 2026-10-27 (fake-server tests + live check: XIU and RY quotes and candles).
Token refresh with rotation: the `.env` token (`QUESTRADE_REFRESH_TOKEN`) is used only to bootstrap; each new refresh token is stored encrypted and used next time. Access token in memory only. Symbol search (TSX `.TO` mapping), quotes, daily candles (paged), Zod-validated responses, client-side rate limit + 429 retry.
- Covers: AC10.3, AC10.4.
- **Verify:** tests against a fake Questrade server with recorded-shape responses. **Live check (needs the real token):** one quote and one month of XIU candles.

### 4.4 Questrade prices with typed-in fallback
- [x] Done 2026-10-27 (tests with the fake server; live quotes verified via the same client).
`PriceSource` backed by Questrade (short cache), storing quotes with source `questrade`; falls back to stored/typed prices; resting orders re-checked when new quotes arrive (poller for symbols with open orders). Order ticket shows the source.
- Covers: AC10.2.
- **Verify:** tests with the fake server (fresh quote used; outage falls back; source shown). Live check needs the token.

### 4.5 Daily-bar sync job
- [x] Done 2026-10-27 (live: 10 years of XIU and RY synced; re-run adds nothing).
`npm run data:sync`: for each symbol in `MARKET_DATA_SYMBOLS` (default XIU), fetch candles since the last stored date (or N years back) and upsert. Idempotent; logs counts.
- Covers: AC10.1.
- **Verify:** tests with the fake server (first sync, second sync adds nothing, gap filled). Live run needs the token.

### 4.6 Backtester (event loop) 🧑‍🎓
- [x] Done 2026-10-27 (full implementation per Youmu).
Pure loop over daily bars: strategy sees bars up to today, orders fill at the next open with the simulated broker's slippage and fees; equity curve; no look-ahead.
- Covers: AC6.1, AC6.2.
- **Verify:** unit tests on synthetic bars, including a test that fails if the strategy can see the future.

### 4.7 Metrics and benchmark 🧑‍🎓
- [x] Done 2026-10-27 (full implementation per Youmu).
Total return, max drawdown, Sharpe (daily, annualised, risk-free 0), win rate, trades; in-sample vs held-out last 30%; buy-and-hold XIU benchmark.
- Covers: AC6.3, E1.
- **Verify:** unit tests with hand-computed series.

### 4.8 Moving-average crossover strategy + backtest CLI
- [x] Done 2026-10-27.
Plain strategy function (fast/slow SMA on closes, long or flat). `npm run backtest -- --symbol XIU --fast 20 --slow 50` reads stored bars, prints the report and saves JSON with input and result hashes under `evals/backtests/`.
- Covers: AC6.1, AC6.4.
- **Verify:** unit tests for the strategy; CLI run on stored bars twice gives the same result hash.

### 4.9 Phase check (needs real data)
- [ ] Reproducibility done 2026-10-27 (XIU and RY MA 20/50: two runs each, identical result hashes; reports in `evals/backtests/`). **Waiting for Youmu to read the report.**
Sync real XIU bars, run the MA backtest, re-run it and get the identical report; Youmu reads the report.
- **Verify:** two runs, same hash; report reviewed by Youmu.

## Phase 5 — Risk engine (F5, E4)
All rules in `ARCHITECTURE.md` §6 plus the kill switch. 🧑‍🎓
- **Phase check:** every rule has a test proving it blocks a bad order.

Split 2026-10-27 (Youmu: build fully). Replaces the Phase 3 sanity checks.

### 5.1 Risk settings and trading state
- [x] Done 2026-10-27 (migration 0004 applied).
Tables `risk_settings` (per user, defaults from ARCHITECTURE §6) and `trading_state` (equity peak, halts, kill switch). `GET /api/risk`.
- Covers: AC5.1 (configuration), AC5.5 (state).
- **Verify:** migration applied; tests for defaults.

### 5.2 Risk rules (pure)
- [x] Done 2026-10-27 (`tests/risk-rules.test.ts`: every rule blocks a bad order; mutation check done).
One function per rule, each returning a rule id and a plain reason: paper only, halted (automation), whitelist, price present and fresh, quantity cap, limit/exit price distance, stop required, risk per trade, position size, open positions, cash, no short selling, orders per minute.
- Covers: AC5.1, E4.
- **Verify:** one unit test per rule proving it blocks a bad order, and that a good order passes.

### 5.3 Order gateway: the only path to the broker
- [x] Done 2026-10-27 (`tests/risk-gateway.test.ts`, incl. the architecture test).
Gateway loads the context (portfolio, open orders, settings, state, recent orders), runs the rules, records rejections with the rule id, then calls the broker. Place, cancel and kill switch all go through it; the old sanity module is removed.
- Covers: AC5.4, AC3.1.
- **Verify:** integration tests through the API; a test that fails if any other module calls `broker.place`.

### 5.4 Account guards
- [x] Done 2026-10-27 (daily loss, drawdown, stale data tested).
Equity peak tracking; daily-loss halt until the next trading day; drawdown halt until re-enabled; stale-data pause; automated orders refused while halted.
- Covers: AC5.5, AC5.3 (stale data).
- **Verify:** integration tests with a moving clock and prices.

### 5.5 Kill switch
- [x] Done 2026-10-27 (cancel + flatten + resume tested).
`POST /api/risk/kill-switch` cancels all open orders and optionally sells all positions; blocks automation until re-enabled (`POST /api/risk/resume`, password).
- Covers: AC5.2, AC5.6.
- **Verify:** integration tests.

### 5.6 Risk on the dashboard
- [ ] **Paused by Youmu 2026-10-27.** Built (Settings page limits form with password dialog; Automation card with kill switch on Overview and Settings); API password tests pass; typecheck and build ok. **Not yet done:** the manual browser check and screenshots.
Settings page: view and edit limits and the whitelist (password asked again). Overview: automation status and the kill switch (looks dangerous, asks for confirmation).
- Covers: AC5.6, DESIGN §1 and §4.
- **Verify:** API tests for the password check; manual check with screenshots.

### 5.7 Phase check
- [x] Done 2026-10-27 (`tests/e4-order-safety.test.ts`: 26/26 bad orders refused, none filled; plus one test per rule).
Every rule has a test that blocks a bad order; E4 suite of malformed and over-limit orders is 100% rejected.
- **Verify:** test run shown.

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
- Password strength rule for accounts (e.g. check against common-password lists), decided with Youmu; today `user:create` only requires 12+ characters.
- Change-password command (`npm run user:password`), so a weak or shared password can be replaced without deleting the account.
- Persist the login rate limit (it resets when the server restarts) if the app is ever deployed.
- Clean up expired rows in `sessions` periodically (they are deleted only when someone tries to use them).
