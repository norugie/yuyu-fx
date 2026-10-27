import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { formatSignedMoney, signOf } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Gain/loss: sign, arrow and colour together, never colour alone (DESIGN §5). */
export function Pnl({ value, className }: { value: string; className?: string }) {
  const sign = signOf(value);
  const Icon = sign > 0 ? ArrowUpRight : sign < 0 ? ArrowDownRight : null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 tabular-nums",
        sign > 0 && "text-gain",
        sign < 0 && "text-loss",
        className,
      )}
    >
      {Icon && <Icon className="size-[1em] shrink-0" aria-hidden />}
      {formatSignedMoney(value)}
    </span>
  );
}
