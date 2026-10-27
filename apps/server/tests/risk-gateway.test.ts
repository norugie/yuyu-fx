import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { KillSwitchResult, OrderRejectedResponse, OrderView, PlaceOrderResponse, PortfolioView, RiskStatus } from "@yuyufx/shared";
import { createUser } from "../src/api/auth/users.js";
import { DEFAULT_COSTS } from "../src/broker/fill-rules.js";
import { createSimulatedBroker } from "../src/broker/simulated.js";
import { createManualPriceSource } from "../src/data/manual-quotes.js";
import { toUnits } from "../src/money.js";
import { createOrderGateway } from "../src/risk/gateway.js";
import { createTestDatabase, type TestDatabase } from "./helpers/test-db.js";
import { relaxRisk } from "./helpers/risk.js";
import { startTestServer } from "./helpers/test-server.js";

// Tasks 5.3-5.5 through the real app, with the real default limits:
// equity $100,000 -> risk per trade $1,000, max position $10,000.

let testDb: TestDatabase;
let server: Awaited<ReturnType<typeof startTestServer>>;
let session: { cookie: string; csrf: string };
let userId: string;
let n = 0;
const PASSWORD = "long enough password";
const DAY = 86_400_000;

beforeAll(async () => {
  testDb = await createTestDatabase();
});
afterAll(async () => {
  await testDb.cleanup();
});
beforeEach(async () => {
  const username = `risk-test-${++n}`;
  userId = (await createUser(testDb.db, username, PASSWORD)).id;
  server = await startTestServer(testDb.db);
  session = await server.login(username, PASSWORD);
});
afterEach(async () => {
  await server.close();
});

// Each test uses its own symbols (prices are shared market data).
const sym = (base: string) => `${base}${String.fromCharCode(65 + (n % 26))}`;
const post = (path: string, body: unknown) => server.call(path, { method: "POST", body, cookie: session.cookie, csrf: session.csrf });
const put = (path: string, body: unknown) => server.call(path, { method: "PUT", body, cookie: session.cookie, csrf: session.csrf });
const get = (path: string) => server.call(path, { cookie: session.cookie });
const setPrice = (symbol: string, price: string) => {
  server.clock.ms += 1_000;
  return post("/api/quotes", { symbol, price });
};
const relogin = async () => {
  session = await server.login(`risk-test-${n}`, PASSWORD);
};
const allow = (symbols: string[]) => put("/api/risk/settings", { password: PASSWORD, settings: { allowedSymbols: symbols } });

describe("default limits through the API", () => {
  it("refuses a plain buy (a stop-loss is required) and logs the rule", async () => {
    const s = sym("AA");
    await allow([s]);
    await setPrice(s, "100");
    const res = await post("/api/orders", { symbol: s, side: "buy", quantity: 10, type: "market" });
    expect(res.status).toBe(422);
    expect((res.json as OrderRejectedResponse).error).toMatch(/need a stop-loss/);
    expect(server.logs.at(-1)).toMatchObject({ event: "order.reject", fields: { rule: "stop_required" } });
  });

  it("accepts a bracket within 1% risk and 10% size", async () => {
    const s = sym("AB");
    await allow([s]);
    await setPrice(s, "100");
    const res = await post("/api/orders", { symbol: s, side: "buy", quantity: 50, type: "bracket", entry: "market", stopLossPrice: "98", takeProfitPrice: "106" });
    expect(res.status).toBe(201);
    expect((res.json as PlaceOrderResponse).orders[0]?.status).toBe("filled");
  });

  it("refuses symbols that aren't on the allowed list", async () => {
    const s = sym("AC");
    await setPrice(s, "100");
    const res = await post("/api/orders", { symbol: s, side: "buy", quantity: 5, type: "bracket", entry: "market", stopLossPrice: "98", takeProfitPrice: "106" });
    expect((res.json as OrderRejectedResponse).error).toMatch(/allowed symbols/);
  });
});

describe("account guards (AC5.5)", () => {
  it("a 3% loss today halts automation until the next day; manual orders still go through the rules", async () => {
    const s = sym("BA");
    await relaxRisk(testDb.db, userId, [s]);
    await setPrice(s, "100");
    await post("/api/orders", { symbol: s, side: "buy", quantity: 500, type: "market" }); // ~$50,000
    await setPrice(s, "93"); // -7% on half the account = about -3.5% today
    let status = (await get("/api/risk")).json as RiskStatus;
    expect(status.automationAllowed).toBe(false);
    expect(status.halts.join()).toMatch(/daily loss limit/);

    const automated = await server.services.gateway.place(userId, { symbol: s, side: "buy", quantity: 1, type: "market" }, "rules");
    expect(automated).toMatchObject({ kind: "rejected" });
    const manual = await server.services.gateway.place(userId, { symbol: s, side: "buy", quantity: 1, type: "market" }, "manual");
    expect(manual.kind).toBe("placed");

    server.clock.ms += DAY; // next day, same price: no new loss today
    await relogin();
    await setPrice(s, "93");
    status = (await get("/api/risk")).json as RiskStatus;
    expect(status.halts.join()).not.toMatch(/daily loss/);
  });

  it("a 15% fall from the peak halts automation until Youmu re-enables it (password)", async () => {
    const s = sym("BB");
    await relaxRisk(testDb.db, userId, [s]);
    await setPrice(s, "100");
    await post("/api/orders", { symbol: s, side: "buy", quantity: 900, type: "market" });
    await get("/api/risk"); // records the peak
    server.clock.ms += DAY;
    await relogin();
    await setPrice(s, "80"); // -20% on 90% of the account: about -18% from the peak
    let status = (await get("/api/risk")).json as RiskStatus;
    expect(status.halts.join()).toMatch(/drawdown limit/);
    expect(status.drawdown).toBeGreaterThan(0.15);

    server.clock.ms += DAY; // still halted the day after: needs a human
    await relogin();
    await setPrice(s, "80");
    expect(((await get("/api/risk")).json as RiskStatus).halts.join()).toMatch(/drawdown/);

    expect((await post("/api/risk/resume", { password: "wrong password" })).status).toBe(403);
    status = (await post("/api/risk/resume", { password: PASSWORD })).json as RiskStatus;
    expect(status.halts.join()).not.toMatch(/drawdown/);
  });

  it("pauses automation when the daily bars are out of date (AC5.3)", async () => {
    const gateway = createOrderGateway({
      db: testDb.db,
      broker: createSimulatedBroker({ db: testDb.db, prices: createManualPriceSource(testDb.db), now: () => new Date(server.clock.ms), log: () => {} }),
      prices: createManualPriceSource(testDb.db),
      costs: DEFAULT_COSTS,
      startingCash: toUnits("100000"),
      mode: "paper",
      marketDataSymbols: ["NOBARS"],
      now: () => new Date(server.clock.ms),
      log: () => {},
    });
    const status = await gateway.status(userId);
    expect(status.halts).toContain("daily bars out of date for NOBARS");
    expect(await gateway.place(userId, { symbol: "NOBARS", side: "buy", quantity: 1, type: "market" }, "ai")).toMatchObject({ kind: "rejected" });
  });
});

describe("kill switch (AC5.2)", () => {
  it("cancels every open order, sells every position, and stops automation until re-enabled", async () => {
    const [a, b] = [sym("CA"), sym("CB")];
    await relaxRisk(testDb.db, userId, [a, b]);
    await setPrice(a, "50");
    await setPrice(b, "20");
    await post("/api/orders", { symbol: a, side: "buy", quantity: 10, type: "market" });
    await post("/api/orders", { symbol: b, side: "buy", quantity: 10, type: "bracket", entry: "market", stopLossPrice: "18", takeProfitPrice: "25" });
    await post("/api/orders", { symbol: a, side: "buy", quantity: 5, type: "limit", limitPrice: "48" });

    const result = (await post("/api/risk/kill-switch", { flatten: true })).json as KillSwitchResult;
    expect(result.cancelledOrders).toBe(3); // the limit + the bracket's two exits
    expect(result.flattened.sort()).toEqual([a, b].sort());
    const portfolio = (await get("/api/portfolio")).json as PortfolioView;
    expect(portfolio.openPositions).toEqual([]);
    const orders = (await get("/api/orders")).json as OrderView[];
    expect(orders.filter((o) => o.status === "open")).toEqual([]);

    const status = (await get("/api/risk")).json as RiskStatus;
    expect(status.killSwitchActive).toBe(true);
    expect(await server.services.gateway.place(userId, { symbol: a, side: "buy", quantity: 1, type: "market" }, "rules")).toMatchObject({ kind: "rejected" });

    await post("/api/risk/resume", { password: PASSWORD });
    expect(((await get("/api/risk")).json as RiskStatus).killSwitchActive).toBe(false);
  });

  it("without flatten, keeps positions and just cancels orders", async () => {
    const a = sym("DA");
    await relaxRisk(testDb.db, userId, [a]);
    await setPrice(a, "50");
    await post("/api/orders", { symbol: a, side: "buy", quantity: 10, type: "market" });
    const result = (await post("/api/risk/kill-switch", { flatten: false })).json as KillSwitchResult;
    expect(result).toEqual({ cancelledOrders: 0, flattened: [], notFlattened: [] });
    expect(((await get("/api/portfolio")).json as PortfolioView).openPositions).toHaveLength(1);
  });
});

describe("settings (AC5.6)", () => {
  it("changes limits only with the right password, and validates them", async () => {
    expect((await put("/api/risk/settings", { password: "nope", settings: { maxOpenPositions: 5 } })).status).toBe(403);
    expect((await put("/api/risk/settings", { password: PASSWORD, settings: { maxOpenPositions: 0 } })).status).toBe(400);
    const res = await put("/api/risk/settings", { password: PASSWORD, settings: { maxOpenPositions: 5, allowedSymbols: ["xiu"] } });
    expect(res.status).toBe(200);
    expect((res.json as RiskStatus).settings).toMatchObject({ maxOpenPositions: 5, allowedSymbols: ["XIU"] });
    expect(server.logs.some((l) => l.event === "risk.settings.changed")).toBe(true);
  });

  it("blocks guessing: 5 wrong passwords, then 429", async () => {
    for (let i = 0; i < 5; i++) await put("/api/risk/settings", { password: `wrong ${i}`, settings: {} });
    expect((await put("/api/risk/settings", { password: PASSWORD, settings: {} })).status).toBe(429);
  });

  it("needs the CSRF token like every other change", async () => {
    const res = await server.call("/api/risk/kill-switch", { method: "POST", body: { flatten: false }, cookie: session.cookie });
    expect(res.status).toBe(403);
  });
});

describe("one path to the broker (AC5.4)", () => {
  it("only the gateway calls broker.place", () => {
    const src = fileURLToPath(new URL("../src", import.meta.url));
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith(".ts")) files.push(path);
      }
    };
    walk(src);
    const using = (pattern: RegExp) =>
      files
        .filter((f) => pattern.test(readFileSync(f, "utf8")))
        .map((f) => relative(src, f).replaceAll("\\", "/"))
        .sort();
    // Only the gateway places orders on the broker...
    expect(using(/broker\.place\(/)).toEqual(["risk/gateway.ts"]);
    // ...and the broker is only built in one place, which hands it to the gateway.
    expect(using(/createSimulatedBroker\(/)).toEqual(["app.ts", "broker/simulated.ts"]);
  });
});
