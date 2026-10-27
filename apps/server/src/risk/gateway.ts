import { and, count, eq, gte, inArray, max } from "drizzle-orm";
import {
  newOrderSchema,
  type KillSwitchResult,
  type NewOrder,
  type OrderSource,
  type RiskSettings,
  type RiskStatus,
  type TradingModeValue,
} from "@yuyufx/shared";
import type { CostModel } from "../broker/fill-rules.js";
import type { Broker } from "../broker/simulated.js";
import { exchangeDate, isStale, type PriceSource } from "../data/price-source.js";
import type { Database } from "../db/client.js";
import { dailyBars, orders, type Order } from "../db/schema.js";
import type { Logger } from "../log.js";
import { fromUnits, maxUnits, times, toUnits, type Units } from "../money.js";
import { toOrderView, type PlaceOutcome } from "../orders/service.js";
import { loadPortfolio } from "../portfolio/service.js";
import { evaluateGuards } from "./guards.js";
import { checkOrder, type RuleFailure } from "./rules.js";
import { loadRiskSettings, loadTradingState, saveRiskSettings, saveTradingState } from "./store.js";

// The order gateway (PRD AC5.4): the ONLY code that may call broker.place.
// Every order (manual, rules or AI) comes here, gets its context loaded, passes
// the risk rules, and only then reaches the broker. Refusals are stored with the
// rule that refused them, so the history and logs explain every "no".

export interface GatewayDeps {
  db: Database;
  broker: Broker;
  /** Fetches fresh prices when it can (Questrade), else stored ones. */
  prices: PriceSource;
  costs: CostModel;
  startingCash: Units;
  mode: TradingModeValue;
  /** Symbols whose daily bars must be current for automation to run (and the default whitelist). */
  marketDataSymbols: readonly string[];
  now: () => Date;
  log: Logger;
}

export interface OrderGateway {
  place(userId: string, input: unknown, source: OrderSource): Promise<PlaceOutcome>;
  cancel(userId: string, orderId: string): Promise<Order[]>;
  status(userId: string): Promise<RiskStatus>;
  killSwitch(userId: string, flatten: boolean): Promise<KillSwitchResult>;
  /** Clear the kill switch and the drawdown halt (the route checks the password first). */
  resume(userId: string): Promise<RiskStatus>;
  updateSettings(userId: string, changes: Partial<RiskSettings>): Promise<RiskStatus>;
}

/** Bars older than this many calendar days mean the daily sync isn't running. */
const BARS_STALE_AFTER_DAYS = 4;

export function createOrderGateway(deps: GatewayDeps): OrderGateway {
  const settingsOf = (userId: string) => loadRiskSettings(deps.db, userId, deps.marketDataSymbols);

  async function staleDataSymbols(today: string): Promise<string[]> {
    if (deps.marketDataSymbols.length === 0) return [];
    const rows = await deps.db
      .select({ symbol: dailyBars.symbol, last: max(dailyBars.date) })
      .from(dailyBars)
      .where(inArray(dailyBars.symbol, [...deps.marketDataSymbols]))
      .groupBy(dailyBars.symbol);
    const cutoff = new Date(`${today}T00:00:00Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - BARS_STALE_AFTER_DAYS);
    const fresh = new Set(rows.filter((r) => r.last && r.last >= cutoff.toISOString().slice(0, 10)).map((r) => r.symbol));
    return deps.marketDataSymbols.filter((s) => !fresh.has(s));
  }

  /** Equity, guards and halts; stores the updated peak and any new halt. */
  async function accountState(userId: string, settings: RiskSettings) {
    const now = deps.now();
    const today = exchangeDate(now);
    const portfolio = await loadPortfolio(deps.db, userId, now, deps.startingCash);
    const equity = toUnits(portfolio.equity);
    const todayPnl = toUnits(portfolio.todayPnl);
    const previous = await loadTradingState(deps.db, userId);
    const guards = evaluateGuards({
      settings,
      state: previous,
      equity,
      equityAtOpen: equity - todayPnl,
      today,
      now,
      staleDataSymbols: await staleDataSymbols(today),
    });
    const changed = JSON.stringify(guards.state) !== JSON.stringify(previous);
    if (changed) {
      await saveTradingState(deps.db, userId, guards.state);
      if (guards.state.dailyHaltDate !== previous.dailyHaltDate) deps.log("risk.halt.daily_loss", { userId, todayPnl: portfolio.todayPnl });
      if (guards.state.drawdownHaltedAt && !previous.drawdownHaltedAt) deps.log("risk.halt.drawdown", { userId, drawdown: guards.drawdown });
    }
    return { portfolio, equity, todayPnl, guards };
  }

  /** Shares and cash already promised to the user's open orders. */
  async function reservations(userId: string, symbol: string, quote: Units | null) {
    const open = await deps.db.select().from(orders).where(and(eq(orders.userId, userId), eq(orders.status, "open")));
    const parentIds = [...new Set(open.flatMap((o) => (o.parentId ? [o.parentId] : [])))];
    const filledEntries = new Set(
      parentIds.length === 0
        ? []
        : (await deps.db.select({ id: orders.id }).from(orders).where(and(inArray(orders.id, parentIds), eq(orders.status, "filled")))).map((r) => r.id),
    );
    let sellShares = 0;
    let buyCash = 0n;
    const pendingEntrySymbols = new Set<string>();
    for (const o of open) {
      // Exits of a bracket whose entry hasn't filled don't touch holdings or cash yet.
      if (o.parentId && !filledEntries.has(o.parentId)) continue;
      if (o.side === "sell" && o.symbol === symbol) sellShares += o.quantity;
      if (o.side === "buy") {
        const p = o.limitPrice ?? o.stopPrice;
        buyCash += times(p ? toUnits(p) : (quote ?? 0n), o.quantity) + deps.costs.minFee;
        if (!o.parentId) pendingEntrySymbols.add(o.symbol);
      }
    }
    return { sellShares, buyCash, pendingEntrySymbols };
  }

  async function recordRejected(userId: string, source: OrderSource, order: NewOrder, failure: RuleFailure): Promise<Order> {
    const [row] = await deps.db
      .insert(orders)
      .values({
        userId,
        source,
        mode: deps.mode,
        symbol: order.symbol,
        side: order.side,
        type: order.type === "bracket" ? order.entry : order.type,
        quantity: order.quantity,
        limitPrice: "limitPrice" in order ? (order.limitPrice ?? null) : null,
        bracketRole: order.type === "bracket" ? "entry" : null,
        status: "rejected",
        statusReason: failure.reason,
        createdAt: deps.now(),
      })
      .returning();
    if (!row) throw new Error("Insert returned no row");
    return row;
  }

  async function buildStatus(userId: string): Promise<RiskStatus> {
    const settings = await settingsOf(userId);
    const { equity, todayPnl, guards } = await accountState(userId, settings);
    return {
      settings,
      automationAllowed: guards.halts.length === 0,
      halts: guards.halts,
      equity: fromUnits(equity),
      peakEquity: guards.state.peakEquity ?? fromUnits(equity),
      drawdown: guards.drawdown,
      todayPnl: fromUnits(todayPnl),
      dailyLossLimit: fromUnits(guards.dailyLossLimit),
      killSwitchActive: guards.state.killSwitchAt !== null,
    };
  }

  async function place(userId: string, input: unknown, source: OrderSource): Promise<PlaceOutcome> {
    const parsed = newOrderSchema.safeParse(input);
    if (!parsed.success) return { kind: "invalid", error: parsed.error.issues[0]?.message ?? "Invalid order" };
    const order = parsed.data;
    const now = deps.now();

    const settings = await settingsOf(userId);
    const latest = await deps.prices.latest(order.symbol);
    const quote = latest ? { price: toUnits(latest.price), stale: isStale(latest.quotedAt, now) } : null;
    const { portfolio, equity, guards } = await accountState(userId, settings);
    const reserved = await reservations(userId, order.symbol, quote?.price ?? null);
    const held = portfolio.openPositions.find((p) => p.symbol === order.symbol);
    const others = new Set([
      ...portfolio.openPositions.filter((p) => p.quantity !== 0).map((p) => p.symbol),
      ...reserved.pendingEntrySymbols,
    ]);
    others.delete(order.symbol);
    const [recent] = await deps.db
      .select({ n: count() })
      .from(orders)
      .where(and(eq(orders.userId, userId), gte(orders.createdAt, new Date(now.getTime() - 60_000))));

    const failure = checkOrder(order, {
      source,
      mode: deps.mode,
      settings,
      halts: guards.halts,
      quote,
      equity,
      availableCash: maxUnits(toUnits(portfolio.cash) - reserved.buyCash, 0n),
      sellableQuantity: (held?.quantity ?? 0) - reserved.sellShares,
      heldValue: held ? toUnits(held.marketValue) : 0n,
      otherOpenPositions: others.size,
      ordersLastMinute: recent?.n ?? 0,
      costs: deps.costs,
    });

    if (failure) {
      const row = await recordRejected(userId, source, order, failure);
      deps.log("order.reject", { orderId: row.id, rule: failure.rule, reason: failure.reason, symbol: order.symbol, side: order.side, type: order.type, source });
      return { kind: "rejected", reason: failure.reason, order: toOrderView(row, undefined) };
    }

    const result = await deps.broker.place({ userId, source, order });
    const fillByOrder = new Map(result.fills.map((f) => [f.orderId, f]));
    return { kind: "placed", orders: result.orders.map((o) => toOrderView(o, fillByOrder.get(o.id))) };
  }

  return {
    place,
    cancel: (userId, orderId) => deps.broker.cancel(userId, orderId),
    status: buildStatus,

    async killSwitch(userId, flatten) {
      const state = await loadTradingState(deps.db, userId);
      await saveTradingState(deps.db, userId, { ...state, killSwitchAt: deps.now() });

      // Cancel every open order (entries first; their bracket exits go with them).
      const open = await deps.db.select().from(orders).where(and(eq(orders.userId, userId), eq(orders.status, "open")));
      let cancelledOrders = 0;
      for (const o of [...open].sort((a, b) => Number(a.parentId !== null) - Number(b.parentId !== null))) {
        try {
          cancelledOrders += (await deps.broker.cancel(userId, o.id)).length;
        } catch {
          // Already cancelled along with its entry.
        }
      }

      const flattened: string[] = [];
      const notFlattened: KillSwitchResult["notFlattened"] = [];
      if (flatten) {
        const portfolio = await loadPortfolio(deps.db, userId, deps.now(), deps.startingCash);
        for (const p of portfolio.openPositions.filter((x) => x.quantity > 0)) {
          // Selling what you hold passes the rules if there's a fresh price (fail closed otherwise).
          const outcome = await place(userId, { symbol: p.symbol, side: "sell", quantity: p.quantity, type: "market" }, "manual");
          if (outcome.kind === "placed") flattened.push(p.symbol);
          else notFlattened.push({ symbol: p.symbol, reason: outcome.kind === "rejected" ? outcome.reason : outcome.error });
        }
      }
      deps.log("risk.kill_switch", { userId, cancelledOrders, flatten, flattened: flattened.length, notFlattened: notFlattened.length });
      return { cancelledOrders, flattened, notFlattened };
    },

    async resume(userId) {
      const state = await loadTradingState(deps.db, userId);
      // The daily-loss halt still lasts until tomorrow; the peak restarts from today's equity.
      await saveTradingState(deps.db, userId, { ...state, killSwitchAt: null, drawdownHaltedAt: null, peakEquity: null });
      deps.log("risk.resume", { userId });
      return buildStatus(userId);
    },

    async updateSettings(userId, changes) {
      const current = await settingsOf(userId);
      const next = { ...current, ...changes };
      await saveRiskSettings(deps.db, userId, next);
      deps.log("risk.settings.changed", { userId, keys: Object.keys(changes).join(",") });
      return buildStatus(userId);
    },
  };
}
