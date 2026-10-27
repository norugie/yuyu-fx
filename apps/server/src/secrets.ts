import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Encryption at rest for API credentials (ARCHITECTURE §9, PRD AC10.3).
//
// AES-256-GCM: a 32-byte key from the environment (SECRETS_KEY), a fresh random
// 12-byte nonce per value, and an authentication tag, so any change to the stored
// value (or using it for a different purpose, via `context`) makes decryption fail
// instead of returning garbage. Format: "v1.<nonce>.<tag>.<ciphertext>" (base64url).

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";

export class SecretDecryptError extends Error {
  override name = "SecretDecryptError";
}

/** SECRETS_KEY is 64 hex characters (32 bytes). */
export function parseSecretsKey(hex: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("SECRETS_KEY must be 64 hex characters (32 bytes)");
  return Buffer.from(hex, "hex");
}

/**
 * Encrypt `plaintext`. `context` (e.g. "questrade:refresh_token") is bound to
 * the result: decrypting with a different context fails.
 */
export function encryptSecret(plaintext: string, key: Buffer, context: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, nonce, tag, ciphertext].map((part) => (typeof part === "string" ? part : part.toString("base64url"))).join(".");
}

export function decryptSecret(stored: string, key: Buffer, context: string): string {
  const [version, nonce, tag, ciphertext, extra] = stored.split(".");
  if (version !== VERSION || !nonce || !tag || ciphertext === undefined || extra !== undefined) {
    throw new SecretDecryptError("Stored secret has an unknown format");
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(nonce, "base64url"));
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    // Wrong key, wrong context or tampered data. Never include the value in the message.
    throw new SecretDecryptError("Stored secret could not be decrypted (wrong SECRETS_KEY or changed data)");
  }
}
