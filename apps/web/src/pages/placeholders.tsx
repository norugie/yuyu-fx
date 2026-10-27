import { FlaskConical, SearchX, Workflow } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/router";

// Pages that only have empty states until their phase is built (see TASKS.md).

export function StrategiesPage() {
  return (
    <>
      <PageHeader title="Strategies" />
      <EmptyState icon={Workflow} title="No strategies yet" />
    </>
  );
}

export function BacktestsPage() {
  return (
    <>
      <PageHeader title="Backtests" />
      <EmptyState icon={FlaskConical} title="No backtests yet" />
    </>
  );
}

export function NotFoundPage() {
  return (
    <EmptyState
      icon={SearchX}
      title="Page not found"
      action={
        <Button asChild variant="outline">
          <Link href="/">Back to overview</Link>
        </Button>
      }
    />
  );
}
