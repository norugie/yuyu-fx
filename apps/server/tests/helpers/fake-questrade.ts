import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// A stand-in for Questrade's API, with responses shaped like the documented ones.
// Refresh tokens are single-use, like the real thing: using one returns a new one
// and the old one stops working.

export interface FakeBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface FakeQuestrade {
  baseUrl: string;
  /** Refresh tokens that will be accepted (each works once). */
  validRefreshTokens: Set<string>;
  /** Every request path the fake received (query strings with tokens are redacted). */
  calls: string[];
  quotes: Map<number, { lastTradePrice: number | null; delay: number }>;
  candles: Map<number, FakeBar[]>;
  /** Next N market-data calls answer 429. */
  rateLimitNext: number;
  /** Next N market-data calls answer 500. */
  failNext: number;
  tokenExchanges: number;
  close(): Promise<void>;
}

export const SYMBOLS = [
  { symbol: "XIU.TO", symbolId: 11, description: "iShares S&P/TSX 60 Index ETF", listingExchange: "TSX", currency: "CAD" },
  { symbol: "RY.TO", symbolId: 22, description: "Royal Bank of Canada", listingExchange: "TSX", currency: "CAD" },
  { symbol: "RY", symbolId: 23, description: "Royal Bank of Canada (NYSE)", listingExchange: "NYSE", currency: "USD" },
];

export async function startFakeQuestrade(initialRefreshToken = "bootstrap-token-1"): Promise<FakeQuestrade> {
  let accessToken = "";
  let n = 0;
  const fake: Omit<FakeQuestrade, "baseUrl" | "close"> = {
    validRefreshTokens: new Set([initialRefreshToken]),
    calls: [],
    quotes: new Map(),
    candles: new Map(),
    rateLimitNext: 0,
    failNext: 0,
    tokenExchanges: 0,
  };

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://fake");
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    fake.calls.push(url.pathname);

    if (url.pathname === "/oauth2/token") {
      const token = url.searchParams.get("refresh_token") ?? "";
      if (url.searchParams.get("grant_type") !== "refresh_token" || !fake.validRefreshTokens.has(token)) {
        send(400, { error: "invalid_grant" });
        return;
      }
      fake.validRefreshTokens.delete(token); // single use
      n += 1;
      fake.tokenExchanges += 1;
      const next = `rotated-token-${n}`;
      fake.validRefreshTokens.add(next);
      accessToken = `access-${n}`;
      send(200, {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 1800,
        refresh_token: next,
        api_server: `${baseUrl}/`,
      });
      return;
    }

    if (req.headers.authorization !== `Bearer ${accessToken}` || !accessToken) {
      send(401, { code: 1017, message: "Access token is invalid" });
      return;
    }
    if (fake.rateLimitNext > 0) {
      fake.rateLimitNext -= 1;
      send(429, { code: 1006, message: "Rate limit exceeded" }, { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "0" });
      return;
    }
    if (fake.failNext > 0) {
      fake.failNext -= 1;
      send(500, { code: 1000, message: "Internal error" });
      return;
    }

    if (url.pathname === "/v1/symbols/search") {
      const prefix = (url.searchParams.get("prefix") ?? "").toUpperCase();
      send(200, { symbols: SYMBOLS.filter((s) => s.symbol.startsWith(prefix.replace(".TO", ""))) });
      return;
    }
    const quote = /^\/v1\/markets\/quotes\/(\d+)$/.exec(url.pathname);
    if (quote) {
      const id = Number(quote[1]);
      const q = fake.quotes.get(id);
      send(200, {
        quotes: q
          ? [{ symbol: "X", symbolId: id, lastTradePrice: q.lastTradePrice, bidPrice: null, askPrice: null, delay: q.delay, isHalted: false, lastTradeTime: "2026-10-27T10:00:00.000000-04:00" }]
          : [],
      });
      return;
    }
    const candles = /^\/v1\/markets\/candles\/(\d+)$/.exec(url.pathname);
    if (candles) {
      if (url.searchParams.get("interval") !== "OneDay") {
        send(400, { message: "bad interval" });
        return;
      }
      const start = (url.searchParams.get("startTime") ?? "").slice(0, 10);
      const end = (url.searchParams.get("endTime") ?? "").slice(0, 10);
      const bars = (fake.candles.get(Number(candles[1])) ?? []).filter((b) => b.date >= start && b.date < end);
      send(200, {
        candles: bars.map((b) => ({
          start: `${b.date}T00:00:00.000000-04:00`,
          end: `${b.date}T23:59:59.000000-04:00`,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume,
          VWAP: b.close,
        })),
      });
      return;
    }
    send(404, { message: "not found" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return Object.assign(fake, {
    baseUrl,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  });
}

/** Weekday-only synthetic daily bars, a gentle random walk with a fixed seed. */
export function syntheticBars(from: string, count: number, start = 30, seed = 1): FakeBar[] {
  let s = seed;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const bars: FakeBar[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  let close = start;
  while (bars.length < count) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) {
      const open = Math.round(close * (1 + (rand() - 0.5) * 0.01) * 100) / 100;
      close = Math.round(open * (1 + (rand() - 0.48) * 0.02) * 100) / 100;
      const high = Math.round(Math.max(open, close) * (1 + rand() * 0.005) * 100) / 100;
      const low = Math.round(Math.min(open, close) * (1 - rand() * 0.005) * 100) / 100;
      bars.push({ date: d.toISOString().slice(0, 10), open, high, low, close, volume: Math.round(1e6 * (0.5 + rand())) });
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return bars;
}
