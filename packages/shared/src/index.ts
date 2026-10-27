// Types shared by server and web. Orders, positions and decisions land here in later tasks.

/** Body returned by the server's GET /health. */
export interface HealthResponse {
  status: "ok";
}

/** Error body for every failed /api request. */
export interface ApiError {
  error: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface AuthUser {
  id: string;
  username: string;
}

/**
 * Returned by POST /api/auth/login and GET /api/auth/me.
 * The page must send `csrfToken` in the X-CSRF-Token header on every
 * POST/PUT/PATCH/DELETE request.
 */
export interface AuthResponse {
  user: AuthUser;
  csrfToken: string;
}

export * from "./trading.js";
export * from "./risk.js";
