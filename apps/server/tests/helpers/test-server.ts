import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { AuthResponse } from "@yuyufx/shared";
import { createApp, createTradingServices, type AppDeps, type TradingServices } from "../../src/app.js";
import type { Database } from "../../src/db/client.js";
import type { LogFields } from "../../src/log.js";

// Starts the real Express app on a random port, with a controllable clock and
// captured logs, plus small fetch helpers that behave like the dashboard.

export const WEB_ORIGIN = "http://127.0.0.1:5173";

export interface CallOptions {
  method?: string;
  body?: unknown;
  cookie?: string;
  csrf?: string;
  /** Defaults to the dashboard origin on non-GET requests; null sends none. */
  origin?: string | null;
}

export interface TestServer {
  clock: { ms: number };
  logs: { event: string; fields: LogFields }[];
  call(path: string, options?: CallOptions): Promise<{ status: number; json: unknown }>;
  /** Log in and return the cookie + CSRF token to use on later calls. */
  login(username: string, password: string): Promise<{ cookie: string; csrf: string }>;
  close(): Promise<void>;
}

export async function startTestServer(
  db: Database,
  startAt = "2026-10-27T15:00:00Z",
  extra: Pick<AppDeps, "questrade"> = {},
): Promise<TestServer & { services: TradingServices }> {
  const clock = { ms: Date.parse(startAt) };
  const logs: TestServer["logs"] = [];
  const deps: AppDeps = {
    ...extra,
    db,
    config: {
      SESSION_SECRET: "test-secret-".padEnd(48, "x"),
      SESSION_IDLE_MINUTES: 30,
      WEB_ORIGIN,
      PAPER_STARTING_CASH: "100000",
      MARKET_DATA_SYMBOLS: [],
    },
    now: () => new Date(clock.ms),
    log: (event, fields = {}) => logs.push({ event, fields }),
  };
  const services = createTradingServices(deps);
  const app = createApp(deps, services);
  const server: Server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function call(path: string, options: CallOptions = {}) {
    const method = options.method ?? "GET";
    const headers: Record<string, string> = {};
    const origin = options.origin === undefined && method !== "GET" ? WEB_ORIGIN : options.origin;
    if (origin) headers.origin = origin;
    if (options.cookie) headers.cookie = options.cookie;
    if (options.csrf) headers["x-csrf-token"] = options.csrf;
    let body: string | undefined;
    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(options.body);
    }
    const res = await fetch(baseUrl + path, { method, headers, ...(body ? { body } : {}) });
    const text = await res.text();
    return { status: res.status, json: text ? (JSON.parse(text) as unknown) : undefined };
  }

  async function login(username: string, password: string) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { origin: WEB_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
    const cookie = (res.headers.getSetCookie()[0] ?? "").split(";")[0] ?? "";
    const { csrfToken } = (await res.json()) as AuthResponse;
    return { cookie, csrf: csrfToken };
  }

  return {
    services,
    clock,
    logs,
    call,
    login,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
