import { describe, expect, it } from "vitest";
import { divRound, fromUnits, roundToTick, shiftByBps, times, toUnits } from "../src/money.js";

describe("money", () => {
  it("parses and formats exactly", () => {
    expect(toUnits("130.25")).toBe(1_302_500n);
    expect(toUnits("0.1")).toBe(1_000n);
    expect(toUnits("-2.5")).toBe(-25_000n);
    expect(fromUnits(1_302_500n)).toBe("130.2500");
    expect(fromUnits(-25_000n)).toBe("-2.5000");
    expect(fromUnits(5n)).toBe("0.0005");
  });

  it("adds 0.1 + 0.2 exactly (floats can't)", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(fromUnits(toUnits("0.1") + toUnits("0.2"))).toBe("0.3000");
  });

  it("rejects malformed amounts", () => {
    for (const bad of ["", "1.23456", "1e3", "abc", "1,000"]) expect(() => toUnits(bad)).toThrow();
  });

  it("multiplies by whole shares only", () => {
    expect(fromUnits(times(toUnits("130.25"), 3))).toBe("390.7500");
    expect(() => times(1n, 1.5)).toThrow();
  });

  it("rounds in the stated direction, including negatives", () => {
    expect(divRound(7n, 2n, "up")).toBe(4n);
    expect(divRound(7n, 2n, "down")).toBe(3n);
    expect(divRound(-7n, 2n, "up")).toBe(-3n);
    expect(divRound(-7n, 2n, "down")).toBe(-4n);
    expect(divRound(6n, 2n, "up")).toBe(3n);
  });

  it("shifts by basis points and rounds to ticks", () => {
    expect(fromUnits(shiftByBps(toUnits("100"), 5, "up"))).toBe("100.0500");
    expect(fromUnits(shiftByBps(toUnits("100"), 5, "down"))).toBe("99.9500");
    expect(fromUnits(roundToTick(toUnits("100.0001"), toUnits("0.01"), "up"))).toBe("100.0100");
    expect(fromUnits(roundToTick(toUnits("100.0099"), toUnits("0.01"), "down"))).toBe("100.0000");
  });
});
