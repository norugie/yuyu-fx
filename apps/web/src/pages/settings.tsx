import { getRisk } from "@/api";
import { AutomationCard } from "@/components/automation-card";
import { ModeBadge } from "@/components/mode-badge";
import { PageHeader } from "@/components/page";
import { RiskSettingsCard } from "@/components/risk-settings-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CURRENT_MODE } from "@/lib/mode";
import { useApi } from "@/lib/use-api";

export function SettingsPage() {
  const risk = useApi(getRisk);
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Trading mode</CardTitle>
          </CardHeader>
          <CardContent>
            <ModeBadge mode={CURRENT_MODE} />
          </CardContent>
        </Card>
        {risk.status === "error" && (
          <p role="alert" className="text-sm text-destructive">
            {risk.error}
          </p>
        )}
        {risk.status === "ready" && (
          <>
            <AutomationCard status={risk.data} onChange={risk.reload} />
            <RiskSettingsCard settings={risk.data.settings} onSaved={risk.reload} />
          </>
        )}
      </div>
    </>
  );
}
