import { useState } from "react";
import { OctagonX, PauseCircle, PlayCircle } from "lucide-react";
import type { KillSwitchResult, RiskStatus } from "@yuyufx/shared";
import { pressKillSwitch, resumeAutomation } from "@/api";
import { PasswordDialog } from "@/components/password-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/lib/format";

/** Automation status and the kill switch (PRD F5, DESIGN §4). */
export function AutomationCard({ status, onChange }: { status: RiskStatus; onChange: () => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [flatten, setFlatten] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<KillSwitchResult | null>(null);
  const [resumeOpen, setResumeOpen] = useState(false);
  const canResume = status.halts.some((h) => /re-enable/.test(h));

  async function kill() {
    setBusy(true);
    try {
      setResult(await pressKillSwitch(flatten));
      setConfirmOpen(false);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Automation
          {status.automationAllowed ? (
            <Badge className="border-transparent bg-secondary text-secondary-foreground">
              <PlayCircle aria-hidden /> Allowed
            </Badge>
          ) : (
            <Badge className="border-transparent bg-destructive/10 text-destructive">
              <PauseCircle aria-hidden /> Paused
            </Badge>
          )}
        </CardTitle>
        <CardAction>
          <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
            <OctagonX aria-hidden /> Kill switch
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {status.halts.length > 0 && (
          <ul className="grid gap-1">
            {status.halts.map((h) => (
              <li key={h} className="text-destructive">
                {h.charAt(0).toUpperCase() + h.slice(1)}
              </li>
            ))}
          </ul>
        )}
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 tabular-nums">
          <dt className="text-muted-foreground">Peak equity</dt>
          <dd>{formatMoney(status.peakEquity)}</dd>
          <dt className="text-muted-foreground">Below peak</dt>
          <dd>{(status.drawdown * 100).toFixed(1)}%</dd>
          <dt className="text-muted-foreground">Daily loss limit</dt>
          <dd>{formatMoney(status.dailyLossLimit)}</dd>
        </dl>
        {result && (
          <p role="status">
            Kill switch: {result.cancelledOrders} order{result.cancelledOrders === 1 ? "" : "s"} cancelled
            {result.flattened.length > 0 && `, sold ${result.flattened.join(", ")}`}
            {result.notFlattened.map((n) => `; ${n.symbol} not sold: ${n.reason}`).join("")}.
          </p>
        )}
        {canResume && (
          <div>
            <Button variant="outline" onClick={() => setResumeOpen(true)}>
              Re-enable automation
            </Button>
          </div>
        )}
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Press the kill switch?</DialogTitle>
            <DialogDescription>
              Cancels every open order and stops automated trading until you re-enable it.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Checkbox id="flatten" checked={flatten} onCheckedChange={(v) => setFlatten(v === true)} />
            <Label htmlFor="flatten">Also sell all positions</Label>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Back</Button>
            </DialogClose>
            <Button variant="destructive" onClick={() => void kill()} disabled={busy}>
              {busy ? "Stopping…" : "Stop everything"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PasswordDialog
        open={resumeOpen}
        onOpenChange={setResumeOpen}
        title="Re-enable automation"
        description="Clears the kill switch and the drawdown halt. A daily-loss halt still lasts until tomorrow."
        confirmLabel="Re-enable"
        onConfirm={async (password) => {
          await resumeAutomation(password);
          onChange();
        }}
      />
    </Card>
  );
}
