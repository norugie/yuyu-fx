# DESIGN — YuyuFX

Status: **approved 2026-10-27** · Last updated: 2026-10-27 (task 2.4: §3 and §6 proposals added, marked below)

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
- Color tokens (light and dark): shadcn/ui CSS variables (Nova preset, neutral base) in `apps/web/src/index.css`. **Proposal (2026-10-27, for Youmu to confirm):** semantic tokens, used as Tailwind colors (`text-gain`, `bg-paper`, …):

  | Token | Light | Dark | Use | Contrast (WCAG) |
  |---|---|---|---|---|
  | `gain` | oklch(0.52 0.14 152) green | oklch(0.76 0.16 152) | positive P&L text | 5.1 on bg / 8.9 on dark card |
  | `loss` | oklch(0.53 0.2 27) red | oklch(0.72 0.17 25) | negative P&L text | 5.9 / 6.7 |
  | `paper` + `paper-foreground` | blue oklch(0.49 0.17 255) + white | oklch(0.5 0.16 255) + white | Paper mode badge | 6.1 / 5.8 |
  | `live` + `live-foreground` | red oklch(0.53 0.21 27) + white | oklch(0.53 0.2 27) + white | Live mode badge | 5.6 / 5.6 |

  All pairs pass AA (4.5:1); ratios computed from the oklch values. Paper is a calm blue, Live is the same red family as "danger", so live mode looks dangerous.
- Theme: follows the system light/dark setting; a sun/moon button in the top bar overrides it (remembered in the browser). This answers §7 "dark mode by default?" with "system" (proposal).
- Type scale and fonts. **Proposal:** Geist Variable (shadcn Nova preset default, self-hosted via `@fontsource-variable/geist`). Page title `text-xl` semibold; card titles `text-base` medium; body and tables `text-sm`; labels and secondary text `text-sm` in `muted-foreground`; headline numbers `text-2xl` semibold. Numbers use tabular figures (`tabular-nums`, on by default inside tables).
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
- **Proposal (2026-10-27):** Tailwind's default breakpoints. Below `lg` (1024px): no sidebar, a top bar with a menu button that opens the navigation as a sheet from the left (the mode badge is in both the top bar and the sheet). From `lg`: fixed 240px sidebar. Stat tiles are 2 per row below `lg`, 4 from `lg`. Content max width 72rem (`max-w-6xl`). Checked at 390px and 1440px: no horizontal scroll.
- Still to do when tables arrive (Phase 3): at phone width, tables become stacked rows, and the kill switch stays reachable.

## 7. Open questions
- Live updates (websocket/SSE) or polling for the dashboard?
- Charts: which library, and which charts in the MVP?
- Dark mode by default?
