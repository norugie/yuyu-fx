import type { QuoteSource, QuoteView } from "@yuyufx/shared";

// Where prices come from. Until Phase 4 the only source is "manual": Youmu types
// the price (PRD Q5, decision D1). A real market-data source implements the same
// interface later, so the broker, risk checks and UI don't change.

export interface LatestQuote {
  symbol: string;
  price: string;
  source: QuoteSource;
  quotedAt: Date;
}

export interface PriceSource {
  /** The most recent quote for a symbol, or null if there is none. */
  latest(symbol: string): Promise<LatestQuote | null>;
}

/** Exchange timezone for "is this price from today?". Becomes a setting with F9. */
export const EXCHANGE_TIME_ZONE = "America/Toronto";

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/** Calendar date (YYYY-MM-DD) of an instant in the given timezone. */
export function exchangeDate(instant: Date, timeZone = EXCHANGE_TIME_ZONE): string {
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) {
    // en-CA formats dates as YYYY-MM-DD.
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dayFormatters.set(timeZone, formatter);
  }
  return formatter.format(instant);
}

/**
 * A quote is stale when it is from an earlier calendar day (exchange time) than now.
 * Simple on purpose: there is no market calendar yet, so a Friday price is "stale"
 * on Saturday even though markets are closed. Refined when the calendar arrives.
 */
export function isStale(quotedAt: Date, now: Date, timeZone = EXCHANGE_TIME_ZONE): boolean {
  return exchangeDate(quotedAt, timeZone) < exchangeDate(now, timeZone);
}

export function toQuoteView(quote: LatestQuote, now: Date): QuoteView {
  return {
    symbol: quote.symbol,
    price: quote.price,
    source: quote.source,
    quotedAt: quote.quotedAt.toISOString(),
    stale: isStale(quote.quotedAt, now),
  };
}
