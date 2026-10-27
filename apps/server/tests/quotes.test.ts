import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { QuoteView } from "@yuyufx/shared";
import { createUser } from "../src/api/auth/users.js";
import { exchangeDate, isStale } from "../src/data/price-source.js";
import { createTestDatabase, type TestDatabase } from "./helpers/test-db.js";
import { startTestServer, type TestServer } from "./helpers/test-server.js";

// Task 3.2: typed-in prices (PRD Q5, decision D1).

describe("isStale (exchange time = Toronto)", () => {
  it("is fresh on the same Toronto day, stale from the next day", () => {
    const quoted = new Date("2026-10-27T14:00:00Z"); // 10:00 Toronto (EDT)
    expect(isStale(quoted, new Date("2026-10-27T20:59:00Z"))).toBe(false);
    expect(isStale(quoted, new Date("2026-10-28T14:00:00Z"))).toBe(true);
  });

  it("uses Toronto's date, not UTC's", () => {
    // 22:30 Toronto on Oct 27 is already Oct 28 in UTC.
    const lateEvening = new Date("2026-10-28T02:30:00Z");
    expect(exchangeDate(lateEvening)).toBe("2026-10-27");
    expect(isStale(new Date("2026-10-27T14:00:00Z"), lateEvening)).toBe(false);
    // 00:30 Toronto on Oct 28.
    expect(isStale(new Date("2026-10-27T14:00:00Z"), new Date("2026-10-28T04:30:00Z"))).toBe(true);
  });

  it("handles the daylight-saving change (Nov 1, 2026)", () => {
    // 23:30 Toronto on Nov 1 (EST, UTC-5) is 04:30 UTC on Nov 2.
    expect(exchangeDate(new Date("2026-11-02T04:30:00Z"))).toBe("2026-11-01");
  });
});

describe("quotes API", () => {
  let testDb: TestDatabase;
  let server: TestServer;
  let session: { cookie: string; csrf: string };

  beforeAll(async () => {
    testDb = await createTestDatabase();
    await createUser(testDb.db, "quotes-test", "long enough password");
  });

  afterAll(async () => {
    await server.close();
    await testDb.cleanup();
  });

  beforeEach(async () => {
    if (server) await server.close();
    server = await startTestServer(testDb.db);
    session = await server.login("quotes-test", "long enough password");
  });

  const setQuote = (body: unknown, overrides: { csrf?: string } = {}) =>
    server.call("/api/quotes", { method: "POST", body, cookie: session.cookie, csrf: overrides.csrf ?? session.csrf });

  it("sets a price and reads it back (symbol normalized, exact decimals)", async () => {
    const set = await setQuote({ symbol: "xiu", price: "35.1" });
    expect(set.status).toBe(201);
    expect(set.json).toMatchObject({ symbol: "XIU", price: "35.1000", source: "manual", stale: false });

    const read = await server.call("/api/quotes/xiu", { cookie: session.cookie });
    expect(read.status).toBe(200);
    expect(read.json).toEqual(set.json);
    expect(server.logs.at(-1)).toMatchObject({ event: "quote.set", fields: { symbol: "XIU", price: "35.1000" } });
  });

  it("returns the latest price when several were entered", async () => {
    await setQuote({ symbol: "RY", price: "130.00" });
    server.clock.ms += 60_000;
    await setQuote({ symbol: "RY", price: "131.25" });
    const read = await server.call("/api/quotes/RY", { cookie: session.cookie });
    expect((read.json as QuoteView).price).toBe("131.2500");
  });

  it("flags a price from an earlier day as stale", async () => {
    await setQuote({ symbol: "TD", price: "80" });
    server.clock.ms += 24 * 60 * 60 * 1000;
    // A day later the 30-minute session has expired too, so log in again.
    session = await server.login("quotes-test", "long enough password");
    const read = await server.call("/api/quotes/TD", { cookie: session.cookie });
    expect(read.status).toBe(200);
    expect((read.json as QuoteView).stale).toBe(true);
  });

  it("404s for a symbol with no price yet", async () => {
    const read = await server.call("/api/quotes/SHOP", { cookie: session.cookie });
    expect(read.status).toBe(404);
    expect(read.json).toEqual({ error: "No price for SHOP yet" });
  });

  it("rejects bad input with a clear message", async () => {
    expect((await setQuote({ symbol: "RY", price: 130 })).status).toBe(400);
    expect((await setQuote({ symbol: "RY", price: "-1" })).status).toBe(400);
    const badSymbol = await setQuote({ symbol: "not a symbol", price: "1" });
    expect(badSymbol.status).toBe(400);
    expect((badSymbol.json as { error: string }).error).toMatch(/TSX symbol/);
    expect((await server.call("/api/quotes/bad%20symbol", { cookie: session.cookie })).status).toBe(400);
  });

  it("needs a login (401) and the CSRF token (403)", async () => {
    expect((await server.call("/api/quotes/RY")).status).toBe(401);
    expect((await server.call("/api/quotes", { method: "POST", body: { symbol: "RY", price: "1" } })).status).toBe(401);
    expect((await setQuote({ symbol: "RY", price: "1" }, { csrf: "x".repeat(43) })).status).toBe(403);
  });
});
