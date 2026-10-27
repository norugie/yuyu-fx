import { Router } from "express";
import { setQuoteSchema, symbolSchema, type ApiError, type QuoteView } from "@yuyufx/shared";
import type { ManualPriceSource } from "../data/manual-quotes.js";
import { toQuoteView, type PriceSource } from "../data/price-source.js";
import type { Logger } from "../log.js";

export interface QuoteRouteDeps {
  /** Where typed-in prices are recorded. */
  store: ManualPriceSource;
  /** Where prices are read (Questrade first when configured, then the store). */
  prices: PriceSource;
  /** Called after a new price is stored, so resting orders can fill. */
  onPrice: (symbol: string) => Promise<unknown>;
  now: () => Date;
  log: Logger;
}

/** POST /api/quotes and GET /api/quotes/:symbol. Mounted after requireAuth. */
export function quotesRouter(deps: QuoteRouteDeps): Router {
  const router = Router();

  router.post("/quotes", async (req, res) => {
    const parsed = setQuoteSchema.safeParse(req.body);
    if (!parsed.success) {
      const body: ApiError = { error: parsed.error.issues[0]?.message ?? "Invalid quote" };
      res.status(400).json(body);
      return;
    }
    const auth = res.locals.auth;
    if (!auth) throw new Error("requireAuth must run before quotesRouter");

    const now = deps.now();
    const quote = await deps.store.record({ ...parsed.data, enteredBy: auth.userId, at: now });
    deps.log("quote.set", { symbol: quote.symbol, price: quote.price, source: quote.source, username: auth.username });
    await deps.onPrice(quote.symbol);
    const body: QuoteView = toQuoteView(quote, now);
    res.status(201).json(body);
  });

  router.get("/quotes/:symbol", async (req, res) => {
    const symbol = symbolSchema.safeParse(req.params.symbol);
    if (!symbol.success) {
      const body: ApiError = { error: symbol.error.issues[0]?.message ?? "Invalid symbol" };
      res.status(400).json(body);
      return;
    }
    const quote = await deps.prices.latest(symbol.data);
    if (!quote) {
      const body: ApiError = { error: `No price for ${symbol.data} yet` };
      res.status(404).json(body);
      return;
    }
    const body: QuoteView = toQuoteView(quote, deps.now());
    res.json(body);
  });

  return router;
}
