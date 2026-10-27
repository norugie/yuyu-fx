import { describe, expect, it } from "vitest";
import { orderHints, type HintInput } from "../src/lib/order-hints";

const settings = {
  riskPerTradeBps: 100,
  maxPositionBps: 1000,
  maxOpenPositions: 10,
  dailyLossBps: 300,
  maxDrawdownBps: 1500,
  requireStopLoss: true,
  maxOrderQuantity: 10_000,
  maxLimitDeviationBps: 1000,
  maxExitDeviationBps: 3000,
  maxOrdersPerMinute: 10,
  allowedSymbols: ["XIU", "RY"],
};

const base: HintInput = {
  symbol: "RY",
  side: "buy",
  kind: "bracket",
  entry: "limit",
  limitPrice: 283,
  stopLossPrice: 278,
  lastPrice: 285.7,
  equity: 99_994,
  cash: 91_841,
  heldQuantity: 0,
  heldValue: 0,
  settings,
};

describe("orderHints", () => {
  it("Youmu's case: 'Limit' chosen for a new buy -> explains brackets can enter at a limit", () => {
    const h = orderHints({ ...base, kind: "limit" });
    expect(h.notice?.kind).toBe("stop_required");
    expect(h.notice?.text).toMatch(/bracket can still enter at a limit price/);
  });

  it("bracket with a limit entry: max shares from the 10% cap (9,999.40 / 283 = 35)", () => {
    expect(orderHints(base)).toEqual({ notice: null, maxShares: 35, maxReason: "10% max per stock" });
  });

  it("a wide stop makes the 1% risk limit the binding one", () => {
    // 999.94 / (283 - 250) = 30
    expect(orderHints({ ...base, stopLossPrice: 250 })).toMatchObject({ maxShares: 30, maxReason: "1% risk with this stop" });
  });

  it("counts what you already hold toward the 10% cap (Youmu's second XIU buy)", () => {
    const h = orderHints({ ...base, symbol: "XIU", entry: "market", lastPrice: 54.31, stopLossPrice: 53.2, heldQuantity: 150, heldValue: 8_152 });
    // (9,999.40 - 8,152) / (54.31 x 1.0005) = 33
    expect(h).toMatchObject({ maxShares: 33, maxReason: "10% max per stock" });
  });

  it("selling: you can sell what you hold; nothing if you hold none", () => {
    expect(orderHints({ ...base, side: "sell", heldQuantity: 0 }).notice?.kind).toBe("not_held");
    expect(orderHints({ ...base, side: "sell", heldQuantity: 30 })).toMatchObject({ notice: null, maxShares: 30 });
  });

  it("flags symbols that aren't allowed", () => {
    expect(orderHints({ ...base, symbol: "TD" }).notice?.kind).toBe("not_allowed");
  });

  it("no price yet: no max shares", () => {
    expect(orderHints({ ...base, entry: "market", lastPrice: null }).maxShares).toBeNull();
  });
});
