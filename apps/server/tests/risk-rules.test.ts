import { describe, expect, it } from "vitest";
import type { NewOrder } from "@yuyufx/shared";
import { DEFAULT_COSTS } from "../src/broker/fill-rules.js";
import { toUnits } from "../src/money.js";
import { checkOrder, DEFAULT_RISK_SETTINGS, type RiskContext, type RuleId } from "../src/risk/rules.js";

// Task 5.2 / phase check 5.7: every rule has a test proving it blocks a bad order.
// Account: equity $100,000, last price $100. Defaults: 1% risk per trade ($1,000),
// 10% max position ($10,000), stop required.

const ctx = (o: Partial<RiskContext> = {}): RiskContext => ({
  source: "manual",
  mode: "paper",
  settings: { ...DEFAULT_RISK_SETTINGS, allowedSymbols: ["RY", "XIU"] },
  halts: [],
  quote: { price: toUnits("100"), stale: false },
  equity: toUnits("100000"),
  availableCash: toUnits("100000"),
  sellableQuantity: 0,
  heldValue: 0n,
  otherOpenPositions: 0,
  ordersLastMinute: 0,
  costs: DEFAULT_COSTS,
  ...o,
});

/** A good bracket: 50 shares, stop 2% below -> risk ~ $102, value ~ $5,000. */
const bracket = (o: Record<string, unknown> = {}) =>
  ({ symbol: "RY", side: "buy", quantity: 50, type: "bracket", entry: "market", stopLossPrice: "98", takeProfitPrice: "106", ...o }) as NewOrder;
const sell = (o: Record<string, unknown> = {}) => ({ symbol: "RY", side: "sell", quantity: 10, type: "market", ...o }) as NewOrder;

const ruleOf = (order: NewOrder, c: RiskContext): RuleId | null => checkOrder(order, c)?.rule ?? null;

describe("good orders pass", () => {
  it("a bracket buy within every limit", () => {
    expect(checkOrder(bracket(), ctx())).toBeNull();
  });
  it("selling shares you hold (no entry rules apply)", () => {
    expect(checkOrder(sell(), ctx({ sellableQuantity: 10, settings: { ...ctx().settings, allowedSymbols: [] } }))).toBeNull();
  });
});

describe("each rule blocks a bad order", () => {
  const cases: [RuleId, NewOrder, Partial<RiskContext>][] = [
    ["paper_only", bracket(), { mode: "live" }],
    ["automation_halted", bracket(), { source: "rules", halts: ["daily loss limit reached"] }],
    ["rate_limit", bracket(), { ordersLastMinute: 10 }],
    ["quantity_cap", bracket({ quantity: 10_001 }), {}],
    ["short_selling", sell(), { sellableQuantity: 0 }],
    ["short_selling", bracket({ side: "sell", stopLossPrice: "106", takeProfitPrice: "98" }), { sellableQuantity: 100 }],
    ["whitelist", bracket({ symbol: "SHOP" }), {}],
    ["no_price", bracket(), { quote: null }],
    ["stale_price", bracket(), { quote: { price: toUnits("100"), stale: true } }],
    ["limit_distance", { symbol: "RY", side: "buy", quantity: 10, type: "limit", limitPrice: "80" } as NewOrder, { settings: { ...ctx().settings, requireStopLoss: false } }],
    ["exit_distance", bracket({ stopLossPrice: "60" }), {}],
    ["exit_distance", bracket({ stopLossPrice: "101" }), {}],
    ["stop_required", { symbol: "RY", side: "buy", quantity: 10, type: "market" } as NewOrder, {}],
    ["risk_per_trade", bracket({ quantity: 90, stopLossPrice: "85" }), {}], // (100.05 - 85) x 90 = ~$1,354 > $1,000
    ["position_size", bracket({ quantity: 101, stopLossPrice: "99.5" }), {}], // ~ $10,105 > $10,000
    ["position_size", bracket({ quantity: 10, stopLossPrice: "99.5" }), { heldValue: toUnits("9500") }],
    ["open_positions", bracket(), { otherOpenPositions: 10 }],
    ["cash", bracket(), { availableCash: toUnits("1000") }],
  ];

  for (const [rule, order, override] of cases) {
    it(`${rule} (${order.side} ${order.type}${Object.keys(override).length ? `, ${Object.keys(override).join(", ")}` : ""})`, () => {
      const failure = checkOrder(order, ctx(override));
      expect(failure?.rule).toBe(rule);
      expect(failure?.reason.length).toBeGreaterThan(10);
    });
  }
});

describe("rule details", () => {
  it("manual orders still go through while automation is halted (per-order rules still apply)", () => {
    expect(ruleOf(bracket(), ctx({ halts: ["kill switch"] }))).toBeNull();
    expect(ruleOf(bracket(), ctx({ source: "ai", halts: ["kill switch"] }))).toBe("automation_halted");
  });

  it("plain buys are allowed again if Youmu turns 'require stop-loss' off", () => {
    const plain = { symbol: "RY", side: "buy", quantity: 10, type: "market" } as NewOrder;
    expect(ruleOf(plain, ctx({ settings: { ...ctx().settings, requireStopLoss: false } }))).toBeNull();
  });

  it("explains the risk-per-trade numbers in plain money", () => {
    const failure = checkOrder(bracket({ quantity: 90, stopLossPrice: "85" }), ctx());
    // (100.05 - 85) x 90 = 1,354.50 at risk; cap 1% of 100,000; 1,000 / 15.05 = 66 shares fit.
    expect(failure?.reason).toBe(
      "If the stop is hit you'd lose about $1,354.50. Max risk per trade is $1,000.00 (1% of $100,000.00 equity). With this stop you can buy up to 66 shares, or move the stop closer.",
    );
  });

  it("explains the position cap in dollars, with equity and how many more shares fit", () => {
    // Already holding $5,000 of RY; 60 more at ~100.05 = $6,003 -> $11,003 total; cap $10,000; (10,000 - 5,000) / 100.05 = 49.
    const failure = checkOrder(bracket({ quantity: 60, stopLossPrice: "99" }), ctx({ heldValue: toUnits("5000") }));
    expect(failure?.reason).toBe(
      "RY would be $11,003.00 in total. Max per stock is $10,000.00 (10% of $100,000.00 equity). You can buy up to 49 more shares.",
    );
    const full = checkOrder(bracket({ quantity: 1, stopLossPrice: "99" }), ctx({ heldValue: toUnits("10000") }));
    expect(full?.reason).toMatch(/You can't add to RY right now\./);
  });

  it("counts an existing holding toward the position limit, and adding to it doesn't count as a new position", () => {
    expect(ruleOf(bracket({ quantity: 10 }), ctx({ heldValue: toUnits("5000"), otherOpenPositions: 10 }))).toBeNull();
  });
});
