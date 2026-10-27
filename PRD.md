# PRD — YuyuFX

Status: **approved 2026-10-27** · Owner: Youmu · Last updated: 2026-10-27

## 1. Problem
Youmu wants to trade stocks with the help of automation and AI, and to learn trading while doing it. Hosted trading platforms hide how their automation works, cost money, or don't let you plug in your own strategies and local AI models. YuyuFX is a self-built, local-first tool where every strategy, check and decision is visible and testable.

TODO: confirm this framing.

## 2. Users
| User | Need |
|---|---|
| Youmu (sole user, owner) | Log in securely, see the status of trades and strategies at a glance, let strategies trade automatically, and place manual trades. |
| Youmu (learner) | Understand why the system made each decision, and measure whether a strategy is any good before trusting it. |

## 3. Goals
- G1. Automated stock trading driven by strategies Youmu can read, test and switch on/off.
- G2. Manual trading from the same dashboard.
- G3. A secure, login-protected dashboard showing trades, positions and strategy status.
- G4. Runs locally on Youmu's PC, reaching the web for market data and the broker. Can be deployed later without a rewrite.
- G5. Security as a first-class requirement, since real money may be involved.
- G6. Learning: every feature has testable acceptance criteria, and quality is measured with evals (including backtests and LLM-output quality).

## 4. Non-goals
- No cryptocurrency, of any kind.
- No paid data sources or paid APIs: market data is free or open-source only.
- No other users. YuyuFX has one user, Youmu, with a login (decided 2026-10-27, because recommending investments to other people is regulated in Canada). Tables still carry a user id, so adding users later is possible if that is ever revisited.
- No 2FA in the MVP (moved to "Later").
- Not a high-frequency or intraday system. Strategies run once per trading day, in a configured window (see F4).

## 5. Features
Each acceptance criterion (AC) has an id and says how it's checked: **[unit]** automated test, **[int]** integration test, **[eval]** measured by an eval, **[manual]** checked by hand.

Most criteria below are placeholders to be filled in during Phase 1 review, once the open questions are answered. They are not decided yet.

### F1. Login and session (MVP)
- **AC1.1** WHEN a visitor is not logged in AND opens any dashboard page or API route, THE system SHALL redirect to the login page (pages) or return 401 (API). [int]
- **AC1.2** WHEN valid credentials are submitted, THE system SHALL start a session. [int]
- **AC1.3** WHEN invalid credentials are submitted repeatedly, THE system SHALL rate-limit further attempts. [int] TODO: limit and window.
- TODO: password storage method, 2FA yes/no, session length (see `ARCHITECTURE.md`).

### F2. Dashboard: trades and status (MVP)
- **AC2.1** WHEN Youmu opens the dashboard, THE system SHALL show open positions, recent orders with their status, and which strategies are on. [manual]
- TODO: exact data shown, refresh method (polling vs live updates).

### F3. Manual trading (MVP)
- **AC3.1** WHEN Youmu submits a manual order, THE system SHALL validate it (symbol, quantity, order type) and pass it through the risk checks (F5) before it is executed (paper: in the simulator; live: as a prepared order, see F8). [unit]
- **AC3.2** WHEN an order is placed, THE system SHALL record it with a timestamp, source (manual / rules / AI), and result (simulated fill, or the fill Youmu confirms in live mode). [int]
- TODO: which order types (market, limit, stop) are in the MVP.

### F4. Automated strategies
- **AC4.1** WHEN a strategy is switched on AND its signal fires, THE system SHALL create an order that goes through the same validation and risk checks as a manual order. [unit]
- **AC4.2** WHEN a strategy is switched off, THE system SHALL stop creating new orders from it. [unit]
- **AC4.3** WHEN the configured daily trading window opens (default 7:30–9:30 AM Pacific, which is 10:30 AM–12:30 PM Eastern, inside TSX hours) AND it is a trading day on the configured exchange, THE system SHALL run the enabled strategies once. [unit]
- **AC4.4** WHEN the window falls outside the exchange's open hours, THE system SHALL queue orders for the open or skip them, per config, and log which. [unit]
- TODO: first strategy to build. To be informed by the research thread on open-source trading systems.

### F9. Region and broker settings
- **AC9.1** WHEN Youmu sets a country, exchange, currency and timezone in settings, THE system SHALL use them for market hours, holidays, symbols and amounts. Default: Canada, TSX, CAD. [unit]
- **AC9.2** WHEN the broker is changed, THE system SHALL use the matching broker adapter without changes to strategy code. [unit]

### F5. Risk checks and kill switch
- **AC5.1** WHEN an order would break any risk rule (starting values in `ARCHITECTURE.md` §6: risk per trade, max position size, max open positions, daily loss, max drawdown, symbol whitelist, price/quantity sanity, rate limit), THE system SHALL reject it and log why. [unit]
- **AC5.3** WHEN data is stale, the broker connection drops, or broker and database disagree on positions, THE system SHALL pause automation and show why. [int]
- **AC5.2** WHEN Youmu presses the kill switch, THE system SHALL stop all strategies from placing new orders. [int]
- Kill switch cancels all open orders; closing positions too is an option at press time.

### F6. Backtesting
- **AC6.1** WHEN a strategy is run against historical data, THE system SHALL produce a report of trades and summary metrics. [int]
- TODO: data source, metrics (see Evals).

### F7. AI trading decisions (local LLM)
The AI decides what to trade. Every AI decision goes through the deterministic risk checks (F5). In paper mode the app executes it automatically in its own simulator; in live mode it becomes a prepared order that Youmu places by hand (F8).
- **AC7.1** WHEN the daily run finishes, THE system SHALL show every AI decision (buy/sell/hold, symbol, size), whether it was placed or rejected by the risk checks, and the data and reasoning behind it. [manual]
- **AC7.2** WHEN the AI makes a buy or sell decision, THE system SHALL turn it into an order and pass it through the same validation and risk checks as a manual order; if it passes, the order is executed automatically in paper mode, or becomes a prepared order in live mode. [unit]
- **AC7.4** WHEN the AI output is malformed or refers to data it wasn't given, THE system SHALL place no order and log why. [unit]
- **AC7.3** WHEN Youmu opens a recommendation, THE system SHALL explain the terms used (teaching). [manual]
- **AC7.5** WHEN the "ask me first" setting is on AND the AI makes a buy or sell decision, THE system SHALL hold the order until Youmu approves or rejects it on the dashboard, and only then run the risk checks. Default: off. [unit]
- **AC7.6** WHEN a held AI order is not approved before the trading window closes, THE system SHALL drop it and log that it expired. [unit]
- AI decisions are for Youmu's own account only (see Q8).

### F8. Paper vs live trading
Decided 2026-10-27: Canadian rules (CIRO) stop Canadian residents from placing orders for Canadian stocks from their own software (IBKR rejects them; Questrade's order API is partner-only). So:
- **Paper mode is fully automatic.** YuyuFX runs its own simulated broker on real TSX prices. No broker account involved.
- **Live mode is "the app decides, Youmu clicks".** YuyuFX does everything up to the order, then shows a prepared order that Youmu places in the broker's own app.
- **AC8.4** WHEN an order passes the risk checks in live mode, THE system SHALL show a prepared order (symbol, side, quantity, order type, limit and stop prices) that can be copied into the broker app in under a minute. [manual]
- **AC8.5** WHEN Youmu marks a prepared order as placed, THE system SHALL record it and ask for (or read from the broker, see Q2) the fill price and quantity. WHEN Youmu skips it, or the window closes, THE system SHALL record it as not placed. [unit]
- **AC8.6** WHEN live positions in YuyuFX differ from the broker's (read-only sync or Youmu's entry), THE system SHALL flag it and pause new prepared orders until resolved. [int]
- **AC8.1** WHEN the app starts, THE system SHALL run in paper-trading mode unless live mode is explicitly enabled in settings. [unit]
- **AC8.2** WHEN Youmu switches to live mode, THE system SHALL ask for confirmation and show the active risk limits. [manual]
- **AC8.3** WHEN in live mode, THE system SHALL show that clearly on every screen (see `DESIGN.md`). [manual]
- TODO: rule for when a strategy may go live (e.g. after N days in paper with results reviewed).

## 6. Evals
| Id | What | How | Target |
|---|---|---|---|
| E1 | Strategy quality | Backtest on held-out historical data; report return, max drawdown, Sharpe ratio, win rate vs. buy-and-hold | TODO |
| E2 | Recommendation quality | Backtest the recommendations on past data, plus a fixed set of cases scored by rubric (reasoning matches data, no made-up numbers) | TODO |
| E3 | LLM latency on Youmu's PC | Time per response for the chosen Qwen model | TODO |
| E4 | Order-path safety | Suite of malformed / over-limit orders; all must be rejected | 100% rejected |

## 7. Open questions
- ~~Q1. Paper only?~~ Answered 2026-10-27: real-money trading is wanted. Paper first for testing, then live (F8).
- Q2. Which broker for live trades (placed by hand)? No broker is needed for paper mode. Since orders are placed by hand, any Canadian broker works. A broker with a free **read-only** API is a plus: it can feed TSX prices (Q5) and sync positions and fills (AC8.5–8.6). Proposed: **Questrade** (free read API for quotes, candles and account data; order API is partner-only, which doesn't matter now). IBKR Canada also works for placing by hand. Decide before Phase 8. Checked 2026-10-27: [Questrade API](https://www.questrade.com/api), [IBKR reply](https://community.portfolio123.com/t/canada-trading-with-interactive-brokers-is-now-enabled/70876?page=2).
- ~~Q3. Timezone?~~ Answered: Pacific. The 7:30–9:30 AM window falls inside TSX hours.
- ~~Q4. What is the LLM for?~~ Answered: decide trades, executed automatically in paper mode and prepared for Youmu in live mode, after risk checks (F7). PC: RTX 4070 (12 GB VRAM), 32 GB RAM. Research suggests `qwen3:14b`. TODO: confirm with eval E3 before deciding.
- Q5. Free market-data source for TSX daily prices. Options (from the research report; to verify before building data ingest):
  - (a) **Questrade API**: free quotes and daily candles for TSX stocks, with a Questrade account (also covers Q2).
  - (b) **IBKR's own data**, with an IBKR account. TSX data may need a paid subscription; check the cost.
  - (c) **Alpha Vantage** free tier: daily adjusted prices, no broker account, but only 25 requests/day. Good as a backup. TODO: confirm TSX coverage.
  - Free extras either way: Bank of Canada Valet API (rates, FX), SEDAR+ (Canadian filings, no API), SEC EDGAR and FRED (US).
  - Proposed: (a), with (c) as a backup. Paper mode only needs data, so this is needed from Phase 4 on.
- ~~Q6. 2FA?~~ Answered: not for now.
- Q7. Findings from the open-source trading systems research may change F4, F6 and the stack.
- ~~Q8. Rules for advising others?~~ Answered: avoided by keeping Youmu as the only user. Login stays; 2FA later.
