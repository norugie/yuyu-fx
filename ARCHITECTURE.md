# ARCHITECTURE — YuyuFX

Status: **approved 2026-10-27** · Last updated: 2026-10-27 (task 2.1)

## 1. Stack
| Part | Choice | Why |
|---|---|---|
| Language | TypeScript (strict), front and back | Youmu's choice; one language end to end, types catch mistakes in money paths. |
| Runtime | Node.js 24 (LTS; 24.18 installed) | Youmu's choice. `engines.node` is `>=24`. `.env` is loaded with Node's built-in `process.loadEnvFile` (no dotenv); shell variables win over `.env`. |
| API server | Express | Youmu's choice. One process holds the API, strategy engine, risk engine and scheduler to start. |
| Database | PostgreSQL | Youmu's choice; transactional, holds bars, orders, fills, audit log and LLM calls. Not installed yet (Phase 0). |
| ORM | Drizzle ORM + `pg` (node-postgres) driver | Youmu's choice; typed schema, parameterised queries. Migrations are SQL files generated with `drizzle-kit generate` into `drizzle/` and applied with `drizzle-kit migrate` (never `push`, so every schema change is reviewable and recorded). `pg` is Drizzle's default Postgres driver; postgres.js was the alternative. |
| Validation | Zod | Validate every request body, broker response and LLM output at the boundary. Trading schemas live in `packages/shared/src/trading.ts`, shared by server and web. |
| Money | Decimal strings in TypeScript/JSON (`"130.25"`), `numeric(14, 4)` in Postgres | Binary floats can't represent most prices exactly, and rounding errors add up in P&L. Arithmetic on them is decided in task 3.5. |
| Simulated fills and costs | Pure rules in `apps/server/src/broker/fill-rules.ts`, applied by `broker/simulated.ts` in one DB transaction per step (open orders locked). Market: quote + 5 bp slippage, rounded to the TSX tick against you. Limit: fills at the quote once it reaches the limit. Stop: triggers at the stop, then fills like a market order. Bracket exits activate after the entry fills; one fills, the other is cancelled. Fees: CAD 0.01/share, min 1.00, max 0.5% (modelled on IBKR Canada fixed pricing). Whole fills only (no partial fills). | Charging realistic costs keeps paper results honest. Pure functions make every rule testable on fixed price paths. Money math is BigInt in 1/10,000-dollar units (`src/money.ts`). |
| Prices (until Phase 4) | `PriceSource` interface (`apps/server/src/data/price-source.ts`) with a `manual` source: Youmu types prices, stored in `quotes` | Decision D1 (PRD Q5). A real data source implements the same interface. A quote is stale when it's from an earlier day in Toronto time; a TSX calendar refines this later. |
| Background jobs | pg-boss (Postgres-backed queue) — proposed | Data sync and LLM calls take seconds; a queue in Postgres means no extra service. |
| Frontend | React + Vite | Youmu's choice. |
| UI | Tailwind CSS v4 (`@tailwindcss/vite`) + shadcn/ui (Nova preset, Radix base, Lucide icons, Geist font) | Youmu's choice. Components are copied into `apps/web/src/components/ui/` by the shadcn CLI, so they're our code. Routing is a ~40-line `src/lib/router.tsx` (six fixed pages), not a routing library; revisit if pages need parameters. |
| Data fetching (web) | TanStack Query — proposed | Caching and refetching for dashboard data. |
| Charts | Lightweight Charts — proposed | Candlestick charts. |
| Live updates to browser | Server-Sent Events — proposed | Server pushes status and prices; simpler than WebSocket for one-way updates. |
| Indicators | Own small TypeScript module (SMA, EMA, RSI, ATR) with tests | Easy to write, good learning exercise, no dependency. |
| Local LLM | Ollama + `qwen3:14b` (candidate), via the `ollama` npm package or its OpenAI-compatible endpoint | Fits the RTX 4070 (about 9.3 GB of 12 GB). Compare in eval E3 with `qwen3.5:9b` and `qwen3:30b` (spills to RAM, slower, fine once a day). |
| Broker | Paper: YuyuFX's own `simulated` broker. Live: `manual` adapter (prepared orders Youmu places by hand), optional read-only sync from Questrade (proposed, PRD Q2) | Canadian rules block Canadians from sending orders for TSX stocks from their own software. |
| Market data | Questrade API, read-only personal app (PRD Q5/F10): `apps/server/src/data/questrade/`. Daily bars in `daily_bars` (synced with `npm run data:sync`), live quotes via `PriceSource` with typed-in fallback, refreshed every 60 s for symbols with open orders. | Free with the account; real-time TSX quotes (Questrade reports `delay` 0). Refresh tokens are single-use: each new one is stored encrypted (AES-256-GCM, `SECRETS_KEY`) before the access token is used; the `.env` token only bootstraps. |
| Auth | Argon2id password hash (`@node-rs/argon2`, OWASP minimum: 19 MiB, 2 passes). Server sessions in a `sessions` table: the cookie holds a random token, the table stores only its HMAC-SHA256 (keyed by `SESSION_SECRET`). Cookie is httpOnly + SameSite=Strict, plus Secure when `WEB_ORIGIN` is https. 30-minute idle timeout, new session on every login. CSRF: Origin check on every state-changing `/api` request, plus a synchronizer token (per session, sent in `X-CSRF-Token`). Login rate limit 5 failures / 15 min per IP + username (in memory). | Single user with a login. 2FA (TOTP) later. Synchronizer token over double-submit cookie: we already keep sessions server-side, so the token can live there; it's OWASP's first recommendation. Own small modules instead of express-session / csurf / express-rate-limit: each piece is a few lines, fully tested, and csurf is deprecated. |
| Security headers | Helmet (default headers incl. CSP on API responses), `cors` allowing only `WEB_ORIGIN` | Cheap protection for a money app. The dashboard's own CSP (served by Vite in dev) comes with deployment. |
| Tests | Vitest | Same config style as Vite; one `npm test` runs every workspace (root `vitest.config.ts`, `test.projects`). Integration tests use the local Postgres but each test file gets its own throwaway schema (`test_<random>`, dropped afterwards), because the `yuyufx` role can't create databases; real data in `public` is never touched. They call the real Express app with Node's `fetch` (no supertest). |
| Dev tooling | tsx (runs the server from TypeScript, `tsx watch` in dev), concurrently (runs server and web together for `npm run dev`) | tsx avoids a compile step while the app is local; concurrently is one small dev-only package versus hand-rolled process handling. A server compile step is added when deploying. |

"Proposed" items come from the research report. Each is confirmed (with version and source) when installed, with the "why, and what was the smaller alternative" note from `CLAUDE.md`.

**Not used, on purpose:**
- Cryptocurrency exchanges or libraries (Freqtrade, Hummingbot, Jesse are crypto-only).
- Paid data APIs.
- Scraping (e.g. Yahoo Finance): unofficial and breaks without notice.
- Python engines (NautilusTrader, LEAN, Qlib, TradingAgents): we borrow their designs, not their code, to stay in TypeScript.
- Reinforcement learning (FinRL style): hardest to make work, easiest to overfit.
- Cloud-hosted LLMs, to stay free and local.

## 2. Design in one line
**Three signal sources (rules, AI, Youmu) feed one risk engine, and only the risk engine can reach a broker adapter.** The `simulated` adapter runs backtests and fully automatic paper trading; the `manual` adapter turns live orders into prepared orders for Youmu.

Patterns borrowed:
- **One event-driven core, same code in backtest, paper and live** (NautilusTrader, LEAN). Market data, orders and fills are events on one loop.
- **Module boundaries** (LEAN): data, strategy (signals), portfolio, risk, execution (broker), reporting.
- **Analyst team for the AI** (TradingAgents): analysts (news, filings, technicals) → bull vs. bear debate → trade proposal → risk review.
- **Kill switch and tamper-evident trade log** (ai-hedge-fund).

## 3. Data flow
```
 [Market data] ──1──▶ [Data sync job] ──2──▶ [PostgreSQL: bars, filings, news]
                                                   │
                                                   3  daily run, 7:30–9:30 AM PT
                                                   ▼
                      [Rules strategies] ───────┐
                                                │
 [Ollama] ◀─4─▶ [AI analyst job] ──(ask me first?)──5──▶ [Risk engine] ──6──▶ [Broker adapter] ──▶ simulated (paper)
                                                │              │                           └──▶ manual: prepared order → Youmu places it in the broker app (live)
 [Dashboard] ──7 manual order───────────────────┘              └── rejected → audit log
      ▲                                                                       │
      │                                                                       8 fills, positions
      └──────────── 9 status, decisions, P&L (SSE) ──── [Express API] ◀───────┘
```

1. The data sync job fetches daily bars, quotes, news and filings from free sources.
2. They're stored in Postgres (split- and dividend-adjusted bars).
3. The scheduler starts the daily run in Youmu's window, only on trading days of the configured exchange.
4. The AI analyst job reads stored data, calls Ollama, and returns a decision as JSON, validated by Zod. The LLM has no tools and no broker access.
5. Rules strategies, the AI, and manual orders all produce the same "proposed order" type. If "ask me first" is on, AI orders wait for Youmu's OK here.
6. The risk engine checks every proposed order (section 6). Approved orders go to the broker adapter: filled by the simulator in paper mode, or shown to Youmu as a prepared order in live mode.
7. Manual orders from the dashboard join the same path.
8. Fills and positions are stored: simulated fills in paper mode; in live mode, fills Youmu confirms or a read-only broker sync, reconciled with the database.
9. The dashboard gets status, decisions with reasoning, and P&L over SSE.

Automation stops on its own when data is stale, or (live) when the broker's positions disagree with the database.

## 4. Folder structure
Proposal.

```
yuyu-fx/
  apps/
    server/
      src/
        api/          Express routes, auth
        data/         data source adapters + sync jobs
        engine/       event loop, scheduler, market calendar
        strategies/   plain functions: bars in → proposed orders out
        ai/           Ollama client, prompts, output schemas
        risk/         risk rules (one module, fully unit tested)
        broker/       Broker interface + adapters (simulated, manual, read-only sync)
        db/           Drizzle schema
      tests/
    web/
      src/
      tests/
  packages/
    shared/           Types shared by server and web (orders, positions, decisions)
  drizzle/            Migrations
  evals/              Backtests and LLM evals
  .env.example
```

Workspace tool: **npm workspaces** (`apps/*`, `packages/*`). Shared TypeScript settings live in `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`). `packages/shared` is consumed as TypeScript source (no build step). Tests go in a `tests/` folder per app.

Rule: **strategies are plain functions** that take bars (only up to the current bar) and return proposed orders. That one rule lets backtest, paper and live share them.

## 5. Broker adapter
One `Broker` interface: place order, cancel order, positions, balances, quotes. Adapters:
- `simulated`: fills at the next price plus slippage and fees. Used for backtests and for fully automatic paper trading on real TSX prices.
- `manual`: for live mode. "Placing" an order creates a prepared order on the dashboard; Youmu places it in the broker's app and marks it placed (with fill) or skipped.
- Read-only sync (optional, later): reads positions, fills and quotes from the broker's API (Questrade proposed) to fill in and check what Youmu entered.

Why not send live orders automatically: Canadian dealer rules (CIRO, formerly IIROC) stop Canadian residents from placing orders for Canadian stocks from their own software. IBKR Canada rejects such orders ("API/CTCI orders for canadian stocks are not allowed", IBKR replies quoted on QuantConnect and Portfolio123, March 2025). Questrade's order API is for partner developers only. Checked 2026-10-27. If this changes, an automatic live adapter can be added behind the same interface without touching strategies or risk code.

Country, exchange, currency, timezone and broker are user settings (PRD F9).

## 6. Risk engine
Every order, from a strategy, the AI or Youmu, passes the same pre-trade checks. Any failure rejects the order and logs why. The broker client is only reachable through this module. Starting values come from the research report and are tunable in settings:

| Rule | Starting value |
|---|---|
| Risk per trade | 1% of equity between entry and stop |
| Max position size | 10% of equity per stock |
| Max open positions | 10 |
| Daily loss limit | 3% of equity; automation stops until tomorrow |
| Max drawdown halt | 15% from peak; Youmu must re-enable |
| Every entry has a stop | Bracket orders by default |
| Allowed symbols | Whitelist (e.g. TSX 60 and S&P 500 stocks and ETFs) |
| Order sanity | Price within a few % of last quote; quantity under a cap |
| Rate limit | Max orders per minute |
| Kill switch | Cancel all orders, optionally close positions |

## 7. Backtesting
The backtester is the same event loop, fed by stored bars instead of live data, with the `simulated` broker. It fills at the next bar's open plus slippage and fees. The report shows total return, max drawdown, Sharpe ratio, win rate and number of trades, against a benchmark (XIU for TSX, SPY for US).

Guards against backtests that lie: fill at the next bar (no look-ahead), use adjusted prices, charge costs, hold out the last 20–30% of history, look for 100+ trades, and treat results as optimistic (free data lacks delisted stocks). After a backtest, run on paper for a few weeks and compare.

## 8. AI layer
- Ollama on localhost, called from the job queue, never from a request handler.
- Output is JSON in a schema (Ollama `format` field), validated with Zod. Invalid output means no order.
- Good uses: summarise filings and news, score headline sentiment, explain each trade in plain words, write a daily journal, turn a plain-English idea into a strategy config Youmu reviews.
- Not trusted for: predicting prices, sizing positions, or calling the broker. Sizing comes from the risk rules.
- News and filings are untrusted input (prompt injection). Prompts never contain keys, account numbers or balances.
- Every prompt, response and model name is stored with the decision it fed.

## 9. Security
- Broker API tokens (read-only) are encrypted at rest in Postgres (AES-256-GCM, master key from env or the OS keychain). `.env` is only for paper-only development. Paper and live keys are separate.
- Keys never reach the browser or the LLM.
- Switching to live, changing risk limits, or placing a large manual order asks for the password again.
- API, Postgres and Ollama bind to 127.0.0.1 while local. A later deploy uses HTTPS behind a reverse proxy, ideally over a VPN such as Tailscale.
- Append-only, hash-chained audit log of logins, settings changes, orders and fills.
- Lockfile, `npm audit`, few dependencies around the money path.

## 10. Key trade-offs
| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| Where it runs | Locally on Youmu's PC | Cloud hosting from day one | Free, private, simpler; config is env-based so deploying later is possible. |
| Engine | One event-driven core for backtest, paper and live | A separate backtest script | "It worked in testing" surprises come from code that differs between test and live. |
| Order safety | One order path with risk checks for manual, rules and AI orders | Separate paths per source | One place to test and secure. |
| Trading mode | Paper by default | Live by default | Mistakes should cost nothing while learning. |
| Live execution | App prepares, Youmu places by hand | Automatic API orders; US stocks instead | Canadian rules block API orders for TSX stocks, and Youmu wants TSX only. |
| LLM role | LLM decides trades; code validates and risk-checks, then executes them (paper) or prepares them for Youmu (live); optional "ask me first" | LLM calls the broker directly | LLM output can be wrong or malformed, so a deterministic check sits between it and real money. |
| Timeframe | Daily bars, one run per day | Intraday | Fits free data and the 7:30–9:30 AM PT window, avoids day-trading rules, and keeps every decision easy to inspect. |
| Other projects' engines | Borrow designs, write in TypeScript | Run NautilusTrader or LEAN | The stack stays TypeScript, and building it is the learning. |

## 11. Things to confirm while building
- Questrade read-only API: terms allow personal use for data and account sync; rate limits.
- Free data source for TSX bars (PRD Q5).
- `qwen3:14b` vs. alternatives on Youmu's hardware (eval E3). Newer Qwen tags come from third-party lists; confirm on ollama.com.
- Market calendar source for TSX holidays.
- pg-boss, TanStack Query, Lightweight Charts: confirm each is still the right pick when installed.

## Sources (checked 2026-10-27)
- Research report "YuyuFX research: building an AI-assisted stock trading system": https://claude.ai/artifact/2X3GqYgM3nZU9ZQrpQqTfZ. Its own sources are listed there (NautilusTrader, LEAN, TradingAgents, ai-hedge-fund, IBKR, Questrade, Alpaca, Ollama docs).
- Versions installed in task 2.1, checked via `npm view <pkg> version` on 2026-10-27 (exact versions are in `package-lock.json`):
  - Server: express 5.3.0, zod 4.6.7, tsx 4.23.15, @types/express 5.0.6, @types/node 24.19.2 (24.x line on purpose, to match the Node 24 runtime; latest is 26.6.5).
  - Web: react 19.3.1, react-dom 19.3.1, vite 8.3.5, @vitejs/plugin-react 6.1.2, @types/react 19.3.0, @types/react-dom 19.3.0.
  - Root: typescript 7.0.2 (the native-compiler release; still ships `tsc`), vitest 5.0.5, concurrently 10.0.6.
- Task 2.2, checked via `npm view` on 2026-10-27: drizzle-orm 0.45.4 and drizzle-kit 0.31.11 (latest stable; 1.0 is still a release candidate), pg 8.23.1, @types/pg 8.23.1. Driver API checked in `drizzle-orm/node-postgres/driver.d.ts`; config options in `drizzle-kit/index.d.ts`. `npm audit`: 4 moderate, all from an old esbuild inside drizzle-kit (GHSA-67mh-4wv8-2f99, affects esbuild's dev server, which drizzle-kit does not use); dev-only, accepted for now.
- Task 2.3, checked via `npm view` on 2026-10-27: @node-rs/argon2 2.2.2 (prebuilt binaries, no install script; Node 24's built-in `crypto.argon2` was the smaller alternative, but it's newer and would need hand-written hash-string parsing in security code), helmet 8.3.0, cors 2.8.6 + @types/cors 2.8.19. Argon2 settings: OWASP Password Storage Cheat Sheet. CSRF approach: OWASP CSRF Prevention Cheat Sheet (synchronizer token + Origin verification).
- Task 2.4, checked via `npm view` on 2026-10-27: tailwindcss 4.3.3, @tailwindcss/vite 4.3.3, shadcn 4.22.1 (CLI, run as `npx shadcn@4.22.1 init -t vite -b radix -p nova` then `add badge card input label separator sheet empty table`), which installed radix-ui 1.8.1, class-variance-authority 0.7.1, lucide-react 1.61.0, tw-animate-css 1.4.0, @fontsource-variable/geist 5.3.0 and `cn` 0.5.0 (shadcn's own replacement for clsx + tailwind-merge; repo shadcn-ui/cn, maintainer shadcn). Install steps: ui.shadcn.com/docs/installation/vite and /docs/theming (read 2026-10-26). Difference from the docs: no `baseUrl` in tsconfig, because TypeScript 7 removed it; `paths` alone works.
- Task 4 (2026-10-27): Questrade API docs (getting started, authorization, security, rate limiting; symbols/search, markets/quotes, markets/candles), as summarised by the coordinator and confirmed live: token response has `access_token`, `expires_in`, a new `refresh_token`, `api_server`; TSX symbols are `XXX.TO`; quotes include `delay` (0 for XIU/RY = real-time); daily candles' `start` carries the exchange date and offset. Market-data limit 20/s; 429 handled with wait + retry.
- Data notes (checked on the synced data): no split-like jumps in XIU/RY over 10 years (only March 2020 moves); XIU has no bars for 2017-07-12 to 2017-07-27 on Questrade. Bars are price-only (dividends not included), so buy-and-hold returns are understated by the dividend yield; adjustment source still TODO.
- Node `process.loadEnvFile`: Node.js docs, https://nodejs.org/api/process.html#processloadenvfilepath (behaviour "shell values are not overwritten" confirmed by a local test on Node 24.18).
- Zod 4 `z.url({ protocol })`: zod.dev/api#urls; covered by `apps/server/tests/config.test.ts`.
