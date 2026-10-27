import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthResponse } from "@yuyufx/shared";
import { createApp } from "../src/app.js";
import { createUser } from "../src/api/auth/users.js";
import { sessions } from "../src/db/schema.js";
import type { LogFields } from "../src/log.js";
import { createTestDatabase, type TestDatabase } from "./helpers/test-db.js";

// Integration tests for F1 (login and session): AC1.1, AC1.2, AC1.3, plus CSRF,
// logout and idle timeout. Runs the real Express app against a throwaway schema.

const WEB_ORIGIN = "http://127.0.0.1:5173";
const USERNAME = "alice-test";
const PASSWORD = "correct horse battery staple";
const IDLE_MINUTES = 30;

let testDb: TestDatabase;
let server: Server;
let baseUrl: string;
let clockMs: number;
let logs: { event: string; fields: LogFields }[];

beforeAll(async () => {
  testDb = await createTestDatabase();
  await createUser(testDb.db, USERNAME, PASSWORD);
});

afterAll(async () => {
  await testDb.cleanup();
});

// A fresh app per test, so the in-memory rate limiter starts empty each time.
beforeEach(async () => {
  clockMs = Date.parse("2026-10-27T12:00:00Z");
  logs = [];
  const app = createApp({
    db: testDb.db,
    config: {
      SESSION_SECRET: "test-secret-".padEnd(48, "x"),
      SESSION_IDLE_MINUTES: IDLE_MINUTES,
      WEB_ORIGIN,
      PAPER_STARTING_CASH: "100000",
      MARKET_DATA_SYMBOLS: [],
    },
    now: () => new Date(clockMs),
    log: (event, fields = {}) => logs.push({ event, fields }),
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

const minutes = (n: number) => n * 60 * 1000;

interface CallOptions {
  method?: string;
  body?: unknown;
  rawBody?: string;
  cookie?: string;
  csrf?: string;
  /** Defaults to the dashboard origin on non-GET requests; null sends none. */
  origin?: string | null;
}

async function call(path: string, options: CallOptions = {}) {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {};
  const origin = options.origin === undefined && method !== "GET" ? WEB_ORIGIN : options.origin;
  if (origin) headers.origin = origin;
  if (options.cookie) headers.cookie = options.cookie;
  if (options.csrf) headers["x-csrf-token"] = options.csrf;
  let body: string | undefined;
  if (options.rawBody !== undefined || options.body !== undefined) {
    headers["content-type"] = "application/json";
    body = options.rawBody ?? JSON.stringify(options.body);
  }
  const res = await fetch(baseUrl + path, { method, headers, ...(body ? { body } : {}) });
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    setCookies: res.headers.getSetCookie(),
    json: text ? (JSON.parse(text) as unknown) : undefined,
  };
}

async function login(username = USERNAME, password = PASSWORD, cookie?: string) {
  const res = await call("/api/auth/login", {
    method: "POST",
    body: { username, password },
    ...(cookie ? { cookie } : {}),
  });
  const setCookie = res.setCookies[0] ?? "";
  return { res, cookie: setCookie.split(";")[0] ?? "", setCookie, body: res.json as AuthResponse };
}

describe("AC1.1: logged-out requests to the API get 401", () => {
  it("GET /api/auth/me without a cookie", async () => {
    const res = await call("/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: "Unauthorized" });
  });

  it("any other /api route (even unknown ones) is 401, not 404", async () => {
    expect((await call("/api/positions")).status).toBe(401);
    expect((await call("/api/orders", { method: "POST", body: {} })).status).toBe(401);
  });

  it("a made-up session cookie is rejected and cleared", async () => {
    const res = await call("/api/auth/me", { cookie: "yuyufx_session=not-a-real-token" });
    expect(res.status).toBe(401);
    expect(res.setCookies.join()).toMatch(/yuyufx_session=;/);
  });

  it("/health stays public", async () => {
    expect((await call("/health")).status).toBe(200);
  });
});

describe("AC1.2: valid credentials start a session", () => {
  it("logs in, sets a safe cookie, and /me returns the user", async () => {
    const { res, cookie, setCookie, body } = await login();
    expect(res.status).toBe(200);
    expect(body.user.username).toBe(USERNAME);
    expect(body.csrfToken).toMatch(/^[\w-]{43}$/);

    expect(setCookie).toMatch(/^yuyufx_session=[\w-]{43};/);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).not.toContain("Secure"); // plain http origin (see sessionCookieOptions)

    const me = await call("/api/auth/me", { cookie });
    expect(me.status).toBe(200);
    expect(me.json).toEqual(body);
  });

  it("usernames are case-insensitive", async () => {
    const { res } = await login("  ALICE-Test ");
    expect(res.status).toBe(200);
  });

  it("the database stores a hash of the token, not the token itself", async () => {
    const { cookie, body } = await login();
    const token = cookie.split("=")[1] ?? "";
    const rows = await testDb.db
      .select()
      .from(sessions)
      .where(eq(sessions.csrfToken, body.csrfToken));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).not.toBe(token);
    expect(rows[0]?.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("each login issues a new session and ends the browser's old one", async () => {
    const first = await login();
    const second = await login(USERNAME, PASSWORD, first.cookie);
    expect(second.cookie).not.toBe(first.cookie);
    expect((await call("/api/auth/me", { cookie: first.cookie })).status).toBe(401);
    expect((await call("/api/auth/me", { cookie: second.cookie })).status).toBe(200);
  });

  it("a wrong password fails with a generic message and no cookie", async () => {
    const { res } = await login(USERNAME, "wrong password");
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: "Invalid username or password" });
    expect(res.setCookies).toHaveLength(0);
  });

  it("an unknown username gets exactly the same answer", async () => {
    const { res } = await login("nobody-here", "whatever password");
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: "Invalid username or password" });
  });

  it("a missing or malformed body is a 400", async () => {
    expect((await call("/api/auth/login", { method: "POST", body: {} })).status).toBe(400);
    expect((await call("/api/auth/login", { method: "POST", rawBody: "{oops" })).status).toBe(400);
  });

  it("logs success and failure without the password", async () => {
    await login(USERNAME, "wrong password");
    await login();
    expect(logs.map((l) => l.event)).toEqual(["auth.login.failure", "auth.login.success"]);
    expect(logs[0]?.fields).toMatchObject({ username: USERNAME, reason: "wrong_password" });
    const all = JSON.stringify(logs);
    expect(all).not.toContain(PASSWORD);
    expect(all).not.toContain("wrong password");
  });
});

describe("AC1.3: repeated bad logins are rate-limited", () => {
  it("blocks the 6th attempt within 15 minutes, even with the right password", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await login(USERNAME, `wrong ${i}`)).res.status).toBe(401);
    }
    const blocked = await login();
    expect(blocked.res.status).toBe(429);
    expect(blocked.res.headers.get("retry-after")).toBe("900");
    expect(blocked.res.setCookies).toHaveLength(0);
    expect(logs.at(-1)?.event).toBe("auth.login.blocked");
  });

  it("allows attempts again once the 15-minute window has passed", async () => {
    for (let i = 0; i < 5; i++) await login(USERNAME, `wrong ${i}`);
    clockMs += minutes(15);
    expect((await login()).res.status).toBe(200);
  });

  it("a successful login resets the counter", async () => {
    for (let i = 0; i < 4; i++) await login(USERNAME, `wrong ${i}`);
    expect((await login()).res.status).toBe(200);
    for (let i = 0; i < 4; i++) await login(USERNAME, `wrong ${i}`);
    expect((await login()).res.status).toBe(200);
  });

  it("counts per username, so other usernames are not blocked", async () => {
    for (let i = 0; i < 5; i++) await login(USERNAME, `wrong ${i}`);
    expect((await login("someone-else", "x")).res.status).toBe(401);
  });
});

describe("CSRF protection", () => {
  it("rejects a login with no Origin header", async () => {
    const res = await call("/api/auth/login", {
      method: "POST",
      body: { username: USERNAME, password: PASSWORD },
      origin: null,
    });
    expect(res.status).toBe(403);
  });

  it("rejects a login from another site's origin", async () => {
    const res = await call("/api/auth/login", {
      method: "POST",
      body: { username: USERNAME, password: PASSWORD },
      origin: "https://evil.example",
    });
    expect(res.status).toBe(403);
  });

  it("rejects a logged-in POST without the CSRF token, or with a wrong one", async () => {
    const { cookie } = await login();
    expect((await call("/api/auth/logout", { method: "POST", cookie })).status).toBe(403);
    expect(
      (await call("/api/auth/logout", { method: "POST", cookie, csrf: "x".repeat(43) })).status,
    ).toBe(403);
    // The session survived the rejected requests.
    expect((await call("/api/auth/me", { cookie })).status).toBe(200);
  });

  it("CORS only ever allows the dashboard origin", async () => {
    const res = await call("/health", { origin: "https://evil.example" });
    expect(res.headers.get("access-control-allow-origin")).toBe(WEB_ORIGIN);
  });

  it("sends Helmet security headers", async () => {
    const res = await call("/health");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBeTruthy();
  });
});

describe("logout and idle timeout", () => {
  it("logout ends the session", async () => {
    const { cookie, body } = await login();
    const res = await call("/api/auth/logout", { method: "POST", cookie, csrf: body.csrfToken });
    expect(res.status).toBe(204);
    expect(res.setCookies.join()).toMatch(/yuyufx_session=;/);
    expect((await call("/api/auth/me", { cookie })).status).toBe(401);
    expect(logs.at(-1)?.event).toBe("auth.logout");
  });

  it(`logs out after ${IDLE_MINUTES} idle minutes`, async () => {
    const { cookie } = await login();
    clockMs += minutes(IDLE_MINUTES);
    expect((await call("/api/auth/me", { cookie })).status).toBe(401);
  });

  it("activity keeps the session alive", async () => {
    const { cookie } = await login();
    for (let i = 0; i < 3; i++) {
      clockMs += minutes(20);
      expect((await call("/api/auth/me", { cookie })).status).toBe(200);
    }
  });
});
