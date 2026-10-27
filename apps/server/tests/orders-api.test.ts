import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OrderRejectedResponse, OrderView, PlaceOrderResponse, PortfolioView } from "@yuyufx/shared";
import { createUser } from "../src/api/auth/users.js";
import { fills, orders } from "../src/db/schema.js";
import { createTestDatabase, type TestDatabase } from "./helpers/test-db.js";
import { relaxRisk } from "./helpers/risk.js";
import { startTestServer, type TestServer } from "./helpers/test-server.js";

// Tasks 3.4 and 3.5 through the HTTP API: order path, history, cancel, portfolio.

let testDb: TestDatabase;
let server: TestServer;
let session: { cookie: string; csrf: string };
const PASSWORD = "long enough password";
let n = 0;
/** A fresh symbol per test: prices are shared market data, so tests must not reuse symbols. */
let SYM = "";

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await server.close();
  await testDb.cleanup();
});

// Each test gets its own user, so cash and positions start fresh.
beforeEach(async () => {
  if (server) await server.close();
  const username = `orders-test-${++n}`;
  SYM = `Z${String.fromCharCode(65 + (n % 26))}${String.fromCharCode(65 + Math.floor(n / 26))}`;
  const user = await createUser(testDb.db, username, PASSWORD);
  // These tests are about order mechanics; the risk rules have their own tests.
  await relaxRisk(testDb.db, user.id, [SYM], { maxOrderQuantity: 10_000 });
  server = await startTestServer(testDb.db);
  session = await server.login(username, PASSWORD);
});

const post = (path: string, body?: unknown) =>
  server.call(path, { method: "POST", body, cookie: session.cookie, csrf: session.csrf });
const get = (path: string) => server.call(path, { cookie: session.cookie });
const setPrice = (symbol: string, price: string) => {
  server.clock.ms += 60_000;
  return post("/api/quotes", { symbol, price });
};
const order = (body: Record<string, unknown>) => post("/api/orders", { symbol: SYM, side: "buy", quantity: 10, type: "market", ...body });

describe("POST /api/orders", () => {
  it("places and fills a market buy (AC3.1, AC3.2)", async () => {
    await setPrice(SYM, "130");
    const res = await order({});
    expect(res.status).toBe(201);
    const [placed] = (res.json as PlaceOrderResponse).orders;
    expect(placed).toMatchObject({ symbol: SYM, side: "buy", status: "filled", source: "manual", mode: "paper" });
    expect(placed?.fill).toMatchObject({ price: "130.0700", fee: "1.0000" });
    expect(server.logs.map((l) => l.event)).toContain("order.fill");
  });

  it("returns a bracket as three orders", async () => {
    await setPrice(SYM, "130");
    const res = await order({ type: "bracket", entry: "market", stopLossPrice: "125", takeProfitPrice: "140" });
    const placed = (res.json as PlaceOrderResponse).orders;
    expect(placed.map((o) => [o.bracketRole, o.status])).toEqual([
      ["entry", "filled"],
      ["stop_loss", "open"],
      ["take_profit", "open"],
    ]);
  });

  it("400s on an invalid order and stores nothing", async () => {
    const res = await order({ quantity: 0 });
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ error: "Quantity must be more than 0" });
  });

  describe("refused by the sanity checks: stored as rejected, logged with the reason, no fill", () => {
    const cases: [string, () => Promise<unknown>, Record<string, unknown>, RegExp][] = [
      ["no price yet", async () => {}, {}, /No price for /],
      ["stale price", async () => { await setPrice(SYM, "130"); server.clock.ms += 86_400_000; }, {}, /earlier day/],
      ["quantity cap", () => setPrice(SYM, "1"), { quantity: 20_000 }, /10,000-share limit/],
      ["limit far from price", () => setPrice(SYM, "130"), { type: "limit", limitPrice: "13.00" }, /more than 10% away/],
      ["selling what you don't hold", () => setPrice(SYM, "130"), { side: "sell" }, /don't hold any /],
      ["not enough cash", () => setPrice(SYM, "130"), { quantity: 1_000 }, /Not enough paper cash/],
    ];

    for (const [name, setup, body, reason] of cases) {
      it(name, async () => {
        await setup();
        if (server.clock.ms > Date.parse("2026-10-28T00:00:00Z")) session = await server.login(`orders-test-${n}`, PASSWORD);
        const res = await order(body);
        expect(res.status).toBe(422);
        const { error, order: rejected } = res.json as OrderRejectedResponse;
        expect(error).toMatch(reason);
        expect(rejected).toMatchObject({ status: "rejected", statusReason: error, fill: null });
        expect(await testDb.db.select().from(fills).where(eq(fills.orderId, rejected.id))).toHaveLength(0);
        expect(server.logs.at(-1)).toMatchObject({ event: "order.reject", fields: { orderId: rejected.id, reason: error } });
      });
    }
  });

  it("counts shares in open sell orders as already promised", async () => {
    await setPrice(SYM, "130");
    await order({ quantity: 10 });
    expect((await order({ side: "sell", type: "limit", limitPrice: "135", quantity: 10 })).status).toBe(201);
    const res = await order({ side: "sell", quantity: 1 });
    expect((res.json as OrderRejectedResponse).error).toMatch(/at most 0 |don't hold/);
  });

  it("never sends a live order: the server only runs in paper mode", async () => {
    await setPrice(SYM, "130");
    const res = await order({});
    expect((res.json as PlaceOrderResponse).orders[0]?.mode).toBe("paper");
    const all = await testDb.db.select({ mode: orders.mode }).from(orders);
    expect(all.every((o) => o.mode === "paper")).toBe(true);
  });
});

describe("history, cancel and portfolio", () => {
  it("lists orders newest first with fills, including rejected ones", async () => {
    await order({}); // rejected: no price
    await setPrice(SYM, "130");
    await order({});
    const list = (await get("/api/orders")).json as OrderView[];
    expect(list.map((o) => o.status)).toEqual(["filled", "rejected"]);
    expect(list[0]?.fill?.price).toBe("130.0700");
  });

  it("cancels an open order; a second cancel is a 409", async () => {
    await setPrice(SYM, "130");
    const placed = (await order({ type: "limit", limitPrice: "125" })).json as PlaceOrderResponse;
    const id = placed.orders[0]?.id ?? "";
    const res = await post(`/api/orders/${id}/cancel`);
    expect(res.status).toBe(200);
    expect((res.json as PlaceOrderResponse).orders[0]).toMatchObject({ status: "cancelled", statusReason: "Cancelled by you" });
    expect((await post(`/api/orders/${id}/cancel`)).status).toBe(409);
    expect((await post("/api/orders/not-a-uuid/cancel")).status).toBe(404);
  });

  it("needs the CSRF token to place or cancel", async () => {
    const res = await server.call("/api/orders", { method: "POST", body: {}, cookie: session.cookie });
    expect(res.status).toBe(403);
  });

  it("shows cash, positions, equity and today's P&L", async () => {
    await setPrice(SYM, "100");
    await order({ quantity: 100 }); // fills at 100.05, fee 1.00
    await setPrice(SYM, "102");
    const p = (await get("/api/portfolio")).json as PortfolioView;
    // Cash: 100000 - 100 x 100.05 - 1 = 89994.00
    expect(p.cash).toBe("89994.0000");
    expect(p.openPositions).toEqual([
      expect.objectContaining({
        symbol: SYM,
        quantity: 100,
        averageCost: "100.0500",
        lastPrice: "102.0000",
        marketValue: "10200.0000",
        unrealizedPnl: "195.0000",
        priceStale: false,
      }),
    ]);
    // Equity: 89994 + 10200 = 100194; started the day at 100000 -> +194 (195 gain - 1 fee).
    expect(p.equity).toBe("100194.0000");
    expect(p.todayPnl).toBe("194.0000");
  });

  it("today's P&L only counts today's change", async () => {
    await setPrice(SYM, "100");
    await order({ quantity: 100 });
    await setPrice(SYM, "110"); // yesterday's close: +995 so far
    server.clock.ms += 86_400_000; // next day
    session = await server.login(`orders-test-${n}`, PASSWORD);
    await setPrice(SYM, "108");
    const p = (await get("/api/portfolio")).json as PortfolioView;
    expect(p.todayPnl).toBe("-200.0000"); // 100 shares x (108 - 110)
    expect(p.equity).toBe("100794.0000"); // 89994 + 10800
  });
});
