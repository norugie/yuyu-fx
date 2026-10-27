import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser } from "../src/api/auth/users.js";
import { createSimulatedBroker, OrderNotCancellableError, type Broker } from "../src/broker/simulated.js";
import { createManualPriceSource, type ManualPriceSource } from "../src/data/manual-quotes.js";
import { fills, orders } from "../src/db/schema.js";
import { createTestDatabase, type TestDatabase } from "./helpers/test-db.js";

// Task 3.3: the simulated broker against a real (throwaway) database.

let testDb: TestDatabase;
let userId: string;
let prices: ManualPriceSource;
let broker: Broker;
let clockMs = Date.parse("2026-10-27T15:00:00Z");

beforeAll(async () => {
  testDb = await createTestDatabase();
  userId = (await createUser(testDb.db, "broker-test", "long enough password")).id;
  prices = createManualPriceSource(testDb.db);
  broker = createSimulatedBroker({ db: testDb.db, prices, now: () => new Date(clockMs), log: () => {} });
});

afterAll(async () => {
  await testDb.cleanup();
});

async function setPrice(symbol: string, price: string) {
  clockMs += 60_000;
  await prices.record({ symbol, price, enteredBy: userId, at: new Date(clockMs) });
  return broker.onPrice(symbol);
}

const statusOf = async (id: string) =>
  (await testDb.db.select({ status: orders.status, reason: orders.statusReason }).from(orders).where(eq(orders.id, id)))[0];

describe("simulated broker", () => {
  it("fills a market order straight away at the price plus slippage, and records the fill", async () => {
    await setPrice("RY", "130.00");
    const result = await broker.place({ userId, source: "manual", order: { symbol: "RY", side: "buy", quantity: 10, type: "market" } });
    expect(result.orders[0]?.status).toBe("filled");
    expect(result.fills).toHaveLength(1);
    expect(result.fills[0]).toMatchObject({ symbol: "RY", side: "buy", quantity: 10, price: "130.0700", fee: "1.0000" });
  });

  it("leaves a limit order open until a typed price reaches it", async () => {
    await setPrice("TD", "80.00");
    const placed = await broker.place({
      userId,
      source: "manual",
      order: { symbol: "TD", side: "buy", quantity: 5, type: "limit", limitPrice: "79.50" },
    });
    const id = placed.orders[0]?.id ?? "";
    expect(placed.orders[0]?.status).toBe("open");
    expect(await setPrice("TD", "79.80")).toHaveLength(0);
    const filled = await setPrice("TD", "79.40");
    expect(filled).toHaveLength(1);
    expect(filled[0]).toMatchObject({ orderId: id, price: "79.4000" });
    expect((await statusOf(id))?.status).toBe("filled");
  });

  it("runs a bracket: entry fills, then the take-profit fills and cancels the stop-loss", async () => {
    await setPrice("XIU", "35.00");
    const placed = await broker.place({
      userId,
      source: "manual",
      order: { symbol: "XIU", side: "buy", quantity: 100, type: "bracket", entry: "market", stopLossPrice: "34.00", takeProfitPrice: "36.00" },
    });
    const [entry, stop, target] = placed.orders;
    expect(placed.orders.map((o) => [o.bracketRole, o.side, o.type, o.status])).toEqual([
      ["entry", "buy", "market", "filled"],
      ["stop_loss", "sell", "stop", "open"],
      ["take_profit", "sell", "limit", "open"],
    ]);
    expect(stop?.parentId).toBe(entry?.id);

    await setPrice("XIU", "35.50");
    const exit = await setPrice("XIU", "36.10");
    expect(exit).toHaveLength(1);
    expect(exit[0]).toMatchObject({ orderId: target?.id, side: "sell", price: "36.1000" });
    expect(await statusOf(stop?.id ?? "")).toEqual({ status: "cancelled", reason: "Cancelled: take-profit filled" });
  });

  it("cancels an open entry and its bracket exits", async () => {
    await setPrice("ENB", "50.00");
    const placed = await broker.place({
      userId,
      source: "manual",
      order: { symbol: "ENB", side: "buy", quantity: 10, type: "bracket", entry: "limit", limitPrice: "48.00", stopLossPrice: "46.00", takeProfitPrice: "52.00" },
    });
    const cancelled = await broker.cancel(userId, placed.orders[0]?.id ?? "");
    expect(cancelled.map((o) => [o.status, o.statusReason])).toEqual([
      ["cancelled", "Cancelled by you"],
      ["cancelled", "Cancelled: entry cancelled"],
      ["cancelled", "Cancelled: entry cancelled"],
    ]);
    // A later price that would have filled it does nothing.
    expect(await setPrice("ENB", "47.00")).toHaveLength(0);
  });

  it("refuses to cancel a filled order, or someone else's", async () => {
    await setPrice("BCE", "45.00");
    const placed = await broker.place({ userId, source: "manual", order: { symbol: "BCE", side: "buy", quantity: 1, type: "market" } });
    const id = placed.orders[0]?.id ?? "";
    await expect(broker.cancel(userId, id)).rejects.toThrow(OrderNotCancellableError);
    await expect(broker.cancel("00000000-0000-0000-0000-000000000000", id)).rejects.toThrow("Order not found");
  });

  it("never fills the same order twice, even if the price is set repeatedly", async () => {
    await setPrice("CNR", "160.00");
    const placed = await broker.place({
      userId,
      source: "manual",
      order: { symbol: "CNR", side: "sell", quantity: 3, type: "limit", limitPrice: "161.00" },
    });
    await Promise.all([setPrice("CNR", "162.00"), setPrice("CNR", "162.50"), setPrice("CNR", "163.00")]);
    const rows = await testDb.db.select().from(fills).where(eq(fills.orderId, placed.orders[0]?.id ?? ""));
    expect(rows).toHaveLength(1);
  });

  it("does nothing for a symbol with no price yet (market order waits)", async () => {
    const placed = await broker.place({ userId, source: "manual", order: { symbol: "SHOP", side: "buy", quantity: 1, type: "market" } });
    expect(placed.orders[0]?.status).toBe("open");
    expect(placed.fills).toHaveLength(0);
  });
});
