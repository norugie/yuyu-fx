import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser } from "../src/api/auth/users.js";
import { fills } from "../src/db/schema.js";
import { createTestDatabase, type TestDatabase } from "./helpers/test-db.js";
import { startTestServer } from "./helpers/test-server.js";

// Eval E4 (PRD §6): a fixed suite of malformed and over-limit orders, sent through
// the real API with the default risk limits. Target: 100% rejected, nothing filled.

let testDb: TestDatabase;
let server: Awaited<ReturnType<typeof startTestServer>>;
let session: { cookie: string; csrf: string };

beforeAll(async () => {
  testDb = await createTestDatabase();
  await createUser(testDb.db, "e4-test", "long enough password");
  server = await startTestServer(testDb.db);
  session = await server.login("e4-test", "long enough password");
  const post = (path: string, body: unknown) => server.call(path, { method: "POST", body, cookie: session.cookie, csrf: session.csrf });
  await server.call("/api/risk/settings", {
    method: "PUT",
    body: { password: "long enough password", settings: { allowedSymbols: ["RY", "XIU", "TD"] } }, // TD has no price: tests the no-price rule
    cookie: session.cookie,
    csrf: session.csrf,
  });
  await post("/api/quotes", { symbol: "RY", price: "100" });
  await post("/api/quotes", { symbol: "XIU", price: "50" });
});
afterAll(async () => {
  await server.close();
  await testDb.cleanup();
});

const good = { symbol: "RY", side: "buy", quantity: 10, type: "bracket", entry: "market", stopLossPrice: "98", takeProfitPrice: "106" };

const SUITE: [string, unknown][] = [
  // Malformed (400)
  ["empty body", {}],
  ["not an object", "buy RY"],
  ["unknown type", { ...good, type: "stop" }],
  ["bad symbol", { ...good, symbol: "RY; DROP TABLE orders" }],
  ["lowercase junk symbol", { ...good, symbol: "r!y" }],
  ["zero quantity", { ...good, quantity: 0 }],
  ["negative quantity", { ...good, quantity: -10 }],
  ["fractional quantity", { ...good, quantity: 1.5 }],
  ["quantity as string", { ...good, quantity: "10" }],
  ["huge quantity number", { ...good, quantity: 1e20 }],
  ["price as number", { ...good, stopLossPrice: 98 }],
  ["negative price", { ...good, stopLossPrice: "-98" }],
  ["too many decimals", { ...good, takeProfitPrice: "106.123456" }],
  ["stop above entry for a buy", { ...good, entry: "limit", limitPrice: "100", stopLossPrice: "101" }],
  ["limit order without price", { symbol: "RY", side: "buy", quantity: 10, type: "limit" }],
  ["unknown side", { ...good, side: "short" }],
  // Over the limits (422)
  ["not on the whitelist", { ...good, symbol: "SHOP" }],
  ["no stop-loss", { symbol: "RY", side: "buy", quantity: 10, type: "market" }],
  ["risk per trade over 1%", { ...good, quantity: 90, stopLossPrice: "85" }],
  ["position over 10%", { ...good, quantity: 200, stopLossPrice: "99.6" }],
  ["over the share cap", { ...good, quantity: 10_001 }],
  ["limit far from the price", { ...good, entry: "limit", limitPrice: "50", stopLossPrice: "49", takeProfitPrice: "55" }],
  ["stop far from the price", { ...good, stopLossPrice: "50" }],
  ["selling what you don't hold", { symbol: "XIU", side: "sell", quantity: 10, type: "market" }],
  ["short bracket", { ...good, side: "sell", stopLossPrice: "106", takeProfitPrice: "98" }],
  ["no price yet", { ...good, symbol: "TD" }],
];

describe("E4: order-path safety", () => {
  it(`rejects all ${SUITE.length} bad orders and fills none of them`, async () => {
    const results: { name: string; status: number }[] = [];
    for (const [name, body] of SUITE) {
      // A minute apart, so each order meets its own rule rather than the per-minute limit.
      server.clock.ms += 61_000;
      const res = await server.call("/api/orders", { method: "POST", body, cookie: session.cookie, csrf: session.csrf });
      results.push({ name, status: res.status });
    }
    const accepted = results.filter((r) => r.status !== 400 && r.status !== 422);
    expect(accepted).toEqual([]); // 100% rejected
    const rules = server.logs.filter((l) => l.event === "order.reject").map((l) => l.fields.rule);
    expect(rules).not.toContain("rate_limit");
    expect(new Set(rules).size).toBeGreaterThanOrEqual(9); // many different rules exercised
    expect(await testDb.db.select().from(fills)).toHaveLength(0);
    // Sanity check of the suite itself: a good order does get through.
    server.clock.ms += 61_000;
    const ok = await server.call("/api/orders", { method: "POST", body: good, cookie: session.cookie, csrf: session.csrf });
    expect(ok.status).toBe(201);
  });
});
