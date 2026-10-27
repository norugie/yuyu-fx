import { describe, expect, it } from "vitest";
import { newOrderSchema, priceSchema, quantitySchema, setQuoteSchema, symbolSchema } from "../src/trading.js";

const issues = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((i) => i.message) ?? [];

describe("symbolSchema", () => {
  it.each(["RY", "XIU", "BBD.B", "CTC.A", "REI.UN", " ry "])("accepts %j", (symbol) => {
    expect(symbolSchema.safeParse(symbol).success).toBe(true);
  });

  it("normalizes to trimmed uppercase", () => {
    expect(symbolSchema.parse("  bbd.b ")).toBe("BBD.B");
  });

  it.each(["", "TOOLONGX", "RY.", "R Y", "RY.ABC", "12", "RY;DROP"])("rejects %j", (symbol) => {
    expect(symbolSchema.safeParse(symbol).success).toBe(false);
  });
});

describe("quantitySchema", () => {
  it.each([1, 100, 250_000])("accepts %d", (q) => {
    expect(quantitySchema.safeParse(q).success).toBe(true);
  });

  it.each([0, -5, 1.5, Number.NaN, "10"])("rejects %j", (q) => {
    expect(quantitySchema.safeParse(q).success).toBe(false);
  });
});

describe("priceSchema", () => {
  it.each(["12", "12.3", "12.34", "0.005", "999999.9999"])("accepts %j", (p) => {
    expect(priceSchema.safeParse(p).success).toBe(true);
  });

  it.each(["0", "0.0000", "-1", "12.34567", "1e3", "1,000", "", "abc", "1000000"])("rejects %j", (p) => {
    expect(priceSchema.safeParse(p).success).toBe(false);
  });

  it("rejects numbers (money is always a string)", () => {
    expect(priceSchema.safeParse(12.34).success).toBe(false);
  });
});

describe("newOrderSchema", () => {
  const base = { symbol: "ry", side: "buy", quantity: 10 } as const;

  it("accepts a market order and normalizes the symbol", () => {
    const order = newOrderSchema.parse({ ...base, type: "market" });
    expect(order).toEqual({ symbol: "RY", side: "buy", quantity: 10, type: "market" });
  });

  it("requires a limit price on limit orders", () => {
    expect(newOrderSchema.safeParse({ ...base, type: "limit" }).success).toBe(false);
    expect(newOrderSchema.safeParse({ ...base, type: "limit", limitPrice: "130.50" }).success).toBe(true);
  });

  it("rejects unknown order types (no stand-alone stops in the MVP)", () => {
    expect(newOrderSchema.safeParse({ ...base, type: "stop", stopPrice: "120" }).success).toBe(false);
  });

  it("rejects zero or fractional quantities and bad sides", () => {
    expect(newOrderSchema.safeParse({ ...base, quantity: 0, type: "market" }).success).toBe(false);
    expect(newOrderSchema.safeParse({ ...base, quantity: 2.5, type: "market" }).success).toBe(false);
    expect(newOrderSchema.safeParse({ ...base, side: "short", type: "market" }).success).toBe(false);
  });

  describe("bracket", () => {
    const bracket = {
      ...base,
      type: "bracket",
      entry: "limit",
      limitPrice: "130",
      stopLossPrice: "125",
      takeProfitPrice: "140",
    } as const;

    it("accepts a buy with stop below and target above the entry", () => {
      expect(newOrderSchema.safeParse(bracket).success).toBe(true);
    });

    it("accepts a market-entry bracket without a limit price", () => {
      const { limitPrice: _unused, ...rest } = bracket;
      expect(newOrderSchema.safeParse({ ...rest, entry: "market" }).success).toBe(true);
    });

    it("rejects a buy whose stop is above the entry", () => {
      const result = newOrderSchema.safeParse({ ...bracket, stopLossPrice: "135" });
      expect(issues(result)).toContain(
        "For a buy, stop-loss must be below the entry and take-profit above it",
      );
    });

    it("mirrors the rule for a sell", () => {
      const sell = { ...bracket, side: "sell", stopLossPrice: "140", takeProfitPrice: "125" };
      expect(newOrderSchema.safeParse(sell).success).toBe(true);
      expect(newOrderSchema.safeParse({ ...sell, stopLossPrice: "125", takeProfitPrice: "140" }).success).toBe(
        false,
      );
    });

    it("requires a limit price for a limit entry, and none for a market entry", () => {
      const { limitPrice: _unused, ...noLimit } = bracket;
      expect(issues(newOrderSchema.safeParse(noLimit))).toContain("A limit entry needs a limit price");
      expect(issues(newOrderSchema.safeParse({ ...bracket, entry: "market" }))).toContain(
        "A market entry has no limit price",
      );
    });

    it("requires both stop-loss and take-profit", () => {
      const { takeProfitPrice: _unused, ...noTarget } = bracket;
      expect(newOrderSchema.safeParse(noTarget).success).toBe(false);
    });
  });
});

describe("setQuoteSchema", () => {
  it("accepts a symbol and price", () => {
    expect(setQuoteSchema.parse({ symbol: "xiu", price: "35.10" })).toEqual({ symbol: "XIU", price: "35.10" });
  });

  it("rejects a numeric price", () => {
    expect(setQuoteSchema.safeParse({ symbol: "XIU", price: 35.1 }).success).toBe(false);
  });
});
