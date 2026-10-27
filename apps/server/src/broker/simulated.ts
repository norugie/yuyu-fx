import { and, asc, eq, inArray } from "drizzle-orm";
import type { NewOrder, OrderSource } from "@yuyufx/shared";
import type { Database } from "../db/client.js";
import { fills, orders, type Fill, type Order } from "../db/schema.js";
import type { PriceSource } from "../data/price-source.js";
import type { Logger } from "../log.js";
import { fromUnits, toUnits } from "../money.js";
import { DEFAULT_COSTS, evaluate, type CostModel, type SimOrder } from "./fill-rules.js";

// The `simulated` broker (ARCHITECTURE §5): paper trading on typed-in prices.
// Orders are stored first, then checked against the latest price. Resting
// orders (limits, stops, bracket exits) are checked again whenever a new price
// arrives. Each step runs in one database transaction, with the symbol's open
// orders locked, so a fill can't happen twice.

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface PlaceRequest {
  userId: string;
  source: OrderSource;
  order: NewOrder;
}

export interface BrokerResult {
  /** The order(s) created, after any immediate fills (a bracket is 3 rows). */
  orders: Order[];
  fills: Fill[];
}

export class OrderNotCancellableError extends Error {
  override name = "OrderNotCancellableError";
}

export interface Broker {
  place(request: PlaceRequest): Promise<BrokerResult>;
  cancel(userId: string, orderId: string): Promise<Order[]>;
  /** A new price arrived for `symbol`: fill whatever it triggers. */
  onPrice(symbol: string): Promise<Fill[]>;
}

export interface SimulatedBrokerDeps {
  db: Database;
  prices: PriceSource;
  now: () => Date;
  log: Logger;
  costs?: CostModel;
}

function toSim(order: Order): SimOrder {
  return {
    id: order.id,
    side: order.side,
    type: order.type,
    quantity: order.quantity,
    limitPrice: order.limitPrice === null ? null : toUnits(order.limitPrice),
    stopPrice: order.stopPrice === null ? null : toUnits(order.stopPrice),
    parentId: order.parentId,
    bracketRole: order.bracketRole,
  };
}

/** Rows to insert for one request. Bracket exits are on the opposite side of the entry. */
function orderRows(request: PlaceRequest, now: Date) {
  const { order, userId, source } = request;
  // createdAt from the app clock (not the database's), so time-based rules use one clock.
  const common = { userId, source, mode: "paper" as const, symbol: order.symbol, quantity: order.quantity, status: "open" as const, createdAt: now };
  switch (order.type) {
    case "market":
      return { entry: { ...common, side: order.side, type: "market" as const }, exits: null };
    case "limit":
      return { entry: { ...common, side: order.side, type: "limit" as const, limitPrice: order.limitPrice }, exits: null };
    case "bracket": {
      const exitSide = order.side === "buy" ? ("sell" as const) : ("buy" as const);
      return {
        entry: {
          ...common,
          side: order.side,
          type: order.entry,
          limitPrice: order.entry === "limit" ? (order.limitPrice ?? null) : null,
          bracketRole: "entry" as const,
        },
        exits: [
          { ...common, side: exitSide, type: "stop" as const, stopPrice: order.stopLossPrice, bracketRole: "stop_loss" as const },
          { ...common, side: exitSide, type: "limit" as const, limitPrice: order.takeProfitPrice, bracketRole: "take_profit" as const },
        ],
      };
    }
  }
}

export function createSimulatedBroker(deps: SimulatedBrokerDeps): Broker {
  const costs = deps.costs ?? DEFAULT_COSTS;

  async function evaluateSymbol(tx: Tx, symbol: string): Promise<Fill[]> {
    const quote = await deps.prices.latest(symbol);
    if (!quote) return [];

    const open = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.symbol, symbol), eq(orders.status, "open"), eq(orders.mode, "paper")))
      .orderBy(asc(orders.createdAt))
      .for("update");
    if (open.length === 0) return [];

    const parentIds = [...new Set(open.flatMap((o) => (o.parentId ? [o.parentId] : [])))];
    const filledParents = new Set(
      parentIds.length === 0
        ? []
        : (
            await tx
              .select({ id: orders.id })
              .from(orders)
              .where(and(inArray(orders.id, parentIds), eq(orders.status, "filled")))
          ).map((r) => r.id),
    );

    const result = evaluate(open.map(toSim), toUnits(quote.price), costs, filledParents);
    const byId = new Map(open.map((o) => [o.id, o]));
    const now = deps.now();
    const created: Fill[] = [];

    for (const f of result.fills) {
      const order = byId.get(f.orderId);
      if (!order) continue;
      const [row] = await tx
        .insert(fills)
        .values({
          orderId: order.id,
          userId: order.userId,
          symbol: order.symbol,
          side: order.side,
          quantity: f.quantity,
          price: fromUnits(f.price),
          fee: fromUnits(f.fee),
          filledAt: now,
        })
        .returning();
      await tx.update(orders).set({ status: "filled" }).where(eq(orders.id, order.id));
      if (row) {
        created.push(row);
        deps.log("order.fill", {
          orderId: order.id,
          symbol: order.symbol,
          side: order.side,
          quantity: row.quantity,
          price: row.price,
          fee: row.fee,
        });
      }
    }
    for (const c of result.cancels) {
      await tx.update(orders).set({ status: "cancelled", statusReason: c.reason }).where(eq(orders.id, c.orderId));
      deps.log("order.cancel", { orderId: c.orderId, reason: c.reason });
    }
    return created;
  }

  async function reload(tx: Tx, ids: string[]): Promise<Order[]> {
    const rows = await tx.select().from(orders).where(inArray(orders.id, ids));
    return ids.flatMap((id) => rows.filter((r) => r.id === id));
  }

  return {
    async place(request) {
      return deps.db.transaction(async (tx) => {
        const rows = orderRows(request, deps.now());
        const [entry] = await tx.insert(orders).values(rows.entry).returning();
        if (!entry) throw new Error("Insert returned no row");
        const ids = [entry.id];
        if (rows.exits) {
          const exits = await tx
            .insert(orders)
            .values(rows.exits.map((exit) => ({ ...exit, parentId: entry.id })))
            .returning({ id: orders.id });
          ids.push(...exits.map((e) => e.id));
        }
        deps.log("order.place", {
          orderId: entry.id,
          symbol: entry.symbol,
          side: entry.side,
          type: request.order.type,
          quantity: entry.quantity,
          source: request.source,
        });
        const newFills = await evaluateSymbol(tx, entry.symbol);
        return { orders: await reload(tx, ids), fills: newFills.filter((f) => ids.includes(f.orderId)) };
      });
    },

    async cancel(userId, orderId) {
      return deps.db.transaction(async (tx) => {
        const [order] = await tx
          .select()
          .from(orders)
          .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
          .for("update");
        if (!order) throw new OrderNotCancellableError("Order not found");
        if (order.status !== "open") throw new OrderNotCancellableError(`Order is already ${order.status}`);

        await tx.update(orders).set({ status: "cancelled", statusReason: "Cancelled by you" }).where(eq(orders.id, order.id));
        // Cancelling an entry also cancels its bracket exits.
        const children = await tx
          .update(orders)
          .set({ status: "cancelled", statusReason: "Cancelled: entry cancelled" })
          .where(and(eq(orders.parentId, order.id), eq(orders.status, "open")))
          .returning({ id: orders.id });
        deps.log("order.cancel", { orderId: order.id, reason: "Cancelled by you", children: children.length });
        return reload(tx, [order.id, ...children.map((c) => c.id)]);
      });
    },

    async onPrice(symbol) {
      return deps.db.transaction((tx) => evaluateSymbol(tx, symbol));
    },
  };
}
