import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createQuestradeClient,
  exchangeMidnight,
  priceToDecimal,
  QuestradeApiError,
  QuestradeAuthError,
  QuestradeNotConfiguredError,
  toQuestradeSymbol,
} from "../src/data/questrade/client.js";
import { createMemoryTokenStore, fingerprint } from "../src/data/questrade/token-store.js";
import type { LogFields } from "../src/log.js";
import { startFakeQuestrade, syntheticBars, type FakeQuestrade } from "./helpers/fake-questrade.js";

// Task 4.3: the Questrade client against a fake Questrade server.

let fake: FakeQuestrade;
let logs: { event: string; fields: LogFields }[];

beforeEach(async () => {
  fake = await startFakeQuestrade("bootstrap-token-1");
  logs = [];
});
afterEach(async () => {
  await fake.close();
});

/** `env: null` means no QUESTRADE_REFRESH_TOKEN in .env. */
const client = (store = createMemoryTokenStore(), env: string | null = "bootstrap-token-1") =>
  createQuestradeClient({
    store,
    envRefreshToken: env ?? undefined,
    loginUrl: fake.baseUrl,
    log: (event, fields = {}) => logs.push({ event, fields }),
    sleep: async () => {},
    minIntervalMs: 0,
  });

describe("tokens (AC10.3)", () => {
  it("bootstraps from the .env token, then stores and reuses the rotated token", async () => {
    const store = createMemoryTokenStore();
    fake.quotes.set(11, { lastTradePrice: 35.12, delay: 0 });
    await client(store).quote(11);
    expect(store.current).toEqual({ refreshToken: "rotated-token-1", bootstrapHash: fingerprint("bootstrap-token-1") });

    // A new process: same .env token (already used), so it must use the stored one.
    await client(store).quote(11);
    expect(store.current?.refreshToken).toBe("rotated-token-2");
    expect(fake.tokenExchanges).toBe(2);
  });

  it("picks up a newly pasted .env token", async () => {
    const store = createMemoryTokenStore({ refreshToken: "stale-token", bootstrapHash: fingerprint("old-env-token") });
    fake.validRefreshTokens.add("new-env-token");
    fake.quotes.set(11, { lastTradePrice: 35, delay: 0 });
    await client(store, "new-env-token").quote(11);
    expect(store.current?.bootstrapHash).toBe(fingerprint("new-env-token"));
  });

  it("refreshes only once when many requests start together (single-use tokens)", async () => {
    fake.quotes.set(11, { lastTradePrice: 35, delay: 0 });
    const c = client();
    await Promise.all([c.quote(11), c.quote(11), c.quote(11)]);
    expect(fake.tokenExchanges).toBe(1);
  });

  it("explains what to do when the token is rejected", async () => {
    await expect(client(createMemoryTokenStore(), "unknown-token").quote(11)).rejects.toThrow(QuestradeAuthError);
    await expect(client(createMemoryTokenStore(), "unknown-token").quote(11)).rejects.toThrow(/Generate a new one/);
  });

  it("says Questrade isn't set up when there's no token at all", async () => {
    await expect(client(createMemoryTokenStore(), null).quote(11)).rejects.toThrow(QuestradeNotConfiguredError);
  });

  it("never logs or throws tokens", async () => {
    fake.quotes.set(11, { lastTradePrice: 35, delay: 0 });
    await client().quote(11);
    const everything = JSON.stringify(logs);
    expect(everything).not.toMatch(/bootstrap-token|rotated-token|access-/);
    try {
      await client(createMemoryTokenStore(), "secret-unknown-token").quote(11);
    } catch (error) {
      expect(String(error)).not.toContain("secret-unknown-token");
    }
  });
});

describe("market data", () => {
  it("finds a TSX symbol (XIU -> XIU.TO), ignoring other exchanges", async () => {
    expect(toQuestradeSymbol("bbd.b")).toBe("BBD.B.TO");
    const c = client(); // one client: the bootstrap token works once
    expect(await c.findSymbol("RY")).toMatchObject({ symbol: "RY.TO", symbolId: 22, currency: "CAD" });
    await expect(c.findSymbol("SHOP")).rejects.toThrow(/not found on TSX/);
  });

  it("returns the last price and how delayed it is", async () => {
    const c = client();
    fake.quotes.set(11, { lastTradePrice: 35.12, delay: 15 });
    expect(await c.quote(11)).toMatchObject({ price: 35.12, delayMinutes: 15 });
    fake.quotes.set(11, { lastTradePrice: null, delay: 0 });
    await expect(c.quote(11)).rejects.toThrow(/no last trade price/);
  });

  it("fetches daily candles across several pages and keeps exchange dates", async () => {
    const bars = syntheticBars("2015-01-01", 2_600); // ~10 years: more than one 5-year page
    fake.candles.set(11, bars);
    const got = await client().dailyCandles(11, "2015-01-01", bars.at(-1)?.date ?? "");
    expect(got).toHaveLength(bars.length);
    expect(got[0]).toEqual(bars[0]);
    expect(fake.calls.filter((c) => c.includes("candles")).length).toBeGreaterThan(1);
  });

  it("waits and retries when rate-limited (AC10.4)", async () => {
    fake.quotes.set(11, { lastTradePrice: 35, delay: 0 });
    fake.rateLimitNext = 2;
    expect((await client().quote(11)).price).toBe(35);
    expect(logs.filter((l) => l.event === "questrade.rate_limited")).toHaveLength(2);
  });

  it("reports server errors without leaking anything", async () => {
    fake.failNext = 1;
    await expect(client().quote(11)).rejects.toThrow(QuestradeApiError);
  });
});

describe("helpers", () => {
  it("formats exchange midnight with the right offset (EDT vs EST)", () => {
    expect(exchangeMidnight("2026-07-01")).toBe("2026-07-01T00:00:00-04:00");
    expect(exchangeMidnight("2026-12-01")).toBe("2026-12-01T00:00:00-05:00");
  });

  it("turns JSON prices into exact 4-decimal strings", () => {
    expect(priceToDecimal(35.12)).toBe("35.1200");
    expect(() => priceToDecimal(Number.NaN)).toThrow();
    expect(() => priceToDecimal(-1)).toThrow();
  });
});

describe("token safety (single-use tokens)", () => {
  it("uses a token another process just saved instead of failing", async () => {
    const store = createMemoryTokenStore();
    fake.quotes.set(11, { lastTradePrice: 35, delay: 0 });
    // Process A bootstraps and saves rotated-token-1.
    await client(store).quote(11);
    // Process B loaded rotated-token-1 earlier; A then refreshes again (rotated-token-2 saved).
    const b = client(store);
    const stale = { ...store.current! };
    await client(store).quote(11);
    // B now tries the stale token: rejected, reloads the store, retries once with the newer one.
    const s = store.current!;
    store.current = stale;
    const saveCurrent = store.save.bind(store);
    let loads = 0;
    store.load = async () => (++loads === 1 ? stale : s);
    store.save = saveCurrent;
    expect((await b.quote(11)).price).toBe(35);
  });

  it("if the new token can't be saved, says to generate a new one (no blind retries)", async () => {
    const store = createMemoryTokenStore();
    store.save = async () => {
      throw new Error("db down");
    };
    await expect(client(store).quote(11)).rejects.toThrow(/couldn't be saved.*generate a new token/);
    expect(fake.tokenExchanges).toBe(1);
  });
});
