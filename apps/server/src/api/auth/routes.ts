import { eq } from "drizzle-orm";
import { Router, type Request } from "express";
import { z } from "zod";
import type { ApiError, AuthResponse } from "@yuyufx/shared";
import type { Database } from "../../db/client.js";
import { users } from "../../db/schema.js";
import type { Logger } from "../../log.js";
import { readCookie } from "./cookies.js";
import {
  normalizeUsername,
  PASSWORD_MAX_LENGTH,
  verifyAgainstDummy,
  verifyPassword,
} from "./credentials.js";
import type { LoginLimiter } from "./rate-limit.js";
import {
  createSession,
  deleteSession,
  SESSION_COOKIE,
  sessionCookieOptions,
  type SessionSettings,
} from "./sessions.js";

export interface AuthRouteDeps {
  db: Database;
  settings: SessionSettings;
  webOrigin: string;
  limiter: LoginLimiter;
  now: () => Date;
  log: Logger;
}

const loginBody = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

const invalidCredentials: ApiError = { error: "Invalid username or password" };

function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

/** POST /api/auth/login. Public (no session needed). */
export function loginRouter(deps: AuthRouteDeps): Router {
  const router = Router();
  const cookieOptions = sessionCookieOptions(deps.webOrigin);

  router.post("/auth/login", async (req, res) => {
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) {
      const body: ApiError = { error: "Username and password are required" };
      res.status(400).json(body);
      return;
    }

    const username = normalizeUsername(parsed.data.username);
    const ip = clientIp(req);
    const limitKey = `${ip}|${username}`;
    const nowMs = deps.now().getTime();

    const limit = deps.limiter.check(limitKey, nowMs);
    if (!limit.allowed) {
      deps.log("auth.login.blocked", { username, ip });
      res.set("Retry-After", String(Math.ceil(limit.retryAfterMs / 1000)));
      const body: ApiError = { error: "Too many failed attempts. Try again later." };
      res.status(429).json(body);
      return;
    }

    const [user] = await deps.db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    let ok = false;
    if (user) {
      ok = await verifyPassword(user.passwordHash, parsed.data.password);
    } else {
      await verifyAgainstDummy(parsed.data.password);
    }

    if (!user || !ok) {
      deps.limiter.recordFailure(limitKey, nowMs);
      deps.log("auth.login.failure", {
        username,
        ip,
        reason: user ? "wrong_password" : "unknown_user",
      });
      res.status(401).json(invalidCredentials);
      return;
    }

    deps.limiter.reset(limitKey);

    // Drop any session this browser already had, then issue a brand-new one.
    const oldToken = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (oldToken) await deleteSession(deps.db, oldToken, deps.settings.secret);

    const session = await createSession(deps.db, user.id, deps.settings, deps.now());
    res.cookie(SESSION_COOKIE, session.token, cookieOptions);
    deps.log("auth.login.success", { username, userId: user.id, ip });

    const body: AuthResponse = {
      user: { id: user.id, username: user.username },
      csrfToken: session.csrfToken,
    };
    res.json(body);
  });

  return router;
}

/** GET /api/auth/me and POST /api/auth/logout. Mounted after requireAuth. */
export function sessionRouter(deps: AuthRouteDeps): Router {
  const router = Router();
  const cookieOptions = sessionCookieOptions(deps.webOrigin);

  router.get("/auth/me", (_req, res) => {
    const auth = res.locals.auth;
    if (!auth) throw new Error("requireAuth must run before sessionRouter");
    const body: AuthResponse = {
      user: { id: auth.userId, username: auth.username },
      csrfToken: auth.csrfToken,
    };
    res.json(body);
  });

  router.post("/auth/logout", async (req, res) => {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (token) await deleteSession(deps.db, token, deps.settings.secret);
    res.clearCookie(SESSION_COOKIE, cookieOptions);
    deps.log("auth.logout", { username: res.locals.auth?.username, ip: clientIp(req) });
    res.status(204).end();
  });

  return router;
}
