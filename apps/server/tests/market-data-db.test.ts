import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbTokenStore } from "../src/data/questrade/token-store.js";
import { brokerCredentials, dailyBars } from "../src/db/schema.js";
import { createTestDatabase, type TestDatabase } from "./helpers/test-db.js";

// Tasks 4.1 / 4.2: market-data tables and the encrypted token store, on real Postgres.

let testDb: TestDatabase;
beforeAll(async () => {
  testDb = await createTestDatabase();
});
afterAll(async () => {
  await testDb.cleanup();
});

async function constraintOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { cause?: { constraint?: string } }).cause?.constraint;
  }
  return undefined;
}

const bar = (date: string, o: Partial<typeof dailyBars.$inferInsert> = {}) => ({
  symbol: "XIU",
  date,
  open: "35.00",
  high: "35.50",
  low: "34.80",
  close: "35.20",
  volume: 1_000_000,
  source: "questrade" as const,
  ...o,
});

describe("daily_bars", () => {
  it("stores one bar per symbol per day, with exact prices", async () => {
    await testDb.db.insert(dailyBars).values(bar("2026-10-26"));
    const rows = await testDb.db.select().from(dailyBars);
    expect(rows[0]).toMatchObject({ date: "2026-10-26", close: "35.2000", volume: 1_000_000 });
    expect(await constraintOf(testDb.db.insert(dailyBars).values(bar("2026-10-26")))).toBe("daily_bars_symbol_date_pk");
  });

  it("rejects impossible bars (high below close, zero prices, negative volume)", async () => {
    expect(await constraintOf(testDb.db.insert(dailyBars).values(bar("2026-10-27", { high: "35.10" })))).toBe(
      "daily_bars_ohlc_order",
    );
    expect(await constraintOf(testDb.db.insert(dailyBars).values(bar("2026-10-28", { low: "0", open: "0.5", close: "0.5", high: "1" })))).toBe(
      "daily_bars_positive",
    );
    expect(await constraintOf(testDb.db.insert(dailyBars).values(bar("2026-10-29", { volume: -1 })))).toBe(
      "daily_bars_volume_not_negative",
    );
  });
});

describe("encrypted token store", () => {
  it("saves, overwrites and loads the refresh token; the database never holds it in plain text", async () => {
    const store = createDbTokenStore(testDb.db, randomBytes(32));
    expect(await store.load()).toBeNull();
    await store.save({ refreshToken: "first-plaintext-token", bootstrapHash: "abc" });
    await store.save({ refreshToken: "second-plaintext-token", bootstrapHash: "abc" });
    expect(await store.load()).toEqual({ refreshToken: "second-plaintext-token", bootstrapHash: "abc" });
    const raw = await testDb.db.select().from(brokerCredentials);
    expect(raw).toHaveLength(1);
    expect(JSON.stringify(raw)).not.toContain("plaintext-token");
  });

  it("can't be read with a different key", async () => {
    await expect(createDbTokenStore(testDb.db, randomBytes(32)).load()).rejects.toThrow(/could not be decrypted/);
  });
});
