import { describe, expect, it } from "vitest";
import {
  applyFill,
  averageCost,
  buildBook,
  emptyPosition,
  equity,
  markToMarket,
  type TradeFill,
} from "../src/portfolio/positions.js";
import { fromUnits, toUnits } from "../src/money.js";

// Task 3.5: positions and P&L, with worked examples you can check by hand.

const f = (side: "buy" | "sell", quantity: number, price: string, fee = "0"): TradeFill => ({
  symbol: "RY",
  side,
  quantity,
  price: toUnits(price),
  fee: toUnits(fee),
});

const replay = (...fills: TradeFill[]) => fills.reduce(applyFill, emptyPosition("RY"));
const view = (p: ReturnType<typeof replay>) => ({
  quantity: p.quantity,
  costBasis: fromUnits(p.costBasis),
  averageCost: averageCost(p) === null ? null : fromUnits(averageCost(p) ?? 0n),
  realizedPnl: fromUnits(p.realizedPnl),
  fees: fromUnits(p.fees),
});

describe("average cost", () => {
  it("buy 100 @ 10, buy 100 @ 12 -> 200 shares at an average of 11", () => {
    expect(view(replay(f("buy", 100, "10"), f("buy", 100, "12")))).toEqual({
      quantity: 200,
      costBasis: "2200.0000",
      averageCost: "11.0000",
      realizedPnl: "0.0000",
      fees: "0.0000",
    });
  });

  it("then sell 50 @ 15 -> realised (15 - 11) x 50 = 200; the average stays 11", () => {
    expect(view(replay(f("buy", 100, "10"), f("buy", 100, "12"), f("sell", 50, "15")))).toMatchObject({
      quantity: 150,
      costBasis: "1650.0000",
      averageCost: "11.0000",
      realizedPnl: "200.0000",
    });
  });

  it("then sell the last 150 @ 9 -> realised another (9 - 11) x 150 = -300; total -100, flat", () => {
    const p = replay(f("buy", 100, "10"), f("buy", 100, "12"), f("sell", 50, "15"), f("sell", 150, "9"));
    expect(view(p)).toEqual({ quantity: 0, costBasis: "0.0000", averageCost: null, realizedPnl: "-100.0000", fees: "0.0000" });
  });

  it("stays exact when the average doesn't divide evenly (10.3333...)", () => {
    // Paid 10 + 2 x 10.50 = 31.00 for 3 shares; sold all for 33.00 -> exactly +2.00.
    const p = replay(f("buy", 1, "10"), f("buy", 2, "10.50"), f("sell", 1, "11"), f("sell", 2, "11"));
    expect(view(p)).toMatchObject({ quantity: 0, costBasis: "0.0000", realizedPnl: "2.0000" });
  });

  it("tracks fees separately from trading P&L", () => {
    const p = replay(f("buy", 100, "10", "1.00"), f("sell", 100, "10", "1.00"));
    expect(view(p)).toMatchObject({ realizedPnl: "0.0000", fees: "2.0000" });
  });
});

describe("short positions (math only; selling short is blocked by the risk checks)", () => {
  it("sell 10 @ 50 then buy back @ 45 -> realised +50", () => {
    const p = replay(f("sell", 10, "50"), f("buy", 10, "45"));
    expect(view(p)).toMatchObject({ quantity: 0, realizedPnl: "50.0000" });
  });

  it("flipping from long to short closes the long and opens the short at the fill price", () => {
    const p = replay(f("buy", 10, "20"), f("sell", 15, "22"));
    expect(view(p)).toMatchObject({ quantity: -5, costBasis: "-110.0000", averageCost: "22.0000", realizedPnl: "20.0000" });
  });
});

describe("unrealised P&L, cash and equity", () => {
  it("marks the open shares at the latest price", () => {
    const p = replay(f("buy", 100, "10"));
    const { marketValue, unrealizedPnl } = markToMarket(p, toUnits("10.75"));
    expect(fromUnits(marketValue)).toBe("1075.0000");
    expect(fromUnits(unrealizedPnl)).toBe("75.0000");
    expect(fromUnits(markToMarket(p, null).unrealizedPnl)).toBe("0.0000"); // no price: valued at cost
  });

  it("cash = start - purchases + sales - fees; equity = cash + market value", () => {
    const book = buildBook(toUnits("10000"), [
      { ...f("buy", 100, "10", "1.00"), symbol: "RY" },
      { ...f("buy", 20, "50", "1.00"), symbol: "TD" },
      { ...f("sell", 50, "12", "1.00"), symbol: "RY" },
    ]);
    // 10000 - 1000 - 1000 + 600 - 3 = 8597
    expect(fromUnits(book.cash)).toBe("8597.0000");
    const prices: Record<string, string> = { RY: "11", TD: "49" };
    // 8597 + 50 x 11 + 20 x 49 = 8597 + 550 + 980 = 10127
    expect(fromUnits(equity(book, (s) => (prices[s] ? toUnits(prices[s]) : null)))).toBe("10127.0000");
  });
});
