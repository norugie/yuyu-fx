import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";

const validEnv = {
  DATABASE_URL: "postgres://yuyufx:pw@localhost:5432/yuyufx",
  SESSION_SECRET: "a".repeat(32),
  PORT: "3000",
  SECRETS_KEY: "ab".repeat(32),
};

function errorMessage(env: NodeJS.ProcessEnv): string {
  try {
    loadConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as ConfigError).message;
  }
  throw new Error("expected loadConfig to throw");
}

describe("loadConfig", () => {
  it("accepts a valid environment", () => {
    expect(loadConfig(validEnv)).toEqual({
      DATABASE_URL: validEnv.DATABASE_URL,
      SESSION_SECRET: validEnv.SESSION_SECRET,
      PORT: 3000,
      SESSION_IDLE_MINUTES: 30,
      WEB_ORIGIN: "http://127.0.0.1:5173",
      PAPER_STARTING_CASH: "100000",
      SECRETS_KEY: "ab".repeat(32),
      MARKET_DATA_SYMBOLS: ["XIU"],
    });
  });

  it("validates the Questrade settings without ever echoing the token", () => {
    const token = "Abc_123-xyzTOKENvalue";
    expect(loadConfig({ ...validEnv, QUESTRADE_REFRESH_TOKEN: token }).QUESTRADE_REFRESH_TOKEN).toBe(token);
    const bad = errorMessage({ ...validEnv, QUESTRADE_REFRESH_TOKEN: "has a space in it" });
    expect(bad).toContain("QUESTRADE_REFRESH_TOKEN:");
    expect(bad).not.toContain("has a space");
    expect(errorMessage({ ...validEnv, SECRETS_KEY: "short" })).toContain("SECRETS_KEY: must be 64 hex characters");
    expect(errorMessage({ ...validEnv, SECRETS_KEY: undefined })).toContain("SECRETS_KEY: is missing");
    expect(loadConfig({ ...validEnv, MARKET_DATA_SYMBOLS: "xiu,ry,bbd.b" }).MARKET_DATA_SYMBOLS).toEqual(["XIU", "RY", "BBD.B"]);
    expect(errorMessage({ ...validEnv, MARKET_DATA_SYMBOLS: "XIU;RY" })).toContain("MARKET_DATA_SYMBOLS");
  });

  it("validates SESSION_IDLE_MINUTES and WEB_ORIGIN", () => {
    expect(loadConfig({ ...validEnv, SESSION_IDLE_MINUTES: "45" }).SESSION_IDLE_MINUTES).toBe(45);
    expect(errorMessage({ ...validEnv, SESSION_IDLE_MINUTES: "0" })).toContain("SESSION_IDLE_MINUTES: must be between 1 and 1440");
    expect(loadConfig({ ...validEnv, WEB_ORIGIN: "https://yuyufx.example/" }).WEB_ORIGIN).toBe("https://yuyufx.example");
    expect(errorMessage({ ...validEnv, WEB_ORIGIN: "ftp://x" })).toContain("WEB_ORIGIN: must be an http:// or https:// URL");
  });

  it("defaults PORT to 3000 when missing or empty", () => {
    const { PORT: _unused, ...withoutPort } = validEnv;
    expect(loadConfig(withoutPort).PORT).toBe(3000);
    expect(loadConfig({ ...validEnv, PORT: "" }).PORT).toBe(3000);
  });

  it("fails with a message naming DATABASE_URL when it is missing", () => {
    const { DATABASE_URL: _unused, ...env } = validEnv;
    expect(errorMessage(env)).toContain("DATABASE_URL: is missing");
  });

  it("treats an empty DATABASE_URL as missing", () => {
    expect(errorMessage({ ...validEnv, DATABASE_URL: "" })).toContain("DATABASE_URL: is missing");
  });

  it("rejects a DATABASE_URL that is not a postgres URL", () => {
    expect(errorMessage({ ...validEnv, DATABASE_URL: "https://example.com" })).toContain(
      "DATABASE_URL: must be a postgres:// URL",
    );
  });

  it("rejects a SESSION_SECRET shorter than 32 characters", () => {
    expect(errorMessage({ ...validEnv, SESSION_SECRET: "too-short" })).toContain(
      "SESSION_SECRET: must be at least 32 characters",
    );
  });

  it("never includes secret values in the error message", () => {
    const secret = "short-secret-value";
    const message = errorMessage({ ...validEnv, SESSION_SECRET: secret, DATABASE_URL: "not a url" });
    expect(message).not.toContain(secret);
    expect(message).not.toContain("not a url");
  });

  it("lists every bad key at once", () => {
    const message = errorMessage({ PORT: "abc" });
    expect(message).toContain("DATABASE_URL");
    expect(message).toContain("SESSION_SECRET");
    expect(message).toContain("PORT: must be a number");
  });
});
