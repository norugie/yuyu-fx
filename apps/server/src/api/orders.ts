import { Router } from "express";
import { z } from "zod";
import type { ApiError, OrderRejectedResponse, PlaceOrderResponse, PortfolioView } from "@yuyufx/shared";
import { OrderNotCancellableError } from "../broker/simulated.js";
import type { Database } from "../db/client.js";
import type { Units } from "../money.js";
import { listOrders, toOrderView } from "../orders/service.js";
import { loadPortfolio } from "../portfolio/service.js";
import type { OrderGateway } from "../risk/gateway.js";

export interface OrdersRouteDeps {
  db: Database;
  /** The only way to place or cancel orders (risk checks included). */
  gateway: OrderGateway;
  startingCash: Units;
  now: () => Date;
}

/** Orders and portfolio routes. Mounted after requireAuth. */
export function ordersRouter(deps: OrdersRouteDeps): Router {
  const router = Router();

  const auth = (locals: Express.Locals) => {
    if (!locals.auth) throw new Error("requireAuth must run before ordersRouter");
    return locals.auth;
  };

  router.post("/orders", async (req, res) => {
    const outcome = await deps.gateway.place(auth(res.locals).userId, req.body, "manual");
    switch (outcome.kind) {
      case "invalid": {
        const body: ApiError = { error: outcome.error };
        res.status(400).json(body);
        return;
      }
      case "rejected": {
        const body: OrderRejectedResponse = { error: outcome.reason, order: outcome.order };
        res.status(422).json(body);
        return;
      }
      case "placed": {
        const body: PlaceOrderResponse = { orders: outcome.orders };
        res.status(201).json(body);
        return;
      }
    }
  });

  router.get("/orders", async (req, res) => {
    const limit = z.coerce.number().int().min(1).max(200).catch(50).parse(req.query.limit);
    res.json(await listOrders(deps.db, auth(res.locals).userId, limit));
  });

  router.post("/orders/:id/cancel", async (req, res) => {
    const id = z.uuid().safeParse(req.params.id);
    if (!id.success) {
      const body: ApiError = { error: "Order not found" };
      res.status(404).json(body);
      return;
    }
    try {
      const cancelled = await deps.gateway.cancel(auth(res.locals).userId, id.data);
      const body: PlaceOrderResponse = { orders: cancelled.map((o) => toOrderView(o, undefined)) };
      res.json(body);
    } catch (error) {
      if (!(error instanceof OrderNotCancellableError)) throw error;
      const body: ApiError = { error: error.message };
      res.status(error.message === "Order not found" ? 404 : 409).json(body);
    }
  });

  router.get("/portfolio", async (_req, res) => {
    const body: PortfolioView = await loadPortfolio(deps.db, auth(res.locals).userId, deps.now(), deps.startingCash);
    res.json(body);
  });

  return router;
}
