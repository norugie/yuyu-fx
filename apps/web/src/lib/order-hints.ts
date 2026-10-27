import type { RiskSettings } from "@yuyufx/shared";

// What the order ticket can tell you before you submit: which rule you're about
// to hit, and how many shares fit. An estimate for guidance only; the server's
// risk engine (apps/server/src/risk/rules.ts) makes the real decision.

export type Kind = "market" | "limit" | "bracket";

export interface HintInput {
  symbol: string;
  side: "buy" | "sell";
  kind: Kind;
  entry: "market" | "limit";
  limitPrice: number | null;
  stopLossPrice: number | null;
  lastPrice: number | null;
  equity: number;
  cash: number;
  heldQuantity: number;
  heldValue: number;
  settings: RiskSettings;
  /** Market fills are this much worse than the quote (matches the server's 5 bp). */
  slippage?: number;
}

export type Notice =
  | { kind: "stop_required"; text: string }
  | { kind: "not_allowed"; text: string }
  | { kind: "not_held"; text: string };

export interface Hints {
  notice: Notice | null;
  /** Most shares this order can have, or null if unknown (no price yet). */
  maxShares: number | null;
  /** Which limit sets maxShares, in a few words. */
  maxReason: string | null;
}

const pct = (bps: number) => `${(bps / 100).toLocaleString("en-CA")}%`;

export function orderHints(input: HintInput): Hints {
  const s = input.settings;
  const symbol = input.symbol || "this symbol";

  if (input.side === "sell") {
    if (input.heldQuantity <= 0) {
      return { notice: { kind: "not_held", text: `You don't hold ${symbol}, so there's nothing to sell. To open a position, choose Buy.` }, maxShares: 0, maxReason: "you hold none" };
    }
    return { notice: null, maxShares: input.heldQuantity, maxReason: "shares you hold" };
  }

  let notice: Notice | null = null;
  if (input.symbol && !s.allowedSymbols.includes(input.symbol)) {
    notice = { kind: "not_allowed", text: `${input.symbol} isn't on your allowed symbols list. Add it in Settings first.` };
  } else if (s.requireStopLoss && input.kind !== "bracket") {
    notice = {
      kind: "stop_required",
      text: "New positions need a stop-loss, so buys are bracket orders. A bracket can still enter at a limit price.",
    };
  }

  const usesLimit = input.kind === "limit" || (input.kind === "bracket" && input.entry === "limit");
  const entry = usesLimit ? input.limitPrice : input.lastPrice === null ? null : input.lastPrice * (1 + (input.slippage ?? 0.0005));
  if (entry === null || !(entry > 0)) return { notice, maxShares: null, maxReason: null };

  const candidates: [number, string][] = [
    [Math.floor(((input.equity * s.maxPositionBps) / 10_000 - input.heldValue) / entry), `${pct(s.maxPositionBps)} max per stock`],
    [Math.floor(input.cash / entry), "your cash"],
    [s.maxOrderQuantity, "per-order limit"],
  ];
  if (input.kind === "bracket" && input.stopLossPrice !== null && input.stopLossPrice > 0 && input.stopLossPrice < entry) {
    candidates.push([Math.floor((input.equity * s.riskPerTradeBps) / 10_000 / (entry - input.stopLossPrice)), `${pct(s.riskPerTradeBps)} risk with this stop`]);
  }
  const [maxShares, maxReason] = candidates.reduce((a, b) => (b[0] < a[0] ? b : a));
  return { notice, maxShares: Math.max(0, maxShares), maxReason };
}
