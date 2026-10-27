import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import type { ApiError, HealthResponse } from "@yuyufx/shared";
import { requireAuth, requireSameOrigin } from "./api/auth/middleware.js";
import { createLoginLimiter, type LoginLimiter } from "./api/auth/rate-limit.js";
import { loginRouter, sessionRouter, type AuthRouteDeps } from "./api/auth/routes.js";
import { quotesRouter } from "./api/quotes.js";
import { ordersRouter } from "./api/orders.js";
import { riskRouter } from "./api/risk.js";
import { createOrderGateway, type OrderGateway } from "./risk/gateway.js";
import { DEFAULT_COSTS } from "./broker/fill-rules.js";
import { createSimulatedBroker } from "./broker/simulated.js";
import type { Config } from "./config.js";
import { createManualPriceSource } from "./data/manual-quotes.js";
import type { PriceSource } from "./data/price-source.js";
import type { QuestradeClient } from "./data/questrade/client.js";
import { createQuestradePriceSource } from "./data/questrade-prices.js";
import type { Database } from "./db/client.js";
import { consoleLogger, type Logger } from "./log.js";
import { toUnits } from "./money.js";

export interface AppDeps {
  db: Database;
  config: Pick<Config, "SESSION_SECRET" | "SESSION_IDLE_MINUTES" | "WEB_ORIGIN" | "PAPER_STARTING_CASH" | "MARKET_DATA_SYMBOLS">;
  /** Questrade market data. Without it, prices are typed in only. */
  questrade?: QuestradeClient;
  /** Injectable for tests. */
  limiter?: LoginLimiter;
  now?: () => Date;
  log?: Logger;
}

export interface TradingServices {
  /** Stored prices (typed-in and Questrade), read without network calls. */
  store: ReturnType<typeof createManualPriceSource>;
  broker: ReturnType<typeof createSimulatedBroker>;
  /** Questrade first when configured, then the stored price. */
  prices: PriceSource;
  /** The only path to the broker for new orders (risk checks). */
  gateway: OrderGateway;
}

/** The price and broker objects, shared by the API and the background quote poller. */
export function createTradingServices(deps: AppDeps): TradingServices {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? consoleLogger;
  // The broker reads stored prices only (no network calls while filling orders).
  const store = createManualPriceSource(deps.db);
  const broker = createSimulatedBroker({ db: deps.db, prices: store, costs: DEFAULT_COSTS, now, log });
  const prices: PriceSource = deps.questrade
    ? createQuestradePriceSource({
        db: deps.db,
        client: deps.questrade,
        stored: store,
        now,
        log,
        onNewQuote: (symbol) => broker.onPrice(symbol),
      })
    : store;
  const gateway = createOrderGateway({
    db: deps.db,
    broker,
    prices,
    costs: DEFAULT_COSTS,
    startingCash: toUnits(deps.config.PAPER_STARTING_CASH),
    // Paper only. Live mode is a separate, explicit decision (PRD F8, AC8.1).
    mode: "paper",
    marketDataSymbols: deps.config.MARKET_DATA_SYMBOLS,
    now,
    log,
  });
  return { store, broker, prices, gateway };
}

/** Build the Express app (no listening here, so tests can use it directly). */
export function createApp(deps: AppDeps, services: TradingServices = createTradingServices(deps)): express.Express {
  const { config } = deps;
  const authDeps: AuthRouteDeps = {
    db: deps.db,
    settings: {
      secret: config.SESSION_SECRET,
      idleMs: config.SESSION_IDLE_MINUTES * 60 * 1000,
    },
    webOrigin: config.WEB_ORIGIN,
    limiter: deps.limiter ?? createLoginLimiter(),
    now: deps.now ?? (() => new Date()),
    log: deps.log ?? consoleLogger,
  };

  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  // Strict CORS: only the dashboard's origin may call the API from a browser.
  app.use(cors({ origin: config.WEB_ORIGIN, credentials: true }));

  app.get("/health", (_req, res) => {
    const body: HealthResponse = { status: "ok" };
    res.json(body);
  });

  app.use("/api", express.json({ limit: "10kb" }));
  app.use("/api", requireSameOrigin(config.WEB_ORIGIN));
  app.use("/api", loginRouter(authDeps));
  // Everything below needs a logged-in session.
  app.use("/api", requireAuth(authDeps.db, authDeps.settings, authDeps.webOrigin, authDeps.now));
  app.use("/api", sessionRouter(authDeps));
  const { store, broker, prices, gateway } = services;
  app.use(
    "/api",
    quotesRouter({ store, prices, onPrice: (symbol) => broker.onPrice(symbol), now: authDeps.now, log: authDeps.log }),
  );
  app.use(
    "/api",
    ordersRouter({ db: deps.db, gateway, startingCash: toUnits(config.PAPER_STARTING_CASH), now: authDeps.now }),
  );
  app.use("/api", riskRouter({ db: deps.db, gateway, now: authDeps.now, log: authDeps.log }));
  app.use("/api", (_req, res) => {
    const body: ApiError = { error: "Not found" };
    res.status(404).json(body);
  });

  const onError: ErrorRequestHandler = (error: unknown, req, res, _next) => {
    // Bad JSON from the client is their mistake, not a server error.
    const status =
      typeof error === "object" && error !== null && "status" in error && error.status === 400
        ? 400
        : 500;
    if (status === 500) {
      authDeps.log("http.error", {
        method: req.method,
        path: req.path,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    const body: ApiError = { error: status === 400 ? "Bad request" : "Internal server error" };
    res.status(status).json(body);
  };
  app.use(onError);

  return app;
}
