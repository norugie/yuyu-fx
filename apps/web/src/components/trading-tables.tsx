import type { OrderView, PositionView } from "@yuyufx/shared";
import { Pnl } from "@/components/pnl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, formatPrice, formatQuantity, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

// Positions and orders. Wide screens get a table; phones get stacked rows (DESIGN §6).

function LastPrice({ position }: { position: PositionView }) {
  if (!position.lastPrice) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn(position.priceStale && "text-muted-foreground")}>
      {formatPrice(position.lastPrice)}
      {position.priceStale && <span className="ml-1 text-xs">earlier day</span>}
    </span>
  );
}

export function PositionsTable({ positions }: { positions: PositionView[] }) {
  return (
    <>
      <Table className="hidden md:table">
        <TableHeader>
          <TableRow>
            <TableHead>Symbol</TableHead>
            <TableHead className="text-right">Shares</TableHead>
            <TableHead className="text-right">Avg cost</TableHead>
            <TableHead className="text-right">Last</TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead className="text-right">Unrealised</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {positions.map((p) => (
            <TableRow key={p.symbol}>
              <TableCell className="font-medium">{p.symbol}</TableCell>
              <TableCell className="text-right">{formatQuantity(p.quantity)}</TableCell>
              <TableCell className="text-right">{formatPrice(p.averageCost)}</TableCell>
              <TableCell className="text-right">
                <LastPrice position={p} />
              </TableCell>
              <TableCell className="text-right">{formatMoney(p.marketValue)}</TableCell>
              <TableCell className="text-right">
                <Pnl value={p.unrealizedPnl} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <ul className="divide-y md:hidden">
        {positions.map((p) => (
          <li key={p.symbol} className="grid grid-cols-2 gap-x-4 gap-y-1 py-3 text-sm tabular-nums">
            <span className="font-medium">{p.symbol}</span>
            <span className="text-right">
              <Pnl value={p.unrealizedPnl} />
            </span>
            <span className="text-muted-foreground">
              {formatQuantity(p.quantity)} @ {formatPrice(p.averageCost)}
            </span>
            <span className="text-right text-muted-foreground">
              Last <LastPrice position={p} />
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

const ROLE_LABEL = { entry: "Entry", stop_loss: "Stop-loss", take_profit: "Take-profit" } as const;

function typeLabel(o: OrderView): string {
  const type = o.type === "market" ? "Market" : o.type === "limit" ? "Limit" : "Stop";
  return o.bracketRole ? `${ROLE_LABEL[o.bracketRole]} · ${type}` : type;
}

function orderPrice(o: OrderView): string {
  if (o.limitPrice) return formatPrice(o.limitPrice);
  if (o.stopPrice) return formatPrice(o.stopPrice);
  return "Market";
}

const STATUS_STYLE: Record<OrderView["status"], string> = {
  open: "border-border bg-background text-foreground",
  filled: "border-transparent bg-secondary text-secondary-foreground",
  cancelled: "border-transparent bg-muted text-muted-foreground",
  rejected: "border-transparent bg-destructive/10 text-destructive",
};

function Status({ order }: { order: OrderView }) {
  return (
    <Badge className={cn("capitalize", STATUS_STYLE[order.status])}>
      {order.status === "open" ? "Waiting" : order.status}
    </Badge>
  );
}

function Side({ side }: { side: OrderView["side"] }) {
  return <span className="font-medium capitalize">{side}</span>;
}

export function OrdersTable({
  orders,
  onCancel,
  cancelling,
  compact = false,
}: {
  orders: OrderView[];
  onCancel?: (order: OrderView) => void;
  cancelling?: string | null;
  /** Always use stacked rows (for narrow cards such as the Overview). */
  compact?: boolean;
}) {
  const cancelButton = (o: OrderView) =>
    onCancel && o.status === "open" ? (
      <Button
        size="sm"
        variant="outline"
        onClick={() => onCancel(o)}
        disabled={cancelling === o.id}
        aria-label={`Cancel ${o.side} ${o.quantity} ${o.symbol} ${typeLabel(o)}`}
      >
        Cancel
      </Button>
    ) : null;

  return (
    <>
      <Table className={cn("hidden", !compact && "md:table")}>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Order</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Filled at</TableHead>
            {onCancel && <TableHead className="w-0" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((o) => (
            <TableRow key={o.id}>
              <TableCell className="text-muted-foreground">{formatTime(o.createdAt)}</TableCell>
              <TableCell className={cn(o.parentId && "pl-6")}>
                <Side side={o.side} /> {formatQuantity(o.quantity)} {o.symbol}
              </TableCell>
              <TableCell>{typeLabel(o)}</TableCell>
              <TableCell className="text-right">{orderPrice(o)}</TableCell>
              <TableCell className="max-w-64 whitespace-normal">
                <Status order={o} />
                {o.statusReason && o.status !== "filled" && (
                  <p className="mt-1 text-xs text-muted-foreground">{o.statusReason}</p>
                )}
              </TableCell>
              <TableCell className="text-right">{o.fill ? formatPrice(o.fill.price) : "—"}</TableCell>
              {onCancel && <TableCell>{cancelButton(o)}</TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <ul className={cn("divide-y", !compact && "md:hidden")}>
        {orders.map((o) => (
          <li key={o.id} className={cn("grid gap-1 py-3 text-sm", o.parentId && "pl-4")}>
            <div className="flex items-center justify-between gap-2">
              <span>
                <Side side={o.side} /> {formatQuantity(o.quantity)} {o.symbol}
              </span>
              <Status order={o} />
            </div>
            <div className="flex items-center justify-between gap-2 text-muted-foreground tabular-nums">
              <span>
                {typeLabel(o)}
                {o.type !== "market" && ` · ${orderPrice(o)}`}
                {o.fill && ` · filled ${formatPrice(o.fill.price)}`}
              </span>
              {cancelButton(o)}
            </div>
            {o.statusReason && o.status !== "filled" && <p className="text-xs text-muted-foreground">{o.statusReason}</p>}
          </li>
        ))}
      </ul>
    </>
  );
}
