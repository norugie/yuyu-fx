import { describe, expect, it } from "vitest";
import { readCookie } from "../src/api/auth/cookies.js";
import {
  hashPassword,
  normalizeUsername,
  validateNewCredentials,
  verifyPassword,
} from "../src/api/auth/credentials.js";
import { createLoginLimiter } from "../src/api/auth/rate-limit.js";
import { hashSessionToken, sessionCookieOptions } from "../src/api/auth/sessions.js";

describe("createLoginLimiter", () => {
  const options = { maxFailures: 3, windowMs: 1000 };

  it("allows attempts until maxFailures, then blocks with time left", () => {
    const limiter = createLoginLimiter(options);
    for (let i = 0; i < 3; i++) {
      expect(limiter.check("k", 100).allowed).toBe(true);
      limiter.recordFailure("k", 100);
    }
    expect(limiter.check("k", 400)).toEqual({ allowed: false, retryAfterMs: 700 });
  });

  it("opens again when the window ends", () => {
    const limiter = createLoginLimiter(options);
    for (let i = 0; i < 3; i++) limiter.recordFailure("k", 0);
    expect(limiter.check("k", 999).allowed).toBe(false);
    expect(limiter.check("k", 1000).allowed).toBe(true);
  });

  it("starts a fresh window for failures after the old one ended", () => {
    const limiter = createLoginLimiter(options);
    for (let i = 0; i < 3; i++) limiter.recordFailure("k", 0);
    limiter.recordFailure("k", 1500);
    expect(limiter.check("k", 1500).allowed).toBe(true);
  });

  it("keeps keys separate, and reset clears one", () => {
    const limiter = createLoginLimiter(options);
    for (let i = 0; i < 3; i++) limiter.recordFailure("a", 0);
    expect(limiter.check("b", 0).allowed).toBe(true);
    limiter.reset("a");
    expect(limiter.check("a", 0).allowed).toBe(true);
  });
});

describe("credentials", () => {
  it("hashes with Argon2id and verifies", async () => {
    const hash = await hashPassword("a long enough password");
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword(hash, "a long enough password")).toBe(true);
    expect(await verifyPassword(hash, "another password")).toBe(false);
  });

  it("treats a malformed hash as no match instead of throwing", async () => {
    expect(await verifyPassword("not-a-hash", "x")).toBe(false);
  });

  it("normalizes usernames", () => {
    expect(normalizeUsername("  Youmu ")).toBe("youmu");
  });

  it("validates new credentials", () => {
    expect(validateNewCredentials("youmu", "twelve chars")).toBeNull();
    expect(validateNewCredentials("yo", "twelve chars")).toMatch(/Username/);
    expect(validateNewCredentials("has space", "twelve chars")).toMatch(/Username/);
    expect(validateNewCredentials("youmu", "short")).toMatch(/at least 12/);
    expect(validateNewCredentials("youmu", "x".repeat(257))).toMatch(/at most 256/);
  });
});

describe("sessions helpers", () => {
  it("hashes tokens with the secret (different secret, different id)", () => {
    const a = hashSessionToken("token", "secret-one");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken("token", "secret-two")).not.toBe(a);
  });

  it("sets Secure only for https origins", () => {
    expect(sessionCookieOptions("http://127.0.0.1:5173").secure).toBe(false);
    expect(sessionCookieOptions("https://yuyufx.example").secure).toBe(true);
    expect(sessionCookieOptions("https://yuyufx.example")).toMatchObject({
      httpOnly: true,
      sameSite: "strict",
    });
  });
});

describe("readCookie", () => {
  it("finds one cookie among several", () => {
    expect(readCookie("a=1; yuyufx_session=abc; b=2", "yuyufx_session")).toBe("abc");
  });

  it("returns undefined when missing or malformed", () => {
    expect(readCookie(undefined, "x")).toBeUndefined();
    expect(readCookie("a=1", "x")).toBeUndefined();
    expect(readCookie("x=%E0%A4%A", "x")).toBeUndefined();
  });
});
