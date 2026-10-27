import { useState } from "react";
import { ListOrdered, Receipt } from "lucide-react";
import type { OrderView } from "@yuyufx/shared";
import { ApiRequestError, cancelOrder, getPortfolio, listOrders } from "@/api";
import { EmptyState, PageHeader } from "@/components/page";
import { Pnl } from "@/components/pnl";
import { StatTile } from "@/components/stat-tile";
import { OrdersTable, PositionsTable } from "@/components/trading-tables";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { useApi } from "@/lib/use-api";

export function PositionsPage() {
  const portfolio = useApi(getPortfolio);
  const orders = useApi(() => listOrders(100));
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function cancel(order: OrderView) {
    setCancelling(order.id);
    setError(null);
    try {
      await cancelOrder(order.id);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not cancel the order.");
    } finally {
      setCancelling(null);
      orders.reload();
      portfolio.reload();
    }
  }

  const p = portfolio.status === "ready" ? portfolio.data : null;

  return (
    <>
      <PageHeader title="Positions & orders" />

      <section aria-label="Account" className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatTile label="Cash" value={p ? formatMoney(p.cash) : null} />
        <StatTile label="Equity" value={p ? formatMoney(p.equity) : null} />
        <StatTile label="Realised P&L" value={p ? <Pnl value={p.realizedPnl} /> : null} />
        <StatTile label="Fees" value={p ? formatMoney(p.fees) : null} />
      </section>

      <div className="mt-6 grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Positions</CardTitle>
          </CardHeader>
          <CardContent>
            {portfolio.status === "error" && <p role="alert" className="text-sm text-destructive">{portfolio.error}</p>}
            {p &&
              (p.openPositions.length === 0 ? (
                <EmptyState icon={ListOrdered} title="No open positions" />
              ) : (
                <PositionsTable positions={p.openPositions} />
              ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Orders</CardTitle>
          </CardHeader>
          <CardContent>
            {error && (
              <p role="alert" className="mb-3 text-sm text-destructive">
                {error}
              </p>
            )}
            {orders.status === "error" && <p role="alert" className="text-sm text-destructive">{orders.error}</p>}
            {orders.status === "ready" &&
              (orders.data.length === 0 ? (
                <EmptyState icon={Receipt} title="No orders yet" />
              ) : (
                <OrdersTable orders={orders.data} onCancel={(o) => void cancel(o)} cancelling={cancelling} />
              ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
