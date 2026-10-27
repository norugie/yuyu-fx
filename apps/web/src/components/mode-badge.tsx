import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { TradingMode } from "@/lib/mode";

const STYLES: Record<TradingMode, { label: string; className: string }> = {
  paper: { label: "Paper", className: "bg-paper text-paper-foreground" },
  live: { label: "Live", className: "bg-live text-live-foreground" },
};

/** Always-visible trading mode. Text plus color, never color alone. */
export function ModeBadge({ mode, className }: { mode: TradingMode; className?: string }) {
  const style = STYLES[mode];
  return (
    <Badge
      className={cn("border-transparent font-semibold tracking-wide uppercase", style.className, className)}
      aria-label={`Trading mode: ${style.label}`}
    >
      {style.label}
    </Badge>
  );
}
