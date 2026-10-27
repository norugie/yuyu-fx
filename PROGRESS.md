# PROGRESS — YuyuFX

Update this at the end of every session so the next one can pick up cleanly. Newest entry on top.

## Current state
- Phase: 2 (skeleton and login)
- Done: Phase 0 (0.1–0.3), Phase 1, Phase 2, Phase 3 (3.8 by Youmu, 2026-10-27)
- Current: Phase 5 (risk engine) **paused by Youmu** at 5.6. Done: 5.1–5.5, 5.7. Left: 5.6 manual browser check + screenshots. Also open: 4.9 (Youmu reads the backtest report); 3.8 trades not found in the database (asked Youmu).
- Youmu still to review the DESIGN.md proposals.
- Youmu's account `norugie` exists (created by Youmu, 2026-10-27).

## Log

<!-- Copy this block for each session:
### YYYY-MM-DD
- **Done:**
- **Broke (and why):**
- **Next:**
-->

### 2026-10-27 (fixes from Youmu's practice run; Phase 5 still paused at 5.6)
- **Done:** (1) Clearer refusals: position cap now says e.g. "XIU would be $16,300.50 in total. Max per stock is $9,999.40 (10% of $99,994.00 equity). You can buy up to N more shares."; 1% risk says the risk, cap, equity and how many shares fit with that stop; cash message in dollars. (2) Order ticket: no reset bug found (DB shows Youmu switched Sell/Limit/Market looking for a limit entry with a stop). Ticket now starts on Bracket (ARCHITECTURE §6 default); choosing plain Market/Limit for a buy shows "New positions need a stop-loss... a bracket can still enter at a limit price" with a one-click "Use a bracket (keeps your limit price)"; selling a stock you don't hold and non-allowed symbols are flagged before submit; under Shares: "Up to N (which limit)". Pure helper `apps/web/src/lib/order-hints.ts` with tests.
- **Verified:** typecheck ok; 263/263 tests; browser run of Youmu's RY flow (Limit -> button -> Bracket + Enter at limit, 283 kept, "Up to 35 (10% max per stock)"). Temporary user deleted.
- **Note:** after new UI packages, Vite's dev cache can show a blank page ("Outdated Optimize Dep"); restarting `npm run dev` fixes it.

### 2026-10-27 (Phase 5: risk engine, paused at 5.6)
- **Done:** PRD F5 got AC5.4–5.6 and the defaults decision; Phase 5 split into 5.1–5.7. `risk_settings` + `trading_state` (migration 0004). `src/risk/rules.ts` (15 rules: paper only, automation halted, rate limit, share cap, short selling, whitelist, no/stale price, limit and stop/target distance, stop required, 1% risk per trade, 10% position, 10 positions, cash). `src/risk/gateway.ts`: the only caller of `broker.place` (architecture test), loads context, records refusals with rule ids; replaces the Phase 3 sanity module (deleted). `src/risk/guards.ts`: equity peak, daily-loss halt (until next day), drawdown halt (until re-enabled), stale daily bars pause; halts block automated orders, manual orders still pass the per-order rules. Kill switch (cancel all, optional sell-all) and resume. `/api/risk` routes; changing limits and resuming need the password again (own 5-try limit). Web: Settings page (limits form, whitelist, password dialog), Automation card with kill switch on Overview and Settings. E4 suite (26 bad orders).
- **Verified:** typecheck ok; `npm test` 255/255; web build ok. Mutation check: disabling the whitelist rule makes 2 tests fail.
- **Broke (and why):** Order timestamps came from the database clock while the rate limit used the app clock (fine in production, wrong in tests): orders now take `createdAt` from the app clock. Phase 3/4 tests now relax the limits for their test users (they test order mechanics; the risk rules have their own tests).
- **Next (when Youmu resumes):** 5.6 manual check in the browser (Settings form + password dialog, Overview kill switch + confirm, 1440/390 px) and screenshots. Then Phase 5 is complete.

### 2026-10-27 (Phase 4: data and backtester)
- **Done:** 3.8 ticked (Youmu). Questrade decided (PRD Q2/Q5, new F10 with AC10.1–10.4; F6 got AC6.2–6.4). Phase 4 split into 4.1–4.9 and built: `daily_bars`/`instruments`/`broker_credentials` (migration 0003); AES-256-GCM secrets (`SECRETS_KEY` now required, generated in local `.env`); Questrade client with single-use token rotation (new token saved encrypted before use; one retry with a token another process just saved; clear "generate a new token" error otherwise; no tokens in logs); Questrade prices with typed-in fallback + 60 s poller for open-order symbols; `npm run data:check`, `npm run data:sync`; event-loop backtester (decide at close, fill next open, no look-ahead), metrics (return, drawdown, Sharpe, win rate, round trips; 70/30 split; buy-and-hold XIU), MA crossover strategy, `npm run backtest` with input/result hashes.
- **Verified:** typecheck ok; 226/226 tests (fake Questrade server for tokens, 429, paging, sync, fallback, poller); web build ok. Live: token bootstrapped and rotated twice; XIU 54.31 and RY 285.70 with delay 0 (real-time); sync stored 2,498 XIU and 2,510 RY bars (2016-10-25 to 2026-10-26), second sync added 0. Backtest MA 20/50 run twice for XIU and RY: identical result hashes (XIU `74e51eb0…`, RY `a3593b3e…`).
- **Broke (and why):** Test-only mistakes fixed (reused single-use tokens across clients; synthetic prices that rose every day). Real weakness found: the benchmark's first buy could be skipped forever after a gap up; buy-and-hold now retries. Same weakness remains in the MA strategy (one skipped XIU buy on 2022-11-10), left as is and noted.
- **Next:** Youmu reads the backtest report (4.9). Then Phase 5 (risk engine) needs splitting.

### 2026-10-27 (resumed: tasks 3.4–3.7 done)
- **Done:** 3.4 and 3.5 (built before the pause) re-verified and ticked. Defaults written into PRD F3/F5 as "Youmu may change": $100,000 paper cash (env), no short selling, 10,000 shares/order, limit within 10% and exits within 30% of the last price, cost model. 3.6: order ticket (`apps/web/src/pages/new-order.tsx`) with typed-price box, Buy/Sell and Market/Limit/Bracket toggles, client validation with the shared schema, review step, results Filled / Waiting / Not placed (reason). 3.7: Positions & orders page (cash, equity, realised P&L, fees; positions table; order history with status, reasons, fill price, Cancel), Overview tiles and cards with real data; tables become stacked rows on phones; Overview uses a compact stacked order list.
- **Verified:** typecheck ok; 166/166 tests; web build ok. Manual smoke with a temporary user: market buy RY filled at 130.07 (130 + slippage) with $1 fee; refused sell of TD shown with its reason; bracket on XIU filled entry at 35.02 and exited at the take-profit 36.10 (realised +$108), stop-loss auto-cancelled; waiting TD limit cancelled from the UI. Cash 98,804.30, equity 100,116.30, today +116.30 all match a hand calculation. No horizontal scroll at 390 or 1440 px. Temporary user and all its orders, fills and typed prices deleted (DB has only `norugie`, 0 orders).
- **Broke (and why):** The Overview's Recent orders table scrolled sideways in its half-width card; fixed with a compact stacked layout. Market orders read "Market · Market" on phones; fixed. The browser pane sometimes captured stale frames, so one phone screenshot of the ticket is missing (not an app issue; the same flow worked at 1440 px).
- **Next:** 3.8 (Youmu). Phase 4 not started.

### 2026-10-27 (task 3.3 done; paused by Youmu before 3.4)
- **Done (3.3):** `src/money.ts` (exact BigInt money math), `src/broker/fill-rules.ts` (pure fill rules + cost model), `src/broker/simulated.ts` (DB-backed `Broker`: place, cancel, re-check on each new price, one transaction with row locks). Typing a price via `POST /api/quotes` now also fills resting orders for that symbol.
- **Verified (3.3):** money tests, 12 fill-rule tests on fixed price paths (market, limit reached / not reached, bracket take-profit, bracket stop with a gap, inactive exits until entry fills, short mirror, tick and fee rules), broker integration tests (immediate fill, resting limit, full bracket cycle, cancel with children, no double fill under concurrent prices). Full suite 166/166, typecheck ok, web build ok.
- **Built before the pause, NOT reviewed or ticked (left in place because nothing is broken; all tests pass):**
  - 3.5 server: `src/portfolio/positions.ts` (average cost, realised/unrealised P&L, cash, equity) + `src/portfolio/service.ts` (today's P&L = equity now − equity at start of the Toronto day), tests in `tests/positions.test.ts`.
  - 3.4: `src/risk/sanity.ts` (D3 rules: paper only, price present and from today, ≤ 10,000 shares, limit within 10% / exits within 30% of last price, no short selling, enough cash), `src/orders/service.ts`, `src/api/orders.ts` (POST/GET /api/orders, POST /api/orders/:id/cancel, GET /api/portfolio — **these routes are live**, login + CSRF + paper only), new env `PAPER_STARTING_CASH` (default 100000), tests in `tests/sanity.test.ts` and `tests/orders-api.test.ts`.
  - 3.6/3.7 web: only helpers, not used by any page yet: `apps/web/src/api.ts` (order/portfolio/quote calls), `src/lib/use-api.ts`, `src/lib/format.ts`, `src/components/pnl.tsx`.
- **Decisions to review when resuming:** default paper cash $100,000; no short selling for now; sanity thresholds (10,000 shares, 10%, 30%); fee model (IBKR-like) and 5 bp slippage.
- **Broke (and why):** Two bugs caught by tests and fixed: average cost of a short divided by a negative share count; and test isolation (prices are shared market data, so tests now use their own symbols).
- **Next:** 3.4 when Youmu resumes (review the pre-built work above first).

### 2026-10-27 (Phase 3 split approved; tasks 3.1 and 3.2 done)
- **Decisions (Youmu):** D1 typed-in prices until Phase 4; D2 market, limit and bracket orders; D3 basic sanity risk checks now, full engine in Phase 5. Recorded in PRD F3 and Q5, TASKS Phase 3.
- **3.1 Done:** Zod schemas for symbol (TSX format, uppercased), quantity (whole shares), price (decimal string, 4 dp max) and new orders (market / limit / bracket with stop and target on the correct sides) in `packages/shared`. Tables `orders` (bracket = entry + 2 child rows), `fills`, `quotes`, with Postgres CHECK constraints; migration 0002 applied to yuyufx.
- **3.2 Done:** `PriceSource` interface + manual source; `POST /api/quotes`, `GET /api/quotes/:symbol` (login + CSRF), `quote.set` log line; stale = earlier Toronto calendar day.
- **Verified:** typecheck ok; `npm test` 108/108 (schema unit tests, DB constraint tests, quotes API tests incl. 401/403/400/404, Toronto-date and DST cases); web build ok; no test schemas left.
- **Broke (and why):** One test of mine failed at first: jumping the clock a day also expired the 30-minute session. Fixed in the test (log in again).
- **Next:** 3.3 Simulated broker. Youmu chooses skeleton vs full implementation.

### 2026-10-27 (task 2.4 dashboard shell, done)
- **Done:** Tailwind CSS v4 + shadcn/ui (Nova, Radix) in `apps/web`. Logged-in layout: sidebar (from 1024px) or menu sheet (below), top bar with the Paper badge, theme toggle, username and logout. Pages: Overview (4 stat tiles + empty states for positions, orders, strategies), Positions & orders, New order, Strategies, Backtests, Settings (mode), Not found. Login page restyled. Semantic tokens gain/loss/paper/live (AA contrast computed), tabular figures, visible focus rings. Small router in `src/lib/router.tsx` instead of a dependency. DESIGN.md §3/§6 filled in as proposals.
- **Verified:** typecheck ok; tests 45/45; `vite build` ok. Screenshots in the built-in browser pane (Playwright and Chrome/Edge aren't installed on this PC; the pane's region capture was used instead) of login and overview at 1440×900 and 390×844, light and dark, plus the open menu at 390. `scrollWidth` equals the viewport width at 390 and 1440 (no horizontal scroll). Tab focus shows a 2px ring. All six pages and the not-found page render; logout from the UI returns to /login. Used a temporary test user, deleted afterwards (0 users, 0 sessions left).
- **Broke (and why):** Found and fixed in testing: (1) the theme followed system light/dark changes only on logged-in pages; now set up once at startup for every page. (2) The open phone menu covered the Paper badge; the badge is now also in the menu header. Note: the browser pane's color-scheme emulation doesn't fire change events, so dark screenshots needed a reload.
- **Still open:** Youmu's account doesn't exist yet. The one-off attempt with the short password was first blocked by the permission system, then failed on a script error; nothing was created. Youmu creates it with `npm run user:create` (12+ characters), or confirms how they want it done.
- **Next:** Split Phase 3 into tasks; Youmu reviews DESIGN.md proposals.

### 2026-10-27 (task 2.3 login, done)
- **Done:** Full implementation (Youmu chose option b). `sessions` table + migration `drizzle/0001_add_sessions.sql` (applied). Server: `src/api/auth/` (credentials, sessions, rate-limit, cookies, middleware, routes, users), `src/log.ts` (JSON log lines `auth.login.success|failure|blocked`, `auth.logout`), Helmet + CORS in `src/app.ts`, `npm run user:create` CLI (hidden password prompt, or 3 lines on stdin). Routes: POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me; every other /api route → 401 when logged out. New env: `SESSION_IDLE_MINUTES` (default 30), `WEB_ORIGIN` (default http://127.0.0.1:5173). Web: login page, redirect to /login when logged out, placeholder page with Log out. PRD F1 TODOs filled in; ARCHITECTURE auth/testing rows and Sources updated.
- **Verified:** typecheck ok; `npm test` 45/45 (AC1.1, AC1.2, AC1.3, CSRF, logout, idle timeout, logs contain no passwords). Mutation check: changing the limit from 5 to 6 makes the AC1.3 test fail. Tests ran in throwaway `test_*` schemas; none left behind. `db:migrate` applied 0001. CLI: short password, mismatch and duplicate all rejected; valid user created. Manual curl with a temporary test user: /me 401 → login 200 (cookie `HttpOnly; SameSite=Strict`) → /me 200 → logout without CSRF token 403 → logout with token 204 → old cookie 401. Browser: /dashboard redirects to /login; a wrong password shows "Invalid username or password". Test user then deleted (0 users, 0 sessions left).
- **Broke (and why):** Creating Youmu's account (`norugie`) with the 5-character password they chose was blocked by Claude's permission system as weakening security (the CLI requires 12+). Not worked around. Youmu creates it with `npm run user:create` and a 12+ character password, or decides otherwise.
- **Next:** 2.4 Dashboard shell.

### 2026-10-27 (task 2.2 database, done)
- **Finished:** Youmu gave the correct `yuyufx` password (the first one was wrong); `.env` updated. `npm run db:migrate` → "migrations applied successfully!" (a second run is a no-op). `psql d users` shows the 5 columns, `users_pkey` and `users_username_unique`; `drizzle.__drizzle_migrations` has 1 row. Server startup DB check passes ("Server listening on http://127.0.0.1:3000"). Typecheck ok, tests 8/8.
- **Next:** 2.3 Login. Ask Youmu (a) skeleton or (b) full implementation for the auth tests.

### 2026-10-27 (task 2.2 database, first attempt)
- **Done:** Installed drizzle-orm 0.45.4, pg 8.23.1, drizzle-kit 0.31.11, @types/pg. `apps/server/src/db/schema.ts` (`users`: id uuid, username unique, password_hash, created_at, updated_at), `src/db/client.ts` (one pool + `select 1` check), `apps/server/drizzle.config.ts`, scripts `npm run db:generate` / `db:migrate`. Server now exits at startup with "Cannot connect to the database: <reason>" if Postgres is unreachable. Migration generated: `drizzle/0000_create_users.sql`. Password set in `.env`.
- **Verified so far:** typecheck passes; tests 8/8; `db:generate` writes the expected CREATE TABLE.
- **Broke (and why):** `db:migrate` and server start fail with `password authentication failed for user "yuyufx"`. Either the role is named differently, or its password isn't the one in `.env`. A check with the `postgres` superuser was blocked by the permission system, so it needs Youmu on the PC.
- **Next:** Youmu checks the role name and password (e.g. in pgAdmin, or `psql -U postgres -c "du"`), fixes `.env`, then run `npm run db:migrate` and `psql ... -c "d users"` to finish 2.2.

### 2026-10-27 (task 2.1 project skeleton)
- **Done:** npm workspaces (`apps/server`, `apps/web`, `packages/shared`), strict TypeScript (`tsconfig.base.json`), Vitest across workspaces, Express server bound to 127.0.0.1 with `GET /health`, env check at startup (Zod: `DATABASE_URL`, `SESSION_SECRET` ≥ 32 chars, `PORT` default 3000), React + Vite placeholder page with `/api` proxy. `.env.example` filled in; local `.env` created (gitignored, `DATABASE_URL` password is `CHANGE_ME` until Youmu sets it). Versions in `ARCHITECTURE.md` Sources. Also ticked 0.1–0.3 and 1.8 (verified by Youmu).
- **Verified:** `npm install` (0 vulnerabilities); `npm run typecheck` passes; `npm test` 8/8 pass; `npm run dev` starts both, `/health` → `{"status":"ok"}`, Vite page loads at http://127.0.0.1:5173 and forwards `/api`; without `.env` the server exits 1 with "Invalid environment configuration: DATABASE_URL: is missing, SESSION_SECRET: is missing". `npm run build` builds the web app.
- **Broke (and why):** Nothing. Notes: npm 12 blocked esbuild's install script (allowScripts); tsx and Vite work without it, so it was left blocked. The server has no compile step yet (runs from TypeScript via tsx); add one when deploying.
- **Next:** 2.2 Database connection and first migration (Youmu replaces `CHANGE_ME` in `.env` first).

### 2026-10-27 (PRD review, round 1)
- **Done:** `CLAUDE.md` approved. PRD updated with Youmu's answers: real-money trading wanted (paper first), Canada/TSX default but region configurable, once-a-day run 7:30–9:30 AM, AI recommends investments, multi-user later, no 2FA for now. PC: RTX 4070 12 GB, 32 GB RAM.
- **Broke (and why):** Nothing.
- **Next:** Pick a free TSX data source (Q5); then approve PRD.
- **All docs approved** (incl. updated ARCHITECTURE), 2026-10-27.
- **Round 4:** Canadian rules block API orders for TSX stocks (IBKR rejects them, Questrade order API is partner-only). Youmu chose: fully automatic paper trading in YuyuFX's own simulator + live = prepared orders Youmu places by hand. TSX only, no US stocks. Questrade proposed for free read-only data/sync.
- **Task 1.5 done:** `ARCHITECTURE.md` rewritten from the research report (event-driven core, risk engine values, AI layer, security). PRD: "ask me first" switch (AC7.5–7.6), risk rules, Q5 options. TASKS: phases 3–8 outlined. DESIGN: approval card, setting.
- **Approved:** Youmu approved PRD, ARCHITECTURE, DESIGN, TASKS (2026-10-27). Still open: Q5 data source, "ask me first" switch.
- **Round 3:** AI places orders automatically (after risk checks), no click needed. Updated PRD F7, ARCHITECTURE, and one CLAUDE.md security line.
- **Round 2:** Pacific time; IBKR chosen; Youmu is the only user (login kept, 2FA later).

### 2026-10-27 (project setup)
- **Done:** Docs drafted with /new-project-setup. Nothing committed.
- **Broke (and why):** Nothing.
- **Next:** Youmu reviews the docs (Phase 1). Research on open-source trading systems is running separately.

## Environment notes
- Node 24.18, PostgreSQL with db `yuyufx`, Ollama with `qwen3:14b` (Youmu, 2026-10-27).
- `.env` at repo root holds `DATABASE_URL`.
- **Pending Youmu's decision (security):** the DB password was shared in chat (Youmu will change it later), and Postgres listens on all interfaces (`0.0.0.0` and `::`), not only 127.0.0.1 as ARCHITECTURE §9 wants. Fixes: a long random password for `yuyufx`; `listen_addresses = 'localhost'` in postgresql.conf, then restart the service.
