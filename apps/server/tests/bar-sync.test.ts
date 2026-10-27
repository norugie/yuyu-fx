import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { syncAll, syncSymbol } from "../src/data/bar-sync.js";
import { createQuestradeClient, type QuestradeClient } from "../src/data/questrade/client.js";
import { createMemoryTokenStore } from "../src/data/questrade/token-store.js";
import { dailyBars, instruments } from "../src/db/schema.js";
import { createTestDatabase, type TestDatabase } from "./helpers/test-db.js";
import { startFakeQuestrade, syntheticBars, type FakeQuestrade } from "./helpers/fake-questrade.js";

// Task 4.5: daily-bar sync (AC10.1) against the fake Questrade.

let testDb: TestDatabase;
let fake: FakeQuestrade;
let client: QuestradeClient;
const quiet = () => {};
const NOW = new Date("2026-10-27T20:00:00Z"); // Tuesday afternoon in Toronto
const bars = syntheticBars("2026-01-02", 210); // Jan 2 .. late Oct 2026, weekdays

beforeAll(async () => {
  testDb = await createTestDatabase();
});
afterAll(async () => {
  await fake.close();
  await testDb.cleanup();
});
beforeEach(async () => {
  if (fake) await fake.close();
  fake = await startFakeQuestrade("t");
  fake.candles.set(11, bars);
  client = createQuestradeClient({ store: createMemoryTokenStore(), envRefreshToken: "t", loginUrl: fake.baseUrl, log: quiet, minIntervalMs: 0 });
  await testDb.db.delete(dailyBars);
});

const stored = () => testDb.db.select().from(dailyBars).where(eq(dailyBars.symbol, "XIU")).orderBy(asc(dailyBars.date));

describe("syncSymbol", () => {
  it("first run stores everything up to yesterday, with exact prices", async () => {
    const r = await syncSymbol(testDb.db, client, "XIU", NOW, quiet, 1);
    const rows = await stored();
    const expected = bars.filter((b) => b.date <= "2026-10-26");
    expect(r.added).toBe(expected.length);
    expect(rows).toHaveLength(expected.length);
    expect(rows.at(-1)?.date).toBe(expected.at(-1)?.date);
    expect(rows[0]).toMatchObject({ date: "2026-01-02", close: expected[0]?.close.toFixed(4), source: "questrade" });
    // The symbol id is remembered.
    expect((await testDb.db.select().from(instruments).where(eq(instruments.symbol, "XIU")))[0]?.questradeSymbolId).toBe(11);
  });

  it("second run adds nothing (no duplicates)", async () => {
    await syncSymbol(testDb.db, client, "XIU", NOW, quiet, 1);
    const count = (await stored()).length;
    const r = await syncSymbol(testDb.db, client, "XIU", NOW, quiet, 1);
    expect(r.added).toBe(0);
    expect(await stored()).toHaveLength(count);
  });

  it("doesn't ask Questrade at all when the last stored bar is yesterday", async () => {
    const lastDay = bars.at(-1)?.date ?? "";
    const dayAfter = new Date(`${lastDay}T20:00:00Z`);
    dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
    await syncSymbol(testDb.db, client, "XIU", dayAfter, quiet, 1);
    const before = fake.calls.filter((c) => c.includes("candles")).length;
    expect(await syncSymbol(testDb.db, client, "XIU", dayAfter, quiet, 1)).toMatchObject({ added: 0, from: null });
    expect(fake.calls.filter((c) => c.includes("candles")).length).toBe(before);
  });

  it("a later run fetches only the missing days", async () => {
    await syncSymbol(testDb.db, client, "XIU", new Date("2026-10-20T20:00:00Z"), quiet, 1);
    const r = await syncSymbol(testDb.db, client, "XIU", NOW, quiet, 1);
    expect(r.from).toBe("2026-10-20");
    expect(r.added).toBe(bars.filter((b) => b.date >= "2026-10-20" && b.date <= "2026-10-26").length);
  });

  it("skips (and logs) a nonsense candle instead of failing", async () => {
    const bad = bars.map((b, i) => (i === 3 ? { ...b, high: b.low - 1 } : b));
    fake.candles.set(11, bad);
    const logs: string[] = [];
    const r = await syncSymbol(testDb.db, client, "XIU", NOW, (event) => logs.push(event), 1);
    expect(r.skipped).toBe(1);
    expect(logs).toContain("bars.sync.skipped");
  });
});

describe("syncAll", () => {
  it("keeps going when one symbol fails", async () => {
    const { results, failed } = await syncAll(testDb.db, client, ["NOPE", "XIU"], NOW, quiet);
    expect(failed.map((f) => f.symbol)).toEqual(["NOPE"]);
    expect(results.map((r) => r.symbol)).toEqual(["XIU"]);
  });
});
