import type {
  ApiError,
  AuthResponse,
  AuthUser,
  LoginRequest,
  NewOrder,
  OrderView,
  PlaceOrderResponse,
  PortfolioView,
  QuoteView,
  KillSwitchResult,
  RiskSettings,
  RiskStatus,
  SetQuoteRequest,
} from "@yuyufx/shared";

// Small fetch wrapper for the YuyuFX API. The session lives in an httpOnly cookie
// the page can't read; the CSRF token is kept in memory and sent on every
// state-changing request.

let csrfToken: string | undefined;

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The parsed error body, e.g. the rejected order on a 422. */
    readonly body: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  if (init.method && init.method !== "GET" && csrfToken) headers.set("x-csrf-token", csrfToken);

  const res = await fetch(path, { ...init, headers, credentials: "same-origin" });
  if (!res.ok) {
    const body = (await res.json().catch(() => undefined)) as ApiError | undefined;
    throw new ApiRequestError(res.status, body?.error ?? `Request failed (${res.status})`, body);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

function remember(auth: AuthResponse): AuthUser {
  csrfToken = auth.csrfToken;
  return auth.user;
}

/** The logged-in user, or null if not logged in. */
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  try {
    return remember(await request<AuthResponse>("/api/auth/me"));
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) return null;
    throw error;
  }
}

export async function login(credentials: LoginRequest): Promise<AuthUser> {
  return remember(await post<AuthResponse>("/api/auth/login", credentials));
}

export async function logout(): Promise<void> {
  await post<void>("/api/auth/logout");
  csrfToken = undefined;
}

export const getPortfolio = () => request<PortfolioView>("/api/portfolio");
export const listOrders = (limit = 50) => request<OrderView[]>(`/api/orders?limit=${limit}`);
export const placeOrder = (order: NewOrder) => post<PlaceOrderResponse>("/api/orders", order);
export const cancelOrder = (id: string) => post<PlaceOrderResponse>(`/api/orders/${encodeURIComponent(id)}/cancel`);
export const setQuote = (quote: SetQuoteRequest) => post<QuoteView>("/api/quotes", quote);

/** Latest price for a symbol, or null if none has been entered. */
export async function getQuote(symbol: string): Promise<QuoteView | null> {
  try {
    return await request<QuoteView>(`/api/quotes/${encodeURIComponent(symbol)}`);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return null;
    throw error;
  }
}

export const getRisk = () => request<RiskStatus>("/api/risk");
export const updateRiskSettings = (password: string, settings: Partial<RiskSettings>) =>
  request<RiskStatus>("/api/risk/settings", { method: "PUT", body: JSON.stringify({ password, settings }) });
export const pressKillSwitch = (flatten: boolean) => post<KillSwitchResult>("/api/risk/kill-switch", { flatten });
export const resumeAutomation = (password: string) => post<RiskStatus>("/api/risk/resume", { password });
