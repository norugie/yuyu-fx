import type { Side } from "@yuyufx/shared";
import { divRound, times, type Units } from "../money.js";

// Positions and P&L from fills, as pure functions (task 3.5).
//
// Average-cost method: a position's cost basis is what you paid for the shares
// you still hold. Buying adds to it; selling removes the sold shares' share of
// it, at the average cost. The difference between the sale price and that
// average is *realised* P&L (locked in). For shares still held, the difference
// between today's price and the average cost is *unrealised* P&L (on paper only).
// Fees are tracked separately and always reduce cash.

export interface TradeFill {
  symbol: string;
  side: Side;
  quantity: number;
  price: Units;
  fee: Units;
}

export interface PositionState {
  symbol: string;
  /** Shares held; negative would be a short (blocked for now, but the math handles it). */
  quantity: number;
  /** Total cost of the shares held (exact). */
  costBasis: Units;
  realizedPnl: Units;
  fees: Units;
}

export interface Book {
  cash: Units;
  positions: Map<string, PositionState>;
}

/**
 * The cost of `part` of `total` shares. Rounded toward zero, so any rounding
 * leftover stays in the basis and is released when the position fully closes.
 */
function costShare(costBasis: Units, part: number, total: number): Units {
  return divRound(costBasis * BigInt(part), BigInt(total), costBasis >= 0n ? "down" : "up");
}

/** Apply one fill to a position. Pure: returns a new state. */
export function applyFill(position: PositionState, fill: TradeFill): PositionState {
  const signed = fill.side === "buy" ? fill.quantity : -fill.quantity;
  const next = { ...position, fees: position.fees + fill.fee };
  const sameDirection = position.quantity === 0 || Math.sign(position.quantity) === Math.sign(signed);

  if (sameDirection) {
    // Opening or adding: the cost basis grows by what was paid (or received, for a short).
    next.quantity = position.quantity + signed;
    next.costBasis = position.costBasis + times(fill.price, signed);
    return next;
  }

  // Reducing (or flipping through zero).
  const closing = Math.min(Math.abs(signed), Math.abs(position.quantity));
  const removedCost =
    closing === Math.abs(position.quantity)
      ? position.costBasis // closing everything: take all of it, so totals stay exact
      : costShare(position.costBasis, closing, Math.abs(position.quantity));
  // Selling a long brings cash in (+); buying back a short pays it out (-).
  const proceeds = times(fill.price, closing) * BigInt(Math.sign(position.quantity));
  next.realizedPnl = position.realizedPnl + proceeds - removedCost;
  next.quantity = position.quantity + Math.sign(signed) * closing;
  next.costBasis = position.costBasis - removedCost;

  const opening = Math.abs(signed) - closing;
  if (opening > 0) {
    // Flipped: the rest opens a new position the other way at this price.
    next.quantity = Math.sign(signed) * opening;
    next.costBasis = times(fill.price, next.quantity);
  }
  return next;
}

export function emptyPosition(symbol: string): PositionState {
  return { symbol, quantity: 0, costBasis: 0n, realizedPnl: 0n, fees: 0n };
}

/** Replay fills (oldest first) from a starting cash balance. */
export function buildBook(startingCash: Units, fills: Iterable<TradeFill>): Book {
  const positions = new Map<string, PositionState>();
  let cash = startingCash;
  for (const fill of fills) {
    const notional = times(fill.price, fill.quantity);
    cash += fill.side === "buy" ? -notional : notional;
    cash -= fill.fee;
    positions.set(fill.symbol, applyFill(positions.get(fill.symbol) ?? emptyPosition(fill.symbol), fill));
  }
  return { cash, positions };
}

/** Average cost per share (rounded to 4 decimals), or null when flat. */
export function averageCost(position: PositionState): Units | null {
  if (position.quantity === 0) return null;
  // Long: positive cost / positive shares. Short: negative / negative. Either way a positive price.
  const cost = position.costBasis < 0n ? -position.costBasis : position.costBasis;
  return divRound(cost, BigInt(Math.abs(position.quantity)), "up");
}

/** Market value and unrealised P&L at `price` (no price: valued at cost, so 0 unrealised). */
export function markToMarket(position: PositionState, price: Units | null) {
  const marketValue = price === null ? position.costBasis : times(price, position.quantity);
  return { marketValue, unrealizedPnl: marketValue - position.costBasis };
}

/** Cash plus the market value of every position. */
export function equity(book: Book, priceOf: (symbol: string) => Units | null): Units {
  let total = book.cash;
  for (const position of book.positions.values()) {
    total += markToMarket(position, priceOf(position.symbol)).marketValue;
  }
  return total;
}
