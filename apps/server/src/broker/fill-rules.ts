import type { BracketRole, Side, StoredOrderType } from "@yuyufx/shared";
import { maxUnits, minUnits, roundToTick, shiftByBps, times, toUnits, type Units } from "../money.js";

// The simulated broker's rules, as pure functions: given the open orders for one
// symbol and a new price, which orders fill, at what price, with what fee, and
// which get cancelled. No database, no clock, so every case is easy to test.

/** Costs of trading, applied to every simulated fill. */
export interface CostModel {
  /** Market and stop fills are this many basis points worse than the quote. */
  slippageBps: number;
  /** Commission per share, with a minimum and a cap (as % of the trade value, in bps). */
  feePerShare: Units;
  minFee: Units;
  maxFeeBps: number;
}

/**
 * Defaults modelled on IBKR Canada's fixed pricing for stocks (CAD 0.01/share,
 * min CAD 1.00, max 0.5% of trade value) plus 5 bp of slippage. Charging costs
 * keeps paper results from looking better than real trading would.
 */
export const DEFAULT_COSTS: CostModel = {
  slippageBps: 5,
  feePerShare: toUnits("0.01"),
  minFee: toUnits("1.00"),
  maxFeeBps: 50,
};

export interface SimOrder {
  id: string;
  side: Side;
  type: StoredOrderType;
  quantity: number;
  limitPrice: Units | null;
  stopPrice: Units | null;
  parentId: string | null;
  bracketRole: BracketRole | null;
}

export interface SimFill {
  orderId: string;
  price: Units;
  quantity: number;
  fee: Units;
}

export interface SimCancel {
  orderId: string;
  reason: string;
}

export interface Evaluation {
  fills: SimFill[];
  cancels: SimCancel[];
}

/** TSX tick size: $0.01 at $0.50 and above, $0.005 below. */
export function tickSize(price: Units): Units {
  return price >= toUnits("0.50") ? toUnits("0.01") : toUnits("0.005");
}

/** Price you actually get on a market (or triggered stop) order: worse than the quote. */
export function marketFillPrice(quote: Units, side: Side, costs: CostModel): Units {
  const direction = side === "buy" ? "up" : "down";
  const slipped = shiftByBps(quote, costs.slippageBps, direction);
  return roundToTick(slipped, tickSize(quote), direction);
}

export function commission(price: Units, quantity: number, costs: CostModel): Units {
  const perShare = times(costs.feePerShare, quantity);
  const cap = (times(price, quantity) * BigInt(costs.maxFeeBps)) / 10_000n;
  return minUnits(maxUnits(perShare, costs.minFee), maxUnits(cap, 0n));
}

/** Fill price if this order executes at `quote`, or null if it doesn't trigger. */
export function triggerPrice(order: SimOrder, quote: Units, costs: CostModel): Units | null {
  switch (order.type) {
    case "market":
      return marketFillPrice(quote, order.side, costs);
    case "limit": {
      if (order.limitPrice === null) return null;
      // A limit order fills at the quote when the quote is at the limit or better.
      const reached = order.side === "buy" ? quote <= order.limitPrice : quote >= order.limitPrice;
      return reached ? quote : null;
    }
    case "stop": {
      if (order.stopPrice === null) return null;
      // A stop becomes a market order once the price crosses it (so gaps hurt).
      const hit = order.side === "sell" ? quote <= order.stopPrice : quote >= order.stopPrice;
      return hit ? marketFillPrice(quote, order.side, costs) : null;
    }
  }
}

const ROLE_NAMES: Record<BracketRole, string> = {
  entry: "entry",
  stop_loss: "stop-loss",
  take_profit: "take-profit",
};

/**
 * Evaluate all open orders for one symbol at a new price.
 * `filledParents` lists entries that filled earlier (so their exits are active).
 * Entries and stand-alone orders go first, then bracket exits, so an exit can
 * fill in the same step as its entry if the price is already past it.
 */
export function evaluate(
  openOrders: SimOrder[],
  quote: Units,
  costs: CostModel,
  filledParents: ReadonlySet<string> = new Set(),
): Evaluation {
  const fills: SimFill[] = [];
  const cancels: SimCancel[] = [];
  const filled = new Set(filledParents);
  const done = new Set<string>();

  const fill = (order: SimOrder, price: Units) => {
    fills.push({ orderId: order.id, price, quantity: order.quantity, fee: commission(price, order.quantity, costs) });
    filled.add(order.id);
    done.add(order.id);
  };

  for (const order of openOrders.filter((o) => o.parentId === null)) {
    const price = triggerPrice(order, quote, costs);
    if (price !== null) fill(order, price);
  }

  for (const order of openOrders.filter((o) => o.parentId !== null)) {
    if (done.has(order.id) || !filled.has(order.parentId ?? "")) continue; // exit not active yet
    const price = triggerPrice(order, quote, costs);
    if (price === null) continue;
    fill(order, price);
    // One-cancels-other: the sibling exit is no longer needed.
    for (const sibling of openOrders) {
      if (sibling.parentId === order.parentId && sibling.id !== order.id && !done.has(sibling.id)) {
        done.add(sibling.id);
        cancels.push({
          orderId: sibling.id,
          reason: `Cancelled: ${ROLE_NAMES[order.bracketRole ?? "entry"]} filled`,
        });
      }
    }
  }

  return { fills, cancels };
}
