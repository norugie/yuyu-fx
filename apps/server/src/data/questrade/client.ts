import type { z } from "zod";
import type { Logger } from "../../log.js";
import { exchangeDate, EXCHANGE_TIME_ZONE } from "../price-source.js";
import { candlesSchema, quotesSchema, symbolSearchSchema, tokenResponseSchema } from "./schemas.js";
import { fingerprint, type TokenStore } from "./token-store.js";

// Read-only Questrade API client (PRD F10). Market data only: no order endpoints exist here.
//
// Auth: a refresh token is exchanged for a short-lived access token AND a new
// refresh token; the old refresh token stops working. So the new one is saved
// (encrypted) before anything else. The .env token only starts the chain.
// Security: the refresh token travels in the token URL (Questrade's design), so
// URLs and tokens are never logged or put in error messages.

export const QUESTRADE_LOGIN_URL = "https://login.questrade.com";

export class QuestradeNotConfiguredError extends Error {
  override name = "QuestradeNotConfiguredError";
}
export class QuestradeAuthError extends Error {
  override name = "QuestradeAuthError";
}
export class QuestradeApiError extends Error {
  override name = "QuestradeApiError";
  constructor(
    readonly status: number,
    readonly endpoint: string,
  ) {
    super(`Questrade ${endpoint} failed with HTTP ${status}`);
  }
}

export interface QuestradeClientDeps {
  store: TokenStore;
  /** QUESTRADE_REFRESH_TOKEN from .env, if set. */
  envRefreshToken?: string | undefined;
  loginUrl?: string;
  fetch?: typeof fetch;
  log: Logger;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Minimum gap between calls (Questrade allows 20 market-data calls per second). */
  minIntervalMs?: number;
}

export interface QuestradeSymbol {
  symbol: string;
  symbolId: number;
  description: string | null;
  currency: string | null;
}

export interface QuestradeQuote {
  price: number;
  /** Minutes behind real time, as reported by Questrade. */
  delayMinutes: number;
  lastTradeTime: string | null;
}

export interface QuestradeCandle {
  /** Exchange calendar date, YYYY-MM-DD. */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface QuestradeClient {
  findSymbol(symbol: string): Promise<QuestradeSymbol>;
  quote(symbolId: number): Promise<QuestradeQuote>;
  dailyCandles(symbolId: number, from: string, to: string): Promise<QuestradeCandle[]>;
}

/** Our TSX ticker -> Questrade's ("XIU" -> "XIU.TO", "BBD.B" -> "BBD.B.TO"). */
export const toQuestradeSymbol = (symbol: string) => `${symbol.toUpperCase()}.TO`;

/** Midnight at the start of a calendar date in exchange time, as ISO 8601 with offset. */
export function exchangeMidnight(day: string, timeZone = EXCHANGE_TIME_ZONE): string {
  // Find the UTC offset that applies at noon that day (avoids DST edge cases at midnight).
  const noon = new Date(`${day}T12:00:00Z`);
  const offsetName =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
      .formatToParts(noon)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const offset = offsetName === "GMT" ? "+00:00" : offsetName.replace("GMT", "");
  return `${day}T00:00:00${offset}`;
}

const MAX_DAYS_PER_CANDLE_REQUEST = 5 * 365; // Questrade returns at most 2000 candles per call

function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function createQuestradeClient(deps: QuestradeClientDeps): QuestradeClient {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const loginUrl = deps.loginUrl ?? QUESTRADE_LOGIN_URL;
  const minInterval = deps.minIntervalMs ?? 60;

  interface Session {
    accessToken: string;
    apiServer: string;
    expiresAt: number;
  }
  let session: Session | null = null;
  let refreshing: Promise<Session> | null = null;
  let lastCallAt = 0;

  async function refresh(retryWithStored = true): Promise<Session> {
    const stored = await deps.store.load();
    const envToken = deps.envRefreshToken;
    const envHash = envToken ? fingerprint(envToken) : null;

    // A .env token we haven't used yet wins (Youmu pasted a new one); otherwise the stored chain.
    let token: string;
    let bootstrapHash: string | null;
    if (envToken && envHash !== stored?.bootstrapHash) {
      token = envToken;
      bootstrapHash = envHash;
    } else if (stored) {
      token = stored.refreshToken;
      bootstrapHash = stored.bootstrapHash;
    } else {
      throw new QuestradeNotConfiguredError("Questrade isn't set up: put QUESTRADE_REFRESH_TOKEN in .env");
    }

    const url = `${loginUrl}/oauth2/token?grant_type=refresh_token&refresh_token=${encodeURIComponent(token)}`;
    const res = await doFetch(url, { method: "GET" });
    if (res.status === 400 || res.status === 401) {
      // Another process (e.g. the sync CLI next to the server) may have used this token
      // a moment ago and saved a newer one. Try that once; never loop on a dead token.
      const latest = await deps.store.load();
      if (retryWithStored && latest && latest.refreshToken !== token && (!envToken || fingerprint(envToken) === latest.bootstrapHash)) {
        return refresh(false);
      }
      throw new QuestradeAuthError(
        "Questrade rejected the refresh token. Generate a new one in the Questrade API app and put it in QUESTRADE_REFRESH_TOKEN.",
      );
    }
    if (!res.ok) throw new QuestradeApiError(res.status, "token");
    const parsed = tokenResponseSchema.safeParse(await res.json());
    if (!parsed.success) throw new QuestradeApiError(res.status, "token (unexpected response)");

    // Save the new refresh token first: the one we just used no longer works.
    try {
      await deps.store.save({ refreshToken: parsed.data.refresh_token, bootstrapHash });
    } catch {
      throw new QuestradeAuthError(
        "Questrade issued a new refresh token but it couldn't be saved (database error). The old one is used up: generate a new token in the Questrade API app and put it in QUESTRADE_REFRESH_TOKEN.",
      );
    }
    deps.log("questrade.token.refreshed", { expiresIn: parsed.data.expires_in });

    const apiServer = parsed.data.api_server.endsWith("/") ? parsed.data.api_server : `${parsed.data.api_server}/`;
    return {
      accessToken: parsed.data.access_token,
      apiServer,
      // Renew a minute early so a request never goes out with an expiring token.
      expiresAt: now() + (parsed.data.expires_in - 60) * 1000,
    };
  }

  async function getSession(): Promise<Session> {
    if (session && session.expiresAt > now()) return session;
    // One refresh at a time: two parallel refreshes would burn the single-use token.
    refreshing ??= refresh().finally(() => {
      refreshing = null;
    });
    const fresh = await refreshing;
    session = fresh;
    return fresh;
  }

  async function get<S extends z.ZodType>(path: string, schema: S, endpoint: string): Promise<z.infer<S>> {
    for (let attempt = 0; ; attempt++) {
      const wait = lastCallAt + minInterval - now();
      if (wait > 0) await sleep(wait);
      lastCallAt = now();

      const current = await getSession();
      const res = await doFetch(current.apiServer + path, { headers: { Authorization: `Bearer ${current.accessToken}` } });

      if (res.status === 401 && attempt === 0) {
        session = null; // access token expired early: refresh once and retry
        continue;
      }
      if (res.status === 429 && attempt < 3) {
        // Rate limited (AC10.4): wait until the window resets (max 60 s), then retry.
        const reset = Number(res.headers.get("x-ratelimit-reset"));
        const waitMs = Number.isFinite(reset) && reset > 0 ? Math.min(60_000, Math.max(1_000, reset * 1000 - now())) : 1_000;
        deps.log("questrade.rate_limited", { endpoint, waitMs });
        await sleep(waitMs);
        continue;
      }
      if (!res.ok) throw new QuestradeApiError(res.status, endpoint);
      const parsed = schema.safeParse(await res.json());
      if (!parsed.success) throw new QuestradeApiError(res.status, `${endpoint} (unexpected response)`);
      return parsed.data;
    }
  }

  return {
    async findSymbol(symbol) {
      const wanted = toQuestradeSymbol(symbol);
      const data = await get(`v1/symbols/search?prefix=${encodeURIComponent(wanted)}`, symbolSearchSchema, "symbols/search");
      const match = data.symbols.find(
        (s) => s.symbol.toUpperCase() === wanted && (s.listingExchange ?? "TSX").toUpperCase() === "TSX",
      );
      if (!match) throw new QuestradeApiError(404, `symbols/search (${symbol} not found on TSX)`);
      return {
        symbol: match.symbol,
        symbolId: match.symbolId,
        description: match.description ?? null,
        currency: match.currency ?? null,
      };
    },

    async quote(symbolId) {
      const data = await get(`v1/markets/quotes/${symbolId}`, quotesSchema, "markets/quotes");
      const q = data.quotes[0];
      const price = q?.lastTradePrice;
      if (!q || price === null || price === undefined || !(price > 0)) {
        throw new QuestradeApiError(200, "markets/quotes (no last trade price)");
      }
      return { price, delayMinutes: q.delay ?? 0, lastTradeTime: q.lastTradeTime ?? null };
    },

    async dailyCandles(symbolId, from, to) {
      const out: QuestradeCandle[] = [];
      for (let start = from; start <= to; start = addDays(start, MAX_DAYS_PER_CANDLE_REQUEST)) {
        const endDay = [addDays(start, MAX_DAYS_PER_CANDLE_REQUEST - 1), to].sort()[0] ?? to;
        const query =
          `startTime=${encodeURIComponent(exchangeMidnight(start))}` +
          `&endTime=${encodeURIComponent(exchangeMidnight(addDays(endDay, 1)))}&interval=OneDay`;
        const data = await get(`v1/markets/candles/${symbolId}?${query}`, candlesSchema, "markets/candles");
        for (const c of data.candles) {
          // "2026-10-26T00:00:00.000000-04:00" -> the exchange date it opens on.
          const date = /^\d{4}-\d{2}-\d{2}/.test(c.start) ? c.start.slice(0, 10) : exchangeDate(new Date(c.start));
          if (date >= from && date <= to) out.push({ date, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
        }
      }
      return out;
    },
  };
}

/** A price from JSON (a float) as an exact 4-decimal string, rejecting nonsense. */
export function priceToDecimal(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value >= 1e10) throw new Error(`Bad price from Questrade: ${value}`);
  return value.toFixed(4);
}
