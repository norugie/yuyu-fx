// Exact money arithmetic. Amounts are BigInt counts of 1/10,000 of a dollar
// ("units"), matching the database's numeric(14, 4). Adding and multiplying by
// whole share counts is then exact; only percentages need rounding, and every
// rounding states its direction.

export type Units = bigint;

export const SCALE = 10_000n;
const DECIMALS = 4;

/** "130.25" -> 1302500n. Accepts an optional leading minus and up to 4 decimals. */
export function toUnits(value: string): Units {
  const match = /^(-)?(\d+)(?:\.(\d{1,4}))?$/.exec(value.trim());
  if (!match) throw new Error(`Not a money amount: ${JSON.stringify(value)}`);
  const [, minus, whole = "0", fraction = ""] = match;
  const units = BigInt(whole) * SCALE + BigInt(fraction.padEnd(DECIMALS, "0"));
  return minus ? -units : units;
}

/** 1302500n -> "130.2500" (always 4 decimals, like the database returns). */
export function fromUnits(units: Units): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / SCALE;
  const fraction = (abs % SCALE).toString().padStart(DECIMALS, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** Price x whole shares. Exact. */
export function times(units: Units, quantity: number): Units {
  if (!Number.isInteger(quantity)) throw new Error(`Quantity must be whole: ${quantity}`);
  return units * BigInt(quantity);
}

/** Divide, rounding toward minus infinity ("down") or plus infinity ("up"). */
export function divRound(numerator: bigint, denominator: bigint, direction: "up" | "down"): bigint {
  if (denominator <= 0n) throw new Error("Denominator must be positive");
  const quotient = numerator / denominator; // BigInt division truncates toward zero
  const remainder = numerator % denominator;
  if (remainder === 0n) return quotient;
  if (direction === "down") return numerator < 0n ? quotient - 1n : quotient;
  return numerator > 0n ? quotient + 1n : quotient;
}

/** Move a price by basis points (1 bp = 0.01%), rounded in the given direction. */
export function shiftByBps(units: Units, bps: number, direction: "up" | "down"): Units {
  if (!Number.isInteger(bps) || bps < 0) throw new Error(`Basis points must be a whole number >= 0: ${bps}`);
  const factor = direction === "up" ? 10_000n + BigInt(bps) : 10_000n - BigInt(bps);
  return divRound(units * factor, 10_000n, direction);
}

/** Round to a multiple of `tick` (in units), in the given direction. */
export function roundToTick(units: Units, tick: Units, direction: "up" | "down"): Units {
  return divRound(units, tick, direction) * tick;
}

export const minUnits = (a: Units, b: Units): Units => (a < b ? a : b);
export const maxUnits = (a: Units, b: Units): Units => (a > b ? a : b);
