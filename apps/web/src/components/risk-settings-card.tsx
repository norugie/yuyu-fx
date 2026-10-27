import { useEffect, useState, type FormEvent } from "react";
import { riskSettingsSchema, type RiskSettings } from "@yuyufx/shared";
import { updateRiskSettings } from "@/api";
import { PasswordDialog } from "@/components/password-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Risk limits (PRD F5). Percentages are shown as %, stored as basis points.

type PercentKey = "riskPerTradeBps" | "maxPositionBps" | "dailyLossBps" | "maxDrawdownBps" | "maxLimitDeviationBps" | "maxExitDeviationBps";
type CountKey = "maxOpenPositions" | "maxOrderQuantity" | "maxOrdersPerMinute";

const PERCENT_FIELDS: [PercentKey, string][] = [
  ["riskPerTradeBps", "Risk per trade"],
  ["maxPositionBps", "Max position size"],
  ["dailyLossBps", "Daily loss limit"],
  ["maxDrawdownBps", "Max drawdown"],
  ["maxLimitDeviationBps", "Limit price distance"],
  ["maxExitDeviationBps", "Stop / target distance"],
];
const COUNT_FIELDS: [CountKey, string][] = [
  ["maxOpenPositions", "Max open positions"],
  ["maxOrderQuantity", "Max shares per order"],
  ["maxOrdersPerMinute", "Max orders per minute"],
];

type Draft = Record<PercentKey | CountKey, string> & { requireStopLoss: boolean; allowedSymbols: string };

function toDraft(s: RiskSettings): Draft {
  const draft = { requireStopLoss: s.requireStopLoss, allowedSymbols: s.allowedSymbols.join(", ") } as Draft;
  for (const [key] of PERCENT_FIELDS) draft[key] = String(s[key] / 100);
  for (const [key] of COUNT_FIELDS) draft[key] = String(s[key]);
  return draft;
}

function fromDraft(d: Draft): unknown {
  const out: Record<string, unknown> = {
    requireStopLoss: d.requireStopLoss,
    allowedSymbols: d.allowedSymbols
      .split(/[\s,]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
  };
  for (const [key] of PERCENT_FIELDS) out[key] = d[key].trim() === "" ? Number.NaN : Math.round(Number(d[key]) * 100);
  for (const [key] of COUNT_FIELDS) out[key] = d[key].trim() === "" ? Number.NaN : Number(d[key]);
  return out;
}

export function RiskSettingsCard({ settings, onSaved }: { settings: RiskSettings; onSaved: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(settings));
  const [pending, setPending] = useState<RiskSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => setDraft(toDraft(settings)), [settings]);

  function review(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    const parsed = riskSettingsSchema.safeParse(fromDraft(draft));
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the values");
      return;
    }
    setError(null);
    setPending(parsed.data);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Risk limits</CardTitle>
      </CardHeader>
      <form onSubmit={review} noValidate aria-label="Risk limits">
        <CardContent className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PERCENT_FIELDS.map(([key, label]) => (
              <div key={key} className="grid gap-2">
                <Label htmlFor={key}>{label}</Label>
                <div className="relative">
                  <Input
                    id={key}
                    inputMode="decimal"
                    className="pr-8 tabular-nums"
                    value={draft[key]}
                    onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">%</span>
                </div>
              </div>
            ))}
            {COUNT_FIELDS.map(([key, label]) => (
              <div key={key} className="grid gap-2">
                <Label htmlFor={key}>{label}</Label>
                <Input
                  id={key}
                  inputMode="numeric"
                  className="tabular-nums"
                  value={draft[key]}
                  onChange={(e) => setDraft({ ...draft, [key]: e.target.value.replace(/[^\d]/g, "") })}
                />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="requireStopLoss"
              checked={draft.requireStopLoss}
              onCheckedChange={(v) => setDraft({ ...draft, requireStopLoss: v === true })}
            />
            <Label htmlFor="requireStopLoss">New positions need a stop-loss (bracket orders)</Label>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="allowedSymbols">Allowed symbols</Label>
            <textarea
              id="allowedSymbols"
              rows={3}
              spellCheck={false}
              className="min-h-20 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm uppercase outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              value={draft.allowedSymbols}
              onChange={(e) => setDraft({ ...draft, allowedSymbols: e.target.value })}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {saved && (
            <p role="status" className="text-sm text-muted-foreground">
              Saved.
            </p>
          )}
        </CardContent>
        <CardFooter className="mt-5">
          <Button type="submit">Save limits</Button>
        </CardFooter>
      </form>

      <PasswordDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title="Change risk limits"
        confirmLabel="Save"
        onConfirm={async (password) => {
          if (!pending) return;
          await updateRiskSettings(password, pending);
          setSaved(true);
          onSaved();
        }}
      />
    </Card>
  );
}
