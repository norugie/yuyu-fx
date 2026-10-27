import { CirclePlus, ListOrdered, Receipt, Workflow } from "lucide-react";
import { getPortfolio, getRisk, listOrders } from "@/api";
import { AutomationCard } from "@/components/automation-card";
import { EmptyState, PageHeader } from "@/components/page";
import { Pnl } from "@/components/pnl";
import { StatTile } from "@/components/stat-tile";
import { OrdersTable, PositionsTable } from "@/components/trading-tables";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney, formatQuantity } from "@/lib/format";
import { Link } from "@/lib/router";
import { useApi } from "@/lib/use-api";

// Status at a glance (F2, AC2.1).
export function OverviewPage() {
  const portfolio = useApi(getPortfolio);
  const orders = useApi(() => listOrders(5));
  const risk = useApi(getRisk);
  const p = portfolio.status === "ready" ? portfolio.data : null;

  return (
    <>
      <PageHeader
        title="Overview"
        actions={
          <Button asChild>
            <Link href="/orders/new">
              <CirclePlus aria-hidden />
              New order
            </Link>
          </Button>
        }
      />

      <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatTile label="Equity" value={p ? formatMoney(p.equity) : null} />
        <StatTile label="Today's P&L" value={p ? <Pnl value={p.todayPnl} /> : null} />
        <StatTile label="Open positions" value={p ? formatQuantity(p.openPositions.length) : null} />
        <StatTile label="Strategies on" value="0" />
      </section>

      {portfolio.status === "error" && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {portfolio.error}
        </p>
      )}

      {risk.status === "ready" && (
        <div className="mt-6">
          <AutomationCard
            status={risk.data}
            onChange={() => {
              risk.reload();
              portfolio.reload();
              orders.reload();
            }}
          />
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Open positions</CardTitle>
          </CardHeader>
          <CardContent>
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
            <CardTitle>Recent orders</CardTitle>
            {orders.status === "ready" && orders.data.length > 0 && (
              <CardAction>
                <Button asChild variant="link" size="sm">
                  <Link href="/positions">All orders</Link>
                </Button>
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            {orders.status === "ready" &&
              (orders.data.length === 0 ? (
                <EmptyState icon={Receipt} title="No orders yet" />
              ) : (
                <OrdersTable orders={orders.data} compact />
              ))}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Strategies</CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState icon={Workflow} title="No strategies yet" />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
