import { useEffect, useState } from "react";
import { priceSchema, symbolSchema, type QuoteView } from "@yuyufx/shared";
import { getQuote, setQuote, ApiRequestError } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPrice, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The latest price for a symbol, plus a box to type today's price
 * (prices are typed in by Youmu until a data source exists, PRD Q5 / D1).
 */
export function PriceBox({ symbol, onQuote }: { symbol: string; onQuote: (quote: QuoteView | null) => void }) {
  const valid = symbolSchema.safeParse(symbol);
  const normalized = valid.success ? valid.data : null;
  const [quote, setQuoteState] = useState<QuoteView | null | "loading">(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!normalized) {
      setQuoteState(null);
      onQuote(null);
      return;
    }
    let cancelled = false;
    setQuoteState("loading");
    // Wait for typing to pause before asking the server.
    const timer = setTimeout(() => {
      getQuote(normalized).then(
        (q) => {
          if (cancelled) return;
          setQuoteState(q);
          onQuote(q);
        },
        () => !cancelled && setQuoteState(null),
      );
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // onQuote is a stable setter from the parent.
  }, [normalized]);

  async function submit(event: { preventDefault(): void }) {
    event.preventDefault(); // Enter must not submit the surrounding order form
    if (!normalized) return;
    const price = priceSchema.safeParse(draft);
    if (!price.success) {
      setError(price.error.issues[0]?.message ?? "Invalid price");
      return;
    }
    setError(null);
    try {
      const saved = await setQuote({ symbol: normalized, price: price.data });
      setQuoteState(saved);
      onQuote(saved);
      setDraft("");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not save the price.");
    }
  }

  if (!normalized) return null;

  return (
    <div className="grid gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-muted-foreground">Last price</span>
        {quote === "loading" ? (
          <span className="text-muted-foreground">…</span>
        ) : quote ? (
          <span className={cn("tabular-nums", quote.stale && "text-loss")}>
            <span className="text-base font-semibold">{formatPrice(quote.price)}</span>{" "}
            <span className="text-muted-foreground">
              {quote.stale ? "· earlier day" : `· ${formatTime(quote.quotedAt)}`}
              {quote.source === "questrade" ? " · Questrade" : " · typed in"}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">None yet</span>
        )}
      </div>
      {/* Not a <form>: it sits inside the order form. */}
      <div className="flex gap-2">
        <Input
          aria-label={`Today's price for ${normalized}`}
          placeholder="Today's price"
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit(e);
          }}
          aria-invalid={error ? true : undefined}
          className="tabular-nums"
        />
        <Button type="button" variant="outline" onClick={(e) => void submit(e)} disabled={!draft}>
          Set price
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
