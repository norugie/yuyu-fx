# PROGRESS — YuyuFX

Update this at the end of every session so the next one can pick up cleanly. Newest entry on top.

## Current state
- Phase: 1 (project docs)
- Next task: 1.8 Youmu commits and pushes the docs, then Phase 0 (environment)

## Log

<!-- Copy this block for each session:
### YYYY-MM-DD
- **Done:**
- **Broke (and why):**
- **Next:**
-->

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
- PostgreSQL not installed yet (Phase 0.2).
