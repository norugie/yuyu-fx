import { describe, expect, it } from "vitest";
import {
  commission,
  DEFAULT_COSTS,
  evaluate,
  marketFillPrice,
  tickSize,
  type SimOrder,
} from "../src/broker/fill-rules.js";
import { fromUnits, toUnits } from "../src/money.js";

// Task 3.3: the simulated broker's fill rules on fixed price paths.

const u = toUnits;
const order = (overrides: Partial<SimOrder> & Pick<SimOrder, "id">): SimOrder => ({
  side: "buy",
  type: "market",
  quantity: 100,
  limitPrice: null,
  stopPrice: null,
  parentId: null,
  bracketRole: null,
  ...overrides,
});

/** Run a price path; returns every fill and cancel in order, with readable prices. */
function walk(orders: SimOrder[], path: string[]) {
  let open = [...orders];
  const filledParents = new Set<string>();
  const events: string[] = [];
  for (const price of path) {
    const result = evaluate(open, u(price), DEFAULT_COSTS, filledParents);
    for (const f of result.fills) {
      events.push(`@${price} fill ${f.orderId} ${f.quantity} x ${fromUnits(f.price)} fee ${fromUnits(f.fee)}`);
      filledParents.add(f.orderId);
    }
    for (const c of result.cancels) events.push(`@${price} cancel ${c.orderId} (${c.reason})`);
    const closed = new Set([...result.fills.map((f) => f.orderId), ...result.cancels.map((c) => c.orderId)]);
    open = open.filter((o) => !closed.has(o.id));
  }
  return events;
}

describe("costs", () => {
  it("market fills are a little worse than the quote (slippage), rounded to the tick against you", () => {
    // 5 bp of 100.00 = 0.05.
    expect(fromUnits(marketFillPrice(u("100"), "buy", DEFAULT_COSTS))).toBe("100.0500");
    expect(fromUnits(marketFillPrice(u("100"), "sell", DEFAULT_COSTS))).toBe("99.9500");
    // 5 bp of 10.00 = 0.005 -> rounded to the next whole cent against you.
    expect(fromUnits(marketFillPrice(u("10"), "buy", DEFAULT_COSTS))).toBe("10.0100");
    expect(fromUnits(marketFillPrice(u("10"), "sell", DEFAULT_COSTS))).toBe("9.9900");
  });

  it("uses a half-cent tick below $0.50", () => {
    expect(fromUnits(tickSize(u("0.40")))).toBe("0.0050");
    expect(fromUnits(tickSize(u("0.50")))).toBe("0.0100");
  });

  it("charges $0.01/share, at least $1, at most 0.5% of the trade", () => {
    expect(fromUnits(commission(u("50"), 50, DEFAULT_COSTS))).toBe("1.0000"); // 0.50 -> min 1.00
    expect(fromUnits(commission(u("50"), 300, DEFAULT_COSTS))).toBe("3.0000"); // 300 shares
    expect(fromUnits(commission(u("0.10"), 1000, DEFAULT_COSTS))).toBe("0.5000"); // capped at 0.5% of $100
  });
});

describe("evaluate", () => {
  it("fills a market order immediately", () => {
    expect(walk([order({ id: "m1" })], ["100"])).toEqual(["@100 fill m1 100 x 100.0500 fee 1.0000"]);
  });

  it("fills a buy limit only once the price is at or below the limit, at the quote", () => {
    const events = walk([order({ id: "l1", type: "limit", limitPrice: u("99") })], ["100", "99.5", "98.80", "97"]);
    expect(events).toEqual(["@98.80 fill l1 100 x 98.8000 fee 1.0000"]);
  });

  it("fills a sell limit once the price is at or above the limit", () => {
    const events = walk([order({ id: "l2", side: "sell", type: "limit", limitPrice: u("105") })], ["104", "105"]);
    expect(events).toEqual(["@105 fill l2 100 x 105.0000 fee 1.0000"]);
  });

  it("never fills a limit order that the price doesn't reach", () => {
    expect(walk([order({ id: "l3", type: "limit", limitPrice: u("90") })], ["100", "95", "91"])).toEqual([]);
  });

  describe("bracket (long): entry, stop-loss below, take-profit above", () => {
    const bracket = (entry: Partial<SimOrder> = {}) => [
      order({ id: "e", bracketRole: "entry", ...entry }),
      order({ id: "sl", side: "sell", type: "stop", stopPrice: u("95"), parentId: "e", bracketRole: "stop_loss" }),
      order({ id: "tp", side: "sell", type: "limit", limitPrice: u("110"), parentId: "e", bracketRole: "take_profit" }),
    ];

    it("take-profit hit: sells at the target and cancels the stop", () => {
      expect(walk(bracket(), ["100", "105", "110.25"])).toEqual([
        "@100 fill e 100 x 100.0500 fee 1.0000",
        "@110.25 fill tp 100 x 110.2500 fee 1.0000",
        "@110.25 cancel sl (Cancelled: take-profit filled)",
      ]);
    });

    it("stop-loss hit: sells at the market after the stop triggers (a gap fills below the stop)", () => {
      expect(walk(bracket(), ["100", "96", "93"])).toEqual([
        "@100 fill e 100 x 100.0500 fee 1.0000",
        "@93 fill sl 100 x 92.9500 fee 1.0000",
        "@93 cancel tp (Cancelled: stop-loss filled)",
      ]);
    });

    it("exits stay inactive until the limit entry fills", () => {
      const events = walk(bracket({ type: "limit", limitPrice: u("98") }), ["100", "94", "98", "111"]);
      // At 94 the entry fills (94 <= 98) and the stop (95) is already crossed, so it exits at once.
      expect(events).toEqual([
        "@94 fill e 100 x 94.0000 fee 1.0000",
        "@94 fill sl 100 x 93.9500 fee 1.0000",
        "@94 cancel tp (Cancelled: stop-loss filled)",
      ]);
    });

    it("with no price movement after entry, nothing else happens", () => {
      expect(walk(bracket(), ["100", "100", "101"])).toEqual(["@100 fill e 100 x 100.0500 fee 1.0000"]);
    });
  });

  it("short bracket mirrors the rules (buy stop above, buy limit below)", () => {
    const orders = [
      order({ id: "e", side: "sell", bracketRole: "entry" }),
      order({ id: "sl", side: "buy", type: "stop", stopPrice: u("105"), parentId: "e", bracketRole: "stop_loss" }),
      order({ id: "tp", side: "buy", type: "limit", limitPrice: u("90"), parentId: "e", bracketRole: "take_profit" }),
    ];
    expect(walk(orders, ["100", "106"])).toEqual([
      "@100 fill e 100 x 99.9500 fee 1.0000",
      "@106 fill sl 100 x 106.0600 fee 1.0000",
      "@106 cancel tp (Cancelled: stop-loss filled)",
    ]);
  });
});
