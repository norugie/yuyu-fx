import { z } from "zod";

// Environment config, checked once at startup. If anything is missing or
// invalid we stop with a message that names the keys, never their values.

const configSchema = z.object({
  DATABASE_URL: z.url({
    protocol: /^postgres(ql)?$/,
    error: "must be a postgres:// URL",
  }),
  SESSION_SECRET: z.string().min(32, { error: "must be at least 32 characters" }),
  PORT: z.coerce
    .number({ error: "must be a number" })
    .int({ error: "must be a whole number" })
    .min(1, { error: "must be between 1 and 65535" })
    .max(65535, { error: "must be between 1 and 65535" })
    .default(3000),
  // Log out after this many minutes without a request.
  SESSION_IDLE_MINUTES: z.coerce
    .number({ error: "must be a number" })
    .int({ error: "must be a whole number" })
    .min(1, { error: "must be between 1 and 1440" })
    .max(1440, { error: "must be between 1 and 1440" })
    .default(30),
  // Where the dashboard is served from. The only origin allowed by CORS and the
  // CSRF origin check. An https:// origin also turns on the Secure cookie flag.
  WEB_ORIGIN: z
    .url({ protocol: /^https?$/, error: "must be an http:// or https:// URL" })
    .default("http://127.0.0.1:5173")
    .transform((value) => new URL(value).origin),
  // Pretend money the paper account starts with (CAD).
  PAPER_STARTING_CASH: z
    .string()
    .regex(/^\d{1,9}(\.\d{1,2})?$/, { error: "must be an amount like 100000 or 25000.50" })
    .default("100000"),
  // 32-byte key (64 hex chars) that encrypts stored API credentials (AES-256-GCM).
  SECRETS_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, { error: "must be 64 hex characters (32 bytes)" }),
  // Questrade refresh token from the API app page. Used once to bootstrap; the
  // rotated tokens after that are stored encrypted in the database.
  QUESTRADE_REFRESH_TOKEN: z
    .string()
    .regex(/^\S{10,512}$/, { error: "doesn't look like a Questrade refresh token (no spaces, 10-512 characters)" })
    .optional(),
  // Symbols to keep daily bars for, comma-separated (TSX tickers).
  MARKET_DATA_SYMBOLS: z
    .string()
    .regex(/^[A-Za-z]{1,6}(\.[A-Za-z]{1,2})?(,[A-Za-z]{1,6}(\.[A-Za-z]{1,2})?)*$/, {
      error: "must be comma-separated TSX symbols, e.g. XIU,RY,TD",
    })
    .default("XIU")
    .transform((value) => value.toUpperCase().split(",")),
});

export type Config = z.infer<typeof configSchema>;

const KEYS = Object.keys(configSchema.shape) as (keyof Config)[];

export class ConfigError extends Error {
  override name = "ConfigError";
}

/**
 * Validate the environment and return typed config.
 * Empty values (e.g. `PORT=` copied from .env.example) count as missing.
 * Throws ConfigError listing every bad key.
 */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const raw: Partial<Record<keyof Config, string>> = {};
  for (const key of KEYS) {
    const value = env[key];
    if (value !== undefined && value.trim() !== "") raw[key] = value;
  }

  const result = configSchema.safeParse(raw);
  if (result.success) return result.data;

  const problems = result.error.issues.map((issue) => {
    const key = String(issue.path[0] ?? "(unknown)");
    const reason = raw[key as keyof Config] === undefined ? "is missing" : issue.message;
    return `  - ${key}: ${reason}`;
  });

  throw new ConfigError(
    [
      "Invalid environment configuration:",
      ...problems,
      "Set these in .env at the repo root (see .env.example).",
    ].join("\n"),
  );
}

/** Load the repo-root .env (if present) into process.env. Shell variables win over .env. */
export function loadEnvFileIfPresent(envFile: string): void {
  try {
    process.loadEnvFile(envFile);
  } catch (error) {
    // A missing .env is fine (vars may come from the shell); anything else is not.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
