# CLAUDE.md — YuyuFX working rules

Claude Code loads this file automatically at the start of every session. It holds the rules for how we work on this project. The *what* lives in `PRD.md`, the *how* in `ARCHITECTURE.md`, the *order* in `TASKS.md`, and the *where we left off* in `PROGRESS.md`. The *look and feel* lives in `DESIGN.md`.

## Project in one paragraph

YuyuFX is a stock-trading web app for Youmu. It automates trading on stock markets with AI-assisted strategies, and it also lets Youmu place trades by hand. It is an admin-style dashboard you log in to, to check the status of trades and strategies. It runs locally on Youmu's PC but talks to the web (market data, broker), and may be deployed live later. Because it handles money, **security is a top priority**. No cryptocurrency. It is also a learning project: for **trading and quantitative research**, for **AI engineering** (local LLMs via Ollama), for **spec-driven development**, and for **evals**.

## Notes vault

Obsidian vault: C:\Users\Youmu\Documents\Obsidian\Yuyu-FX

## Start of every session

1. Read `PROGRESS.md` to see what's done, what broke, and what's next.
2. Read the current task in `TASKS.md` and its acceptance criteria in `PRD.md`.
3. Say which task you're picking up before doing anything else.

## The loop (one task at a time)

For each task in `TASKS.md`:

1. **Investigate.** Read the relevant code and docs. Check current library docs (see "Verify, don't assume").
2. **Plan.** Write a short plan: files to touch, approach, how it will be verified.
3. **Wait for Youmu's approval** of the plan.
4. **Implement** the smallest change that meets the acceptance criteria.
5. **Verify.** Run the tests, evals, or manual check named in the task. Show the output.
6. **Summarize** what changed and why, in plain language.
7. **Update `PROGRESS.md`** (done / broke and why / next).

Only work on one task at a time. If a task turns out to be too big, stop and propose splitting it in `TASKS.md`.

## Docs first, code second

- Don't write code for a task until the task is in `TASKS.md` and its acceptance criteria are in `PRD.md`.
- If something new comes up mid-task, add it to `TASKS.md` (and `PRD.md` if it's a feature) and ask before doing it.
- If the code and the docs disagree, stop and ask which one is right. Then fix the other one.

## Teaching mode

Youmu is learning, so:

- **Explain the "why".** For decisions specific to this domain (trading terms and order types, risk management, backtesting and its pitfalls, quant techniques, LLM prompting and evaluation, auth and security), give a brief plain-language explanation. Assume full-stack web experience, not trading or AI-engineering experience.
- **Let Youmu write some of it.** For evals especially, **ask each time** whether Youmu wants:
  - (a) a skeleton plus a description of what to implement, or
  - (b) the full implementation.
- When offering a skeleton, include the function signatures, types, and `TODO` comments describing the expected behaviour, plus how to run it.
- Nothing here is financial advice. When a trading idea comes up, explain how it works and how to test it, not whether to bet money on it.

## Verify, don't assume

- Check current docs before using an API for: Express, Drizzle ORM, PostgreSQL, React, Vite, Tailwind CSS, shadcn/ui, Ollama (and the chosen Qwen model), and the broker and market-data APIs once chosen. TODO: refine this list as libraries are picked.
- Prefer the official docs and the library's own source/README over blog posts.
- When you rely on a version number or API shape, say where you checked it.

## Coding style

- TypeScript in `strict` mode. No `any` unless there's a comment explaining why.
- Small modules with one job each. Pure functions where possible, so they're easy to unit test (strategy and risk logic especially).
- Config comes from environment variables, validated once at startup. Fail fast with a clear message if something is missing.
- Errors: never crash on one bad input. Log it, skip it, keep going. Exception: anything that could place a wrong order fails closed (no order) rather than guessing.
- Logs are short and useful: what happened, which id, how long it took. Never log secrets, API keys, passwords, or session tokens.
- Tests sit next to what they test or in a `tests/` folder (decided in `ARCHITECTURE.md`).
- Follow the folder structure in `ARCHITECTURE.md`. Changing it is an architecture change and needs approval.

## Security (money is involved)

- Treat every order path as security-critical: authenticated, validated, logged, and covered by tests.
- Secrets (broker keys, DB password, session secret) live only in `.env` and are never sent to the browser or to the LLM.
- The LLM decides trades but never calls the broker itself. Its decisions pass through the same validation and risk checks as any other order, which then execute it automatically in paper mode, or turn it into a prepared order Youmu places by hand in live mode.
- Default to paper trading. Switching to live trading is an explicit, separate decision recorded in `PRD.md`.

## Smallest useful step

- No speculative architecture: build what the current task needs, not what a future task might need.
- No new dependency without saying why it's needed and what the smaller alternative was.
- Fix root causes, not symptoms. If a workaround is unavoidable, say so and add a task to fix it properly.

## Never

- Never commit secrets or `.env`. `.env` stays in `.gitignore`; keep a `.env.example` with empty values instead.
- Never add paid data sources or paid APIs. Market data must be free or open-source.
- Never add anything related to cryptocurrency.
- Never place a live (real-money) order from code, a test, or a script unless Youmu has explicitly turned live trading on.
- Never mark a task done without verifying it, and showing how it was verified.
- Never make large refactors that weren't asked for.
- Never run git commands that change history or the remote: no `git add`, commit, push, merge, rebase, or opening/editing PRs. Youmu does all of that from their local clone. Claude only edits files in the working tree and says what changed.
- Never change anything outside the repo without asking first.
