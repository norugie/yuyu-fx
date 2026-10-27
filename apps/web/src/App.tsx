import { useEffect, useState, type ComponentType } from "react";
import type { AuthUser } from "@yuyufx/shared";
import { AppShell } from "@/components/app-shell";
import { navigate, usePath } from "@/lib/router";
import { NewOrderPage } from "@/pages/new-order";
import { OverviewPage } from "@/pages/overview";
import { PositionsPage } from "@/pages/positions";
import { SettingsPage } from "@/pages/settings";
import {
  BacktestsPage,
  NotFoundPage,
  StrategiesPage,
} from "@/pages/placeholders";
import { fetchCurrentUser, logout } from "./api";
import { LoginPage } from "./LoginPage";

type AuthState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "signed-in"; user: AuthUser };

const LOGIN_PATH = "/login";

const PAGES: Record<string, ComponentType> = {
  "/": OverviewPage,
  "/positions": PositionsPage,
  "/orders/new": NewOrderPage,
  "/strategies": StrategiesPage,
  "/backtests": BacktestsPage,
  "/settings": SettingsPage,
};

export function App() {
  const path = usePath();
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCurrentUser().then(
      (user) => setAuth(user ? { status: "signed-in", user } : { status: "anonymous" }),
      () => setError("Could not reach the server."),
    );
  }, []);

  // AC1.1: logged-out visitors are sent to /login; logged-in users leave it.
  useEffect(() => {
    if (auth.status === "anonymous") navigate(LOGIN_PATH, { replace: true });
    if (auth.status === "signed-in" && path === LOGIN_PATH) navigate("/", { replace: true });
  }, [auth, path]);

  if (error) {
    return (
      <p role="alert" className="p-6 text-sm text-destructive">
        {error}
      </p>
    );
  }
  if (auth.status === "loading") return null;
  if (auth.status === "anonymous") {
    return <LoginPage onLoggedIn={(user) => setAuth({ status: "signed-in", user })} />;
  }

  async function handleLogout() {
    try {
      await logout();
    } finally {
      setAuth({ status: "anonymous" });
    }
  }

  const Page = PAGES[path] ?? (path === LOGIN_PATH ? OverviewPage : NotFoundPage);
  return (
    <AppShell user={auth.user} path={path} onLogout={handleLogout}>
      <Page />
    </AppShell>
  );
}
