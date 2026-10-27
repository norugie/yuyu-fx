import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { brokerCredentials } from "../../db/schema.js";
import { decryptSecret, encryptSecret } from "../../secrets.js";

// Where the Questrade refresh token lives between runs: encrypted in Postgres.

const PROVIDER = "questrade";
const CONTEXT = "questrade:refresh_token";

export interface StoredToken {
  refreshToken: string;
  /** Fingerprint of the .env token this chain started from (null if none). */
  bootstrapHash: string | null;
}

export interface TokenStore {
  load(): Promise<StoredToken | null>;
  save(token: StoredToken): Promise<void>;
}

/** SHA-256 fingerprint, so we can tell "same .env token as before" without storing it. */
export function fingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createDbTokenStore(db: Database, key: Buffer): TokenStore {
  return {
    async load() {
      const [row] = await db.select().from(brokerCredentials).where(eq(brokerCredentials.provider, PROVIDER));
      if (!row) return null;
      return { refreshToken: decryptSecret(row.refreshTokenEncrypted, key, CONTEXT), bootstrapHash: row.bootstrapHash };
    },

    async save(token) {
      const encrypted = encryptSecret(token.refreshToken, key, CONTEXT);
      await db
        .insert(brokerCredentials)
        .values({ provider: PROVIDER, refreshTokenEncrypted: encrypted, bootstrapHash: token.bootstrapHash })
        .onConflictDoUpdate({
          target: brokerCredentials.provider,
          set: { refreshTokenEncrypted: encrypted, bootstrapHash: token.bootstrapHash, updatedAt: new Date() },
        });
    },
  };
}

/** In-memory store for tests. */
export function createMemoryTokenStore(initial: StoredToken | null = null): TokenStore & { current: StoredToken | null } {
  const store = {
    current: initial,
    async load() {
      return store.current;
    },
    async save(token: StoredToken) {
      store.current = token;
    },
  };
  return store;
}
