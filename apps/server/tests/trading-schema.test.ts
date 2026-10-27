import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser } from "../src/api/auth/users.js";
import { fills, orders, quotes } from "../src/db/schema.js";
import { createTestDatabase, type TestDatabase } from "./helpers/test-db.js";

// Task 3.1: the database itself refuses impossible rows, even if code forgot to validate.

let testDb: TestDatabase;
let userId: string;

beforeAll(async () => {
  testDb = await createTestDatabase();
  userId = (await createUser(testDb.db, "trader-test", "long enough password")).id;
});

afterAll(async () => {
  await testDb.cleanup();
});

const baseOrder = () => ({
  userId,
  source: "manual" as const,
  mode: "paper" as const,
  symbol: "RY",
  side: "buy" as const,
  type: "market" as const,
  quantity: 10,
  status: "open" as const,
});

/** Drizzle wraps the Postgres error; the constraint name is on the cause. */
async function constraintOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: { constraint?: string } }).cause;
    return cause?.constraint;
  }
  return undefined;
}

describe("trading tables", () => {
  it("stores a bracket as an entry plus two children, with exact decimal prices", async () => {
    const [entry] = await testDb.db
      .insert(orders)
      .values({ ...baseOrder(), type: "limit", limitPrice: "130.1234", bracketRole: "entry" })
      .returning();
    if (!entry) throw new Error("no entry row");
    await testDb.db.insert(orders).values([
      { ...baseOrder(), side: "sell", type: "stop", stopPrice: "125", parentId: entry.id, bracketRole: "stop_loss" },
      { ...baseOrder(), side: "sell", type: "limit", limitPrice: "140", parentId: entry.id, bracketRole: "take_profit" },
    ]);
    expect(entry.limitPrice).toBe("130.1234"); // a string, not a float
  });

  it("records a fill and a quote", async () => {
    const [order] = await testDb.db.insert(orders).values(baseOrder()).returning();
    if (!order) throw new Error("no order row");
    const [fill] = await testDb.db
      .insert(fills)
      .values({ orderId: order.id, userId, symbol: "RY", side: "buy", quantity: 10, price: "0.1", filledAt: new Date() })
      .returning();
    expect(fill?.fee).toBe("0.0000");
    const [quote] = await testDb.db
      .insert(quotes)
      .values({ symbol: "RY", price: "130.5", source: "manual", quotedAt: new Date(), enteredBy: userId })
      .returning();
    expect(quote?.price).toBe("130.5000");
  });

  it("rejects a limit order without a limit price", async () => {
    expect(await constraintOf(testDb.db.insert(orders).values({ ...baseOrder(), type: "limit" }))).toBe(
      "orders_limit_needs_price",
    );
  });

  it("rejects a stop order without a stop price", async () => {
    expect(await constraintOf(testDb.db.insert(orders).values({ ...baseOrder(), type: "stop" }))).toBe(
      "orders_stop_needs_price",
    );
  });

  it("rejects zero quantities and non-positive prices", async () => {
    expect(await constraintOf(testDb.db.insert(orders).values({ ...baseOrder(), quantity: 0 }))).toBe(
      "orders_quantity_positive",
    );
    expect(
      await constraintOf(
        testDb.db.insert(quotes).values({ symbol: "RY", price: "0", source: "manual", quotedAt: new Date() }),
      ),
    ).toBe("quotes_price_positive");
  });
});
