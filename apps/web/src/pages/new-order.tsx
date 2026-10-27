import { useState, type FormEvent } from "react";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import {
  newOrderSchema,
  type NewOrder,
  type OrderRejectedResponse,
  type OrderView,
  type QuoteView,
} from "@yuyufx/shared";
import { ApiRequestError, getPortfolio, getRisk, placeOrder } from "@/api";
import { orderHints } from "@/lib/order-hints";
import { useApi } from "@/lib/use-api";
import { ModeBadge } from "@/components/mode-badge";
import { PageHeader } from "@/components/page";
import { PriceBox } from "@/components/price-box";
import { Segmented } from "@/components/segmented";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney, formatPrice, formatQuantity } from "@/lib/format";
import { CURRENT_MODE } from "@/lib/mode";
import { Link } from "@/lib/router";

type Side = "buy" | "sell";
type Kind = "market" | "limit" | "bracket";

interface Draft {
  symbol: string;
  side: Side;
  kind: Kind;
  entry: "market" | "limit";
  quantity: string;
  limitPrice: string;
  stopLossPrice: string;
  takeProfitPrice: string;
}

const EMPTY: Draft = {
  symbol: "",
  side: "buy",
  kind: "bracket", // every new position needs a stop-loss by default (ARCHITECTURE §6)
  entry: "market",
  quantity: "",
  limitPrice: "",
  stopLossPrice: "",
  takeProfitPrice: "",
};

type Step =
  | { name: "edit" }
  | { name: "review"; order: NewOrder }
  | { name: "placed"; orders: OrderView[] }
  | { name: "rejected"; order: NewOrder; reason: string };

/** Turn the form into the API's order shape (validation happens with the shared schema). */
function toCandidate(d: Draft): unknown {
  const base = { symbol: d.symbol, side: d.side, quantity: d.quantity === "" ? Number.NaN : Number(d.quantity) };
  if (d.kind === "market") return { ...base, type: "market" };
  if (d.kind === "limit") return { ...base, type: "limit", limitPrice: d.limitPrice };
  return {
    ...base,
    type: "bracket",
    entry: d.entry,
    ...(d.entry === "limit" ? { limitPrice: d.limitPrice } : {}),
    stopLossPrice: d.stopLossPrice,
    takeProfitPrice: d.takeProfitPrice,
  };
}

function describe(order: NewOrder): string {
  const verb = order.side === "buy" ? "Buy" : "Sell";
  const what = `${verb} ${formatQuantity(order.quantity)} ${order.symbol}`;
  if (order.type === "market") return `${what} at the market price`;
  if (order.type === "limit") return `${what} at ${formatPrice(order.limitPrice)} or better`;
  const entry = order.entry === "market" ? "at the market price" : `at ${formatPrice(order.limitPrice ?? "0")} or better`;
  return `${what} ${entry}`;
}

/** Rough cost for the review step (display only; the server does the real check). */
function estimate(order: NewOrder, quote: QuoteView | null): string | null {
  const price = "limitPrice" in order && order.limitPrice ? order.limitPrice : quote?.price;
  if (!price) return null;
  return formatMoney(String(Number(price) * order.quantity));
}

function PriceField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className="tabular-nums" />
    </div>
  );
}

export function NewOrderPage() {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [step, setStep] = useState<Step>({ name: "edit" });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  // Limits and holdings, so the ticket can warn before the risk engine refuses.
  const risk = useApi(getRisk);
  const portfolio = useApi(getPortfolio);
  const symbol = draft.symbol.trim().toUpperCase();
  const held = portfolio.status === "ready" ? portfolio.data.openPositions.find((p) => p.symbol === symbol) : undefined;
  const num = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? null : Number(v));
  const hints =
    risk.status === "ready" && portfolio.status === "ready"
      ? orderHints({
          symbol,
          side: draft.side,
          kind: draft.kind,
          entry: draft.entry,
          limitPrice: num(draft.limitPrice),
          stopLossPrice: num(draft.stopLossPrice),
          lastPrice: quote ? Number(quote.price) : null,
          equity: Number(risk.data.equity),
          cash: Number(portfolio.data.cash),
          heldQuantity: held?.quantity ?? 0,
          heldValue: held ? Number(held.marketValue) : 0,
          settings: risk.data.settings,
        })
      : null;
  const quantity = num(draft.quantity);
  const overMax = hints?.maxShares != null && quantity != null && quantity > hints.maxShares;

  /** Keep what was typed (side, shares, limit price) and turn it into a bracket. */
  function switchToBracket() {
    setDraft((d) => ({ ...d, kind: "bracket", entry: d.kind === "limit" ? "limit" : "market" }));
    setError(null);
  }

  function review(event: FormEvent) {
    event.preventDefault();
    if (hints?.notice) {
      setError(hints.notice.text);
      return;
    }
    const parsed = newOrderSchema.safeParse(toCandidate(draft));
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the order");
      return;
    }
    setError(null);
    setStep({ name: "review", order: parsed.data });
  }

  async function confirm(order: NewOrder) {
    setSubmitting(true);
    try {
      const result = await placeOrder(order);
      setStep({ name: "placed", orders: result.orders });
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 422) {
        setStep({ name: "rejected", order, reason: (err.body as OrderRejectedResponse).error });
      } else {
        setError(err instanceof ApiRequestError ? err.message : "Could not reach the server.");
        setStep({ name: "edit" });
      }
    } finally {
      setSubmitting(false);
    }
  }

  function startOver() {
    setDraft(EMPTY);
    setQuote(null);
    setStep({ name: "edit" });
  }

  return (
    <>
      <PageHeader title="New order" />
      <div className="max-w-xl">
        {step.name === "edit" && (
          <Card>
            <form onSubmit={review} aria-label="New order" noValidate>
              <CardContent className="grid gap-5">
                <div className="grid gap-2">
                  <Label htmlFor="symbol">Symbol</Label>
                  <Input
                    id="symbol"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    placeholder="RY"
                    value={draft.symbol}
                    onChange={(e) => update("symbol", e.target.value.toUpperCase())}
                  />
                </div>
                <PriceBox symbol={draft.symbol} onQuote={setQuote} />

                <Segmented
                  label="Side"
                  value={draft.side}
                  onChange={(v) => update("side", v)}
                  options={[
                    { value: "buy", label: "Buy" },
                    { value: "sell", label: "Sell" },
                  ]}
                />
                <Segmented
                  label="Order type"
                  value={draft.kind}
                  onChange={(v) => update("kind", v)}
                  options={[
                    { value: "market", label: "Market" },
                    { value: "limit", label: "Limit" },
                    { value: "bracket", label: "Bracket" },
                  ]}
                />
                {draft.kind === "bracket" && (
                  <Segmented
                    label="Entry"
                    value={draft.entry}
                    onChange={(v) => update("entry", v)}
                    options={[
                      { value: "market", label: "Enter at market" },
                      { value: "limit", label: "Enter at limit" },
                    ]}
                  />
                )}
                {hints?.notice && (
                  <div role="status" className="grid gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
                    <p>{hints.notice.text}</p>
                    {hints.notice.kind === "stop_required" && (
                      <div>
                        <Button type="button" size="sm" variant="outline" onClick={switchToBracket}>
                          {draft.kind === "limit" ? "Use a bracket (keeps your limit price)" : "Use a bracket"}
                        </Button>
                      </div>
                    )}
                    {hints.notice.kind === "not_held" && (
                      <div>
                        <Button type="button" size="sm" variant="outline" onClick={() => update("side", "buy")}>
                          Switch to Buy
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="quantity">Shares</Label>
                    <Input
                      id="quantity"
                      inputMode="numeric"
                      value={draft.quantity}
                      onChange={(e) => update("quantity", e.target.value.replace(/[^\d]/g, ""))}
                      className="tabular-nums"
                      aria-describedby={hints?.maxShares != null ? "max-shares" : undefined}
                      aria-invalid={overMax ? true : undefined}
                    />
                    {hints?.maxShares != null && hints.maxReason && (
                      <p id="max-shares" className={overMax ? "text-sm text-loss" : "text-sm text-muted-foreground"}>
                        Up to {hints.maxShares.toLocaleString("en-CA")} ({hints.maxReason})
                      </p>
                    )}
                  </div>
                  {(draft.kind === "limit" || (draft.kind === "bracket" && draft.entry === "limit")) && (
                    <PriceField id="limit" label="Limit price" value={draft.limitPrice} onChange={(v) => update("limitPrice", v)} />
                  )}
                  {draft.kind === "bracket" && (
                    <>
                      <PriceField id="stop" label="Stop-loss" value={draft.stopLossPrice} onChange={(v) => update("stopLossPrice", v)} />
                      <PriceField
                        id="target"
                        label="Take-profit"
                        value={draft.takeProfitPrice}
                        onChange={(v) => update("takeProfitPrice", v)}
                      />
                    </>
                  )}
                </div>

                {error && (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
              </CardContent>
              <CardFooter className="mt-5">
                <Button type="submit" className="w-full sm:w-auto">
                  Review order
                </Button>
              </CardFooter>
            </form>
          </Card>
        )}

        {step.name === "review" && (
          <Card>
            <CardHeader className="flex items-center justify-between gap-2">
              <CardTitle>Confirm</CardTitle>
              <ModeBadge mode={CURRENT_MODE} />
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <p className="text-base font-medium">{describe(step.order)}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
                {step.order.type === "bracket" && (
                  <>
                    <dt className="text-muted-foreground">Stop-loss</dt>
                    <dd className="tabular-nums">{formatPrice(step.order.stopLossPrice)}</dd>
                    <dt className="text-muted-foreground">Take-profit</dt>
                    <dd className="tabular-nums">{formatPrice(step.order.takeProfitPrice)}</dd>
                  </>
                )}
                {quote && (
                  <>
                    <dt className="text-muted-foreground">Last price</dt>
                    <dd className="tabular-nums">{formatPrice(quote.price)}</dd>
                  </>
                )}
                {estimate(step.order, quote) && (
                  <>
                    <dt className="text-muted-foreground">About</dt>
                    <dd className="tabular-nums">{estimate(step.order, quote)} + fees</dd>
                  </>
                )}
              </dl>
            </CardContent>
            <CardFooter className="mt-2 flex flex-wrap gap-2">
              <Button onClick={() => void confirm(step.order)} disabled={submitting}>
                {submitting ? "Placing…" : "Place paper order"}
              </Button>
              <Button variant="outline" onClick={() => setStep({ name: "edit" })} disabled={submitting}>
                Back
              </Button>
            </CardFooter>
          </Card>
        )}

        {step.name === "placed" && <PlacedResult orders={step.orders} onNew={startOver} />}

        {step.name === "rejected" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <XCircle className="size-5 text-destructive" aria-hidden />
                Not placed
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <p>{describe(step.order)}</p>
              <p role="alert" className="text-destructive">
                {step.reason}
              </p>
            </CardContent>
            <CardFooter className="mt-2 flex flex-wrap gap-2">
              <Button onClick={() => setStep({ name: "edit" })}>Edit order</Button>
            </CardFooter>
          </Card>
        )}
      </div>
    </>
  );
}

function PlacedResult({ orders, onNew }: { orders: OrderView[]; onNew: () => void }) {
  const entry = orders[0];
  if (!entry) return null;
  const filled = entry.status === "filled" && entry.fill;
  const verb = entry.side === "buy" ? "Bought" : "Sold";
  const exits = orders.slice(1);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {filled ? (
            <CheckCircle2 className="size-5 text-gain" aria-hidden />
          ) : (
            <Clock className="size-5 text-muted-foreground" aria-hidden />
          )}
          {filled ? "Filled" : "Waiting"}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        {filled && entry.fill ? (
          <p>
            {verb} {formatQuantity(entry.quantity)} {entry.symbol} at{" "}
            <span className="tabular-nums">{formatPrice(entry.fill.price)}</span>, fee{" "}
            <span className="tabular-nums">{formatMoney(entry.fill.fee)}</span>.
          </p>
        ) : (
          <p>
            {entry.side === "buy" ? "Buys" : "Sells"} {formatQuantity(entry.quantity)} {entry.symbol} when the price reaches{" "}
            <span className="tabular-nums">{formatPrice(entry.limitPrice ?? "0")}</span>.
          </p>
        )}
        {exits.length > 0 && (
          <p className="text-muted-foreground">
            Stop-loss {formatPrice(exits[0]?.stopPrice ?? "0")} and take-profit {formatPrice(exits[1]?.limitPrice ?? "0")}{" "}
            {filled ? "are active." : "start once the entry fills."}
          </p>
        )}
      </CardContent>
      <CardFooter className="mt-2 flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/positions">Positions &amp; orders</Link>
        </Button>
        <Button variant="outline" onClick={onNew}>
          New order
        </Button>
      </CardFooter>
    </Card>
  );
}
