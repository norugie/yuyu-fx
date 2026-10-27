import { asc, eq, inArray } from "drizzle-orm";
import type { PortfolioView, PositionView } from "@yuyufx/shared";
import type { Database } from "../db/client.js";
import { fills, quotes, type Fill } from "../db/schema.js";
import { exchangeDate } from "../data/price-source.js";
import { fromUnits, toUnits, type Units } from "../money.js";
import { averageCost, buildBook, equity, markToMarket, type Book, type TradeFill } from "./positions.js";

// Loads fills and prices from the database and turns them into the portfolio view.

function toTrade(fill: Fill): TradeFill {
  return {
    symbol: fill.symbol,
    side: fill.side,
    quantity: fill.quantity,
    price: toUnits(fill.price),
    fee: toUnits(fill.fee),
  };
}

async function userFills(db: Database, userId: string): Promise<Fill[]> {
  return db.select().from(fills).where(eq(fills.userId, userId)).orderBy(asc(fills.filledAt), asc(fills.id));
}

/** Cash and positions right now. */
export async function loadBook(db: Database, userId: string, startingCash: Units): Promise<Book> {
  return buildBook(startingCash, (await userFills(db, userId)).map(toTrade));
}

interface PriceHistory {
  /** Latest price and its time, per symbol. */
  latest: Map<string, { price: Units; quotedAt: Date }>;
  /** Latest price from before today (exchange time), per symbol. */
  beforeToday: Map<string, Units>;
}

async function priceHistory(db: Database, symbols: string[], now: Date): Promise<PriceHistory> {
  const latest: PriceHistory["latest"] = new Map();
  const beforeToday: PriceHistory["beforeToday"] = new Map();
  if (symbols.length === 0) return { latest, beforeToday };
  const today = exchangeDate(now);
  const rows = await db
    .select({ symbol: quotes.symbol, price: quotes.price, quotedAt: quotes.quotedAt })
    .from(quotes)
    .where(inArray(quotes.symbol, symbols))
    .orderBy(asc(quotes.quotedAt), asc(quotes.id));
  for (const row of rows) {
    if (row.quotedAt > now) continue;
    const price = toUnits(row.price);
    latest.set(row.symbol, { price, quotedAt: row.quotedAt });
    if (exchangeDate(row.quotedAt) < today) beforeToday.set(row.symbol, price);
  }
  return { latest, beforeToday };
}

export async function loadPortfolio(
  db: Database,
  userId: string,
  now: Date,
  startingCash: Units,
): Promise<PortfolioView> {
  const all = await userFills(db, userId);
  const today = exchangeDate(now);
  const book = buildBook(startingCash, all.map(toTrade));
  // The book as it stood when today began, to measure today's change.
  const startOfDay = buildBook(
    startingCash,
    all.filter((f) => exchangeDate(f.filledAt) < today).map(toTrade),
  );
  const prices = await priceHistory(db, [...book.positions.keys()], now);

  const equityNow = equity(book, (s) => prices.latest.get(s)?.price ?? null);
  const equityAtOpen = equity(startOfDay, (s) => prices.beforeToday.get(s) ?? null);

  const openPositions: PositionView[] = [];
  let realized = 0n;
  let fees = 0n;
  for (const position of book.positions.values()) {
    realized += position.realizedPnl;
    fees += position.fees;
    if (position.quantity === 0) continue;
    const quote = prices.latest.get(position.symbol) ?? null;
    const { marketValue, unrealizedPnl } = markToMarket(position, quote?.price ?? null);
    openPositions.push({
      symbol: position.symbol,
      quantity: position.quantity,
      averageCost: fromUnits(averageCost(position) ?? 0n),
      costBasis: fromUnits(position.costBasis),
      lastPrice: quote ? fromUnits(quote.price) : null,
      priceStale: quote ? exchangeDate(quote.quotedAt) < today : true,
      marketValue: fromUnits(marketValue),
      unrealizedPnl: fromUnits(unrealizedPnl),
      realizedPnl: fromUnits(position.realizedPnl),
      fees: fromUnits(position.fees),
    });
  }
  openPositions.sort((a, b) => a.symbol.localeCompare(b.symbol));

  return {
    startingCash: fromUnits(startingCash),
    cash: fromUnits(book.cash),
    equity: fromUnits(equityNow),
    todayPnl: fromUnits(equityNow - equityAtOpen),
    realizedPnl: fromUnits(realized),
    fees: fromUnits(fees),
    openPositions,
  };
}
