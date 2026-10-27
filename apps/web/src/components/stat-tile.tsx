import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

/** A headline number. `value` is null until there's data, shown as an em dash. */
export function StatTile({ label, value }: { label: string; value: ReactNode | null }) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="px-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-semibold tabular-nums sm:text-2xl">
          {value ?? <span aria-label="No data yet">—</span>}
        </p>
      </CardContent>
    </Card>
  );
}
