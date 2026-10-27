import { createHmac, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { CookieOptions } from "express";
import type { Database } from "../../db/client.js";
import { sessions, users } from "../../db/schema.js";

export const SESSION_COOKIE = "yuyufx_session";

// Only push expiry forward if the last bump was more than this long ago,
// so every request doesn't write to the database.
const TOUCH_INTERVAL_MS = 60 * 1000;

export interface SessionSettings {
  secret: string;
  idleMs: number;
}

export interface AuthContext {
  userId: string;
  username: string;
  csrfToken: string;
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What we store as the session id: HMAC-SHA256 of the cookie token. */
export function hashSessionToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}

/**
 * Cookie flags. httpOnly: page scripts can't read it. SameSite=Strict: the browser
 * won't send it on requests started by other sites. Secure only when the dashboard
 * is served over https: on plain http://127.0.0.1 some browsers (e.g. Safari) drop
 * Secure cookies, which would make login impossible locally.
 */
export function sessionCookieOptions(webOrigin: string): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: new URL(webOrigin).protocol === "https:",
    path: "/",
  };
}

/** Start a new session. A fresh token on every login prevents session fixation. */
export async function createSession(
  db: Database,
  userId: string,
  settings: SessionSettings,
  now: Date,
): Promise<{ token: string; csrfToken: string }> {
  const token = randomToken();
  const csrfToken = randomToken();
  await db.insert(sessions).values({
    id: hashSessionToken(token, settings.secret),
    userId,
    csrfToken,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + settings.idleMs),
  });
  return { token, csrfToken };
}

/** Look up the session for a cookie token. Expired sessions are deleted and return null. */
export async function validateSession(
  db: Database,
  token: string,
  settings: SessionSettings,
  now: Date,
): Promise<AuthContext | null> {
  const id = hashSessionToken(token, settings.secret);
  const [row] = await db
    .select({
      userId: sessions.userId,
      csrfToken: sessions.csrfToken,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
      username: users.username,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .limit(1);

  if (!row) return null;

  if (row.expiresAt.getTime() <= now.getTime()) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }

  if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db
      .update(sessions)
      .set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + settings.idleMs) })
      .where(eq(sessions.id, id));
  }

  return { userId: row.userId, username: row.username, csrfToken: row.csrfToken };
}

export async function deleteSession(db: Database, token: string, secret: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashSessionToken(token, secret)));
}
