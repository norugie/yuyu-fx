import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, parseSecretsKey, SecretDecryptError } from "../src/secrets.js";

// Task 4.2: AES-256-GCM encryption of stored credentials (AC10.3).

const key = randomBytes(32);
const CONTEXT = "questrade:refresh_token";
const SECRET = "aSecretRefreshToken123";

describe("secrets", () => {
  it("round-trips a value", () => {
    expect(decryptSecret(encryptSecret(SECRET, key, CONTEXT), key, CONTEXT)).toBe(SECRET);
  });

  it("never contains the plaintext, and differs every time (fresh nonce)", () => {
    const a = encryptSecret(SECRET, key, CONTEXT);
    const b = encryptSecret(SECRET, key, CONTEXT);
    expect(a).not.toContain(SECRET);
    expect(Buffer.from(a.split(".")[3] ?? "", "base64url").toString("utf8")).not.toContain(SECRET);
    expect(a).not.toBe(b);
    expect(a.startsWith("v1.")).toBe(true);
  });

  it("fails with the wrong key", () => {
    const stored = encryptSecret(SECRET, key, CONTEXT);
    expect(() => decryptSecret(stored, randomBytes(32), CONTEXT)).toThrow(SecretDecryptError);
  });

  it("fails with a different context (a value can't be reused for another purpose)", () => {
    const stored = encryptSecret(SECRET, key, CONTEXT);
    expect(() => decryptSecret(stored, key, "other:purpose")).toThrow(SecretDecryptError);
  });

  it("detects tampering", () => {
    const parts = encryptSecret(SECRET, key, CONTEXT).split(".");
    const ct = Buffer.from(parts[3] ?? "", "base64url");
    ct[0] = (ct[0] ?? 0) ^ 1;
    parts[3] = ct.toString("base64url");
    expect(() => decryptSecret(parts.join("."), key, CONTEXT)).toThrow(SecretDecryptError);
    expect(() => decryptSecret("garbage", key, CONTEXT)).toThrow("unknown format");
  });

  it("error messages never include the secret", () => {
    try {
      decryptSecret(encryptSecret(SECRET, key, CONTEXT), randomBytes(32), CONTEXT);
    } catch (error) {
      expect(String(error)).not.toContain(SECRET);
    }
  });

  it("validates the key format", () => {
    expect(parseSecretsKey("ab".repeat(32))).toHaveLength(32);
    expect(() => parseSecretsKey("too-short")).toThrow("64 hex");
  });
});
