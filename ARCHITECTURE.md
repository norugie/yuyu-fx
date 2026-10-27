# ARCHITECTURE — YuyuFX

Status: **approved 2026-10-27** · Last updated: 2026-10-27

## 1. Stack
| Part | Choice | Why |
|---|---|---|
| Language | TypeScript (strict), front and back | Youmu's choice; one language end to end, types catch mistakes in money paths. |
| Runtime | Node.js (LTS) | Youmu's choice. TODO: pin version at install. |
| API server | Express | Youmu's choice. One process holds the API, strategy engine, risk engine and scheduler to start. |
| Database | PostgreSQL | Youmu's choice; transactional, holds bars, orders, fills, audit log and LLM calls. Not installed yet (Phase 0). |
| ORM | Drizzle ORM | Youmu's choice; typed schema, parameterised queries, migrations in code. |
| Validation | Zod | Validate every request body, broker response and LLM output at the boundary. |
| Background jobs | pg-boss (Postgres-backed queue) — proposed | Data sync and LLM calls take seconds; a queue in Postgres means no extra service. |
| Frontend | React + Vite | Youmu's choice. |
| UI | Tailwind CSS + shadcn/ui | Youmu's choice. |
| Data fetching (web) | TanStack Query — proposed | Caching and refetching for dashboard data. |
| Charts | Lightweight Charts — proposed | Candlestick charts. |
| Live updates to browser | Server-Sent Events — proposed | Server pushes status and prices; simpler than WebSocket for one-way updates. |
| Indicators | Own small TypeScript module (SMA, EMA, RSI, ATR) with tests | Easy to write, good learning exercise, no dependency. |
| Local LLM | Ollama + `qwen3:14b` (candidate), via the `ollama` npm package or its OpenAI-compatible endpoint | Fits the RTX 4070 (about 9.3 GB of 12 GB). Compare in eval E3 with `qwen3.5:9b` and `qwen3:30b` (spills to RAM, slower, fine once a day). |
| Broker | Paper: YuyuFX's own `simulated` broker. Live: `manual` adapter (prepared orders Youmu places by hand), optional read-only sync from Questrade (proposed, PRD Q2) | Canadian rules block Canadians from sending orders for TSX stocks from their own software. |
| Market data | TODO (PRD Q5) | Free only. Cached in Postgres so each source is called once. |
| Auth | Argon2id password hash, server sessions in httpOnly / Secure / SameSite=Strict cookies, CSRF protection, login rate limit | Single user with a login. 2FA (TOTP) later. |
| Security headers | Helmet, strict CORS allowlist, Content Security Policy | Cheap protection for a money app. |
| Tests | TODO (e.g. Vitest) | Decide in Phase 2. |

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

TODO: workspace tool (npm or pnpm workspaces). Tests go in a `tests/` folder per app.

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
- No version numbers pinned yet; each is recorded here when installed.
