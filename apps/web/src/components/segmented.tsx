import { cn } from "@/lib/utils";

/** A row of toggle buttons where exactly one is on (e.g. Buy / Sell). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex w-full rounded-lg border bg-muted p-0.5">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground outline-none transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring",
              active && "bg-background text-foreground shadow-sm",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
