import { eq } from "drizzle-orm";
import { Router } from "express";
import { killSwitchSchema, resumeSchema, updateRiskSettingsSchema, type ApiError, type KillSwitchResult, type RiskStatus } from "@yuyufx/shared";
import type { Database } from "../db/client.js";
import { users } from "../db/schema.js";
import type { Logger } from "../log.js";
import type { OrderGateway } from "../risk/gateway.js";
import { verifyPassword } from "./auth/credentials.js";
import { createLoginLimiter } from "./auth/rate-limit.js";

// Risk status, limits, kill switch and resume (PRD F5). Mounted after requireAuth.
// Changing limits or re-enabling automation asks for the password again
// (ARCHITECTURE §9, AC5.6), with its own attempt limit. The kill switch doesn't:
// in an emergency it must be one click (plus a confirmation in the UI).

export interface RiskRouteDeps {
  db: Database;
  gateway: OrderGateway;
  now: () => Date;
  log: Logger;
}

export function riskRouter(deps: RiskRouteDeps): Router {
  const router = Router();
  const reauthLimiter = createLoginLimiter();

  const auth = (locals: Express.Locals) => {
    if (!locals.auth) throw new Error("requireAuth must run before riskRouter");
    return locals.auth;
  };

  /** True if the password is right; answers 400/403/429 itself otherwise. */
  async function checkPassword(userId: string, password: string, res: import("express").Response): Promise<boolean> {
    const nowMs = deps.now().getTime();
    const limit = reauthLimiter.check(userId, nowMs);
    if (!limit.allowed) {
      res.set("Retry-After", String(Math.ceil(limit.retryAfterMs / 1000)));
      const body: ApiError = { error: "Too many wrong passwords. Try again later." };
      res.status(429).json(body);
      return false;
    }
    const [user] = await deps.db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, userId));
    if (!user || !(await verifyPassword(user.hash, password))) {
      reauthLimiter.recordFailure(userId, nowMs);
      deps.log("risk.reauth.failure", { userId });
      const body: ApiError = { error: "Wrong password" };
      res.status(403).json(body);
      return false;
    }
    reauthLimiter.reset(userId);
    return true;
  }

  router.get("/risk", async (_req, res) => {
    const body: RiskStatus = await deps.gateway.status(auth(res.locals).userId);
    res.json(body);
  });

  router.put("/risk/settings", async (req, res) => {
    const parsed = updateRiskSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      const body: ApiError = { error: parsed.error.issues[0]?.message ?? "Invalid settings" };
      res.status(400).json(body);
      return;
    }
    const { userId } = auth(res.locals);
    if (!(await checkPassword(userId, parsed.data.password, res))) return;
    const body: RiskStatus = await deps.gateway.updateSettings(userId, parsed.data.settings);
    res.json(body);
  });

  router.post("/risk/kill-switch", async (req, res) => {
    const parsed = killSwitchSchema.safeParse(req.body);
    if (!parsed.success) {
      const body: ApiError = { error: "Say whether to also sell all positions (flatten: true or false)" };
      res.status(400).json(body);
      return;
    }
    const body: KillSwitchResult = await deps.gateway.killSwitch(auth(res.locals).userId, parsed.data.flatten);
    res.json(body);
  });

  router.post("/risk/resume", async (req, res) => {
    const parsed = resumeSchema.safeParse(req.body);
    if (!parsed.success) {
      const body: ApiError = { error: "Password is required" };
      res.status(400).json(body);
      return;
    }
    const { userId } = auth(res.locals);
    if (!(await checkPassword(userId, parsed.data.password, res))) return;
    const body: RiskStatus = await deps.gateway.resume(userId);
    res.json(body);
  });

  return router;
}
