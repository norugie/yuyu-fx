import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import type { ApiError } from "@yuyufx/shared";
import type { Database } from "../../db/client.js";
import { readCookie } from "./cookies.js";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  validateSession,
  type AuthContext,
  type SessionSettings,
} from "./sessions.js";

// Express's own extension point for typing res.locals.
declare global {
  namespace Express {
    interface Locals {
      /** Set by requireAuth for logged-in requests. */
      auth?: AuthContext;
    }
  }
}

export const CSRF_HEADER = "x-csrf-token";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const forbidden: ApiError = { error: "Forbidden" };
const unauthorized: ApiError = { error: "Unauthorized" };

/**
 * CSRF layer 1, for every state-changing /api request (including login):
 * the browser's Origin header must be the dashboard's origin. Browsers always
 * send Origin on cross-site POSTs, and pages can't fake it.
 */
export function requireSameOrigin(webOrigin: string): RequestHandler {
  return (req, res, next) => {
    if (!UNSAFE_METHODS.has(req.method)) return next();
    if (req.get("origin") === webOrigin) return next();
    res.status(403).json(forbidden);
  };
}

function tokensMatch(expected: string, received: string | undefined): boolean {
  if (!received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Every /api route after this needs a valid session (401 otherwise).
 * CSRF layer 2: state-changing requests must also send the session's CSRF token
 * in the X-CSRF-Token header (synchronizer token pattern).
 */
export function requireAuth(
  db: Database,
  settings: SessionSettings,
  webOrigin: string,
  now: () => Date,
): RequestHandler {
  return async (req, res, next) => {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    const auth = token ? await validateSession(db, token, settings, now()) : null;
    if (!auth) {
      if (token) res.clearCookie(SESSION_COOKIE, sessionCookieOptions(webOrigin));
      res.status(401).json(unauthorized);
      return;
    }
    if (UNSAFE_METHODS.has(req.method) && !tokensMatch(auth.csrfToken, req.get(CSRF_HEADER))) {
      res.status(403).json(forbidden);
      return;
    }
    res.locals.auth = auth;
    next();
  };
}
