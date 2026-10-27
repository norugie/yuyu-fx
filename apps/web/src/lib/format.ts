// Display formatting. Values arrive as exact decimal strings ("130.0700"); they
// are only turned into numbers here, for display, never for arithmetic.

const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", currencyDisplay: "narrowSymbol" });
const quantity = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 });

/** "1234.5000" -> "$1,234.50" */
export function formatMoney(value: string): string {
  return money.format(Number(value));
}

/** "130.0700" -> "130.07"; keeps 3rd/4th decimals only when they matter ("0.0050" -> "0.005"). */
export function formatPrice(value: string): string {
  const [whole = "0", fraction = ""] = value.split(".");
  const trimmed = fraction.replace(/0+$/, "").padEnd(2, "0");
  return `${Number(whole).toLocaleString("en-CA")}.${trimmed}`;
}

export function formatQuantity(value: number): string {
  return quantity.format(value);
}

/** Sign of a decimal string: 1, -1 or 0. */
export function signOf(value: string): 1 | -1 | 0 {
  const n = Number(value);
  return n > 0 ? 1 : n < 0 ? -1 : 0;
}

/** "-200.0000" -> "−$200.00", "194" -> "+$194.00" (always signed, true minus sign). */
export function formatSignedMoney(value: string): string {
  const sign = signOf(value);
  const abs = money.format(Math.abs(Number(value)));
  return sign > 0 ? `+${abs}` : sign < 0 ? `−${abs}` : abs;
}

const time = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" });
export const formatTime = (iso: string) => time.format(new Date(iso));
