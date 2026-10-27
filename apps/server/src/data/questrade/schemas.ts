import { z } from "zod";

// Shapes of the Questrade responses we use (checked 2026-10-27 against
// questrade.com/api/documentation: authorization, symbols/search, markets/quotes,
// markets/candles). Unknown fields are ignored; missing required ones fail loudly.

export const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string(),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1),
  api_server: z.url(),
});

export const symbolSearchSchema = z.object({
  symbols: z.array(
    z.object({
      symbol: z.string(),
      symbolId: z.number().int(),
      description: z.string().nullish(),
      listingExchange: z.string().nullish(),
      currency: z.string().nullish(),
      isQuotable: z.boolean().nullish(),
    }),
  ),
});

export const quotesSchema = z.object({
  quotes: z.array(
    z.object({
      symbol: z.string(),
      symbolId: z.number().int(),
      lastTradePrice: z.number().nullish(),
      bidPrice: z.number().nullish(),
      askPrice: z.number().nullish(),
      lastTradeTime: z.string().nullish(),
      /** Minutes the quote is delayed (0 = real-time). */
      delay: z.number().nullish(),
      isHalted: z.boolean().nullish(),
    }),
  ),
});

export const candlesSchema = z.object({
  candles: z.array(
    z.object({
      start: z.string(),
      end: z.string(),
      open: z.number(),
      high: z.number(),
      low: z.number(),
      close: z.number(),
      volume: z.number(),
    }),
  ),
});
