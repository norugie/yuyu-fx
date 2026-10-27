// Login rate limit: after `maxFailures` failed attempts for one key (IP + username)
// within `windowMs`, further attempts are refused until the window ends.
// Kept in memory, which is fine for one server process. A successful login clears the key.

export interface LoginLimiterOptions {
  maxFailures: number;
  windowMs: number;
}

export type LimitCheck = { allowed: true } | { allowed: false; retryAfterMs: number };

export interface LoginLimiter {
  check(key: string, now: number): LimitCheck;
  recordFailure(key: string, now: number): void;
  reset(key: string): void;
}

export const DEFAULT_LOGIN_LIMIT: LoginLimiterOptions = {
  maxFailures: 5,
  windowMs: 15 * 60 * 1000,
};

interface Entry {
  failures: number;
  windowStart: number;
}

export function createLoginLimiter(options: LoginLimiterOptions = DEFAULT_LOGIN_LIMIT): LoginLimiter {
  const entries = new Map<string, Entry>();

  const isExpired = (entry: Entry, now: number) => now - entry.windowStart >= options.windowMs;

  return {
    check(key, now) {
      const entry = entries.get(key);
      if (!entry || isExpired(entry, now) || entry.failures < options.maxFailures) {
        return { allowed: true };
      }
      return { allowed: false, retryAfterMs: entry.windowStart + options.windowMs - now };
    },

    recordFailure(key, now) {
      const entry = entries.get(key);
      if (!entry || isExpired(entry, now)) {
        entries.set(key, { failures: 1, windowStart: now });
      } else {
        entry.failures += 1;
      }
      // Keep memory bounded: drop finished windows now and then.
      if (entries.size > 1000) {
        for (const [k, e] of entries) if (isExpired(e, now)) entries.delete(k);
      }
    },

    reset(key) {
      entries.delete(key);
    },
  };
}
