import { desc, eq, inArray } from "drizzle-orm";
import type { OrderView } from "@yuyufx/shared";
import type { Database } from "../db/client.js";
import { fills, orders, type Fill, type Order } from "../db/schema.js";

// Reading orders. Placing them goes through the risk gateway (src/risk/gateway.ts),
// the only path to the broker.

export type PlaceOutcome =
  | { kind: "invalid"; error: string }
  | { kind: "rejected"; reason: string; order: OrderView }
  | { kind: "placed"; orders: OrderView[] };

export function toOrderView(order: Order, fill: Fill | undefined): OrderView {
  return {
    id: order.id,
    symbol: order.symbol,
    side: order.side,
    type: order.type,
    bracketRole: order.bracketRole,
    parentId: order.parentId,
    quantity: order.quantity,
    limitPrice: order.limitPrice,
    stopPrice: order.stopPrice,
    status: order.status,
    statusReason: order.statusReason,
    source: order.source,
    mode: order.mode,
    createdAt: order.createdAt.toISOString(),
    fill: fill ? { price: fill.price, fee: fill.fee, filledAt: fill.filledAt.toISOString() } : null,
  };
}

/** Most recent orders first, each with its fill if it has one. */
export async function listOrders(db: Database, userId: string, limit: number): Promise<OrderView[]> {
  const rows = await db.select().from(orders).where(eq(orders.userId, userId)).orderBy(desc(orders.createdAt), desc(orders.id)).limit(limit);
  if (rows.length === 0) return [];
  const fillRows = await db.select().from(fills).where(inArray(fills.orderId, rows.map((r) => r.id)));
  const fillByOrder = new Map(fillRows.map((f) => [f.orderId, f]));
  return rows.map((r) => toOrderView(r, fillByOrder.get(r.id)));
}
