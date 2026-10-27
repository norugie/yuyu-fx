# DESIGN — YuyuFX

Status: **approved 2026-10-27** · Last updated: 2026-10-27

## 1. Principles
- **Let the layout explain.** No unnecessary secondary labels or descriptions. Position, grouping and hierarchy carry the meaning.
- **Readable at a glance.** Status (open positions, P&L, strategies on/off, mode paper/live) visible without clicking.
- **Dangerous actions look dangerous.** Placing an order, enabling a strategy, and the kill switch are distinct and need confirmation.
- **Paper vs live is always obvious.** The current mode is visible on every screen.
- Built with shadcn/ui components and Tailwind tokens; no custom one-off styles unless needed.

## 2. Screens and flows
| Screen | Purpose | Main actions | PRD feature |
|---|---|---|---|
| Login | Get in securely | Sign in | F1 |
| Overview | Status at a glance | Open trade, kill switch, approve/reject held AI orders, today's prepared orders (live) | F2, F5, F7, F8 |
| Positions & orders | See holdings and order history | Cancel order | F2, F3 |
| New order | Manual trade | Submit, confirm | F3 |
| Strategies | See and toggle strategies | Enable / disable | F4 |
| Backtests | Review strategy results | Run backtest | F6 |
| Settings | Risk limits, mode, "ask me first", keys status | Save | F5, F7, F8, F9 |

TODO: confirm screens after PRD review.

## 3. Visual language
- Color tokens (light and dark): TODO. Use shadcn/ui CSS variables; add semantic tokens for gain, loss, paper mode, live mode.
- Type scale and fonts: TODO. Numbers in tabular figures so columns line up.
- Spacing scale: Tailwind default scale.

## 4. Components
| Component | Variants | States (default / hover / focus / disabled / loading / error / empty) |
|---|---|---|
| Stat tile | value, value + change | all |
| Data table (positions, orders) | compact | all, incl. empty and loading |
| Order form | market, limit (TODO) | all, incl. validation error and rejected-by-risk |
| Strategy toggle | — | all, incl. confirm dialog |
| Kill switch | — | default, confirm, active |
| Mode badge | paper, live | default |
| Held AI order card | buy, sell | default, approving, approved, rejected, expired |
| Prepared order card (live) | buy, sell | default, copied, placed (fill entered), skipped, expired |

## 5. Accessibility
- Contrast at least WCAG AA, every control reachable by keyboard, visible focus, labels on inputs.
- Gain/loss never shown by color alone (also sign or arrow).

## 6. Responsive behaviour
- TODO: breakpoints. Desktop first (it's a dashboard); at phone width, tables become stacked rows and the kill switch stays reachable.

## 7. Open questions
- Live updates (websocket/SSE) or polling for the dashboard?
- Charts: which library, and which charts in the MVP?
- Dark mode by default?
