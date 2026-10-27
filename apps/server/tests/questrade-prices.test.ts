import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OrderView, PlaceOrderResponse, QuoteView } from "@yuyufx/shared";
import { createUser } from "../src/api/auth/users.js";
import { createQuestradeClient } from "../src/data/questrade/client.js";
import { createMemoryTokenStore } from "../src/data/questrade/token-store.js";
import { pollOnce } from "../src/data/quote-poller.js";
import { createTestDatabase, type TestDatabase } from "./helpers/test-db.js";
import { startFakeQuestrade, type FakeQuestrade } from "./helpers/fake-questrade.js";
import { relaxRisk } from "./helpers/risk.js";
import { startTestServer, type TestServer } from "./helpers/test-server.js";

// Task 4.4: Questrade prices with the typed-in price as fallback (AC10.2).

let testDb: TestDatabase;
let fake: FakeQuestrade;
let server: TestServer & { services: Awaited<ReturnType<typeof startTestServer>>["services"] };
let session: { cookie: string; csrf: string };
let n = 0;

beforeAll(async () => {
  testDb = await createTestDatabase();
});
afterAll(async () => {
  await testDb.cleanup();
});

async function start(withQuestrade: boolean) {
  fake = await startFakeQuestrade("env-token");
  const questrade = withQuestrade
    ? createQuestradeClient({ store: createMemoryTokenStore(), envRefreshToken: "env-token", loginUrl: fake.baseUrl, log: () => {}, minIntervalMs: 0 })
    : undefined;
  server = await startTestServer(testDb.db, "2026-10-27T15:00:00Z", questrade ? { questrade } : {});
  const username = `qp-test-${++n}`;
  const user = await createUser(testDb.db, username, "long enough password");
  await relaxRisk(testDb.db, user.id, ["XIU", "RY", "TD"]);
  session = await server.login(username, "long enough password");
}

afterEach(async () => {
  await server.close();
  await fake.close();
});

const get = (path: string) => server.call(path, { cookie: session.cookie });
const post = (path: string, body: unknown) => server.call(path, { method: "POST", body, cookie: session.cookie, csrf: session.csrf });

describe("with Questrade", () => {
  beforeEach(() => start(true));

  it("serves a fresh Questrade quote and stores it with its source", async () => {
    fake.quotes.set(11, { lastTradePrice: 35.12, delay: 0 }); // XIU
    const res = await get("/api/quotes/XIU");
    expect(res.json).toMatchObject({ symbol: "XIU", price: "35.1200", source: "questrade", stale: false });
  });

  it("asks Questrade at most once per 15 seconds per symbol", async () => {
    fake.quotes.set(11, { lastTradePrice: 35, delay: 0 });
    await get("/api/quotes/XIU");
    await get("/api/quotes/XIU");
    expect(fake.calls.filter((c) => c.includes("/markets/quotes/")).length).toBe(1);
    server.clock.ms += 16_000;
    await get("/api/quotes/XIU");
    expect(fake.calls.filter((c) => c.includes("/markets/quotes/")).length).toBe(2);
  });

  it("falls back to the typed-in price when Questrade fails, and logs why", async () => {
    await post("/api/quotes", { symbol: "RY", price: "130.00" });
    fake.failNext = 10;
    server.clock.ms += 16_000;
    const res = await get("/api/quotes/RY");
    expect(res.json).toMatchObject({ price: "130.0000", source: "manual" });
    expect(server.logs.some((l) => l.event === "questrade.quote.failed")).toBe(true);
  });

  it("fills a market order at the Questrade price (plus slippage)", async () => {
    fake.quotes.set(22, { lastTradePrice: 130, delay: 0 }); // RY
    const res = await post("/api/orders", { symbol: "RY", side: "buy", quantity: 10, type: "market" });
    const [order] = (res.json as PlaceOrderResponse).orders;
    expect(order?.fill?.price).toBe("130.0700");
  });

  it("fills a waiting limit order when the poller sees a new Questrade price", async () => {
    fake.quotes.set(22, { lastTradePrice: 130, delay: 0 });
    const placed = (await post("/api/orders", { symbol: "RY", side: "buy", quantity: 5, type: "limit", limitPrice: "128.00" })).json as PlaceOrderResponse;
    expect(placed.orders[0]?.status).toBe("open");

    fake.quotes.set(22, { lastTradePrice: 127.5, delay: 0 });
    server.clock.ms += 16_000;
    expect(await pollOnce(testDb.db, server.services.prices, () => {})).toContain("RY");
    const orders = (await get("/api/orders")).json as OrderView[];
    expect(orders.find((o) => o.id === placed.orders[0]?.id)).toMatchObject({ status: "filled", fill: { price: "127.5000" } });
  });
});

describe("without Questrade", () => {
  beforeEach(() => start(false));

  it("works on typed-in prices only and never calls out", async () => {
    await post("/api/quotes", { symbol: "TD", price: "80" });
    const res = await get("/api/quotes/TD");
    expect((res.json as QuoteView).source).toBe("manual");
    expect(fake.calls).toHaveLength(0);
  });
});
