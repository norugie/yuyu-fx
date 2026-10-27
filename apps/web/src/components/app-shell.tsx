import { useState, type ReactNode } from "react";
import { LogOut, Menu, Moon, Sun } from "lucide-react";
import type { AuthUser } from "@yuyufx/shared";
import { ModeBadge } from "@/components/mode-badge";
import { NAV_ITEMS } from "@/components/nav";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { CURRENT_MODE } from "@/lib/mode";
import { Link } from "@/lib/router";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

function NavLinks({ path, onNavigate }: { path: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main">
      <ul className="flex flex-col gap-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = path === href;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/80 outline-none",
                  "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  "focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                  active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Brand() {
  return <span className="text-base font-semibold tracking-tight">YuyuFX</span>;
}

/** Logged-in layout: sidebar on wide screens, menu sheet on narrow ones, top bar always. */
export function AppShell({
  user,
  path,
  onLogout,
  children,
}: {
  user: AuthUser;
  path: string;
  onLogout: () => void;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { toggle } = useTheme();

  return (
    <div className="flex min-h-svh">
      <aside className="hidden w-60 shrink-0 flex-col gap-6 border-r bg-sidebar px-3 py-4 text-sidebar-foreground lg:flex">
        <div className="px-3">
          <Brand />
        </div>
        <NavLinks path={path} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur lg:px-6">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 bg-sidebar p-3 text-sidebar-foreground">
              <SheetHeader className="flex-row items-center gap-3 px-3 pt-1 pb-0">
                <SheetTitle>
                  <Brand />
                </SheetTitle>
                {/* The mode stays visible while the menu covers the top bar. */}
                <ModeBadge mode={CURRENT_MODE} />
              </SheetHeader>
              <NavLinks path={path} onNavigate={() => setMenuOpen(false)} />
            </SheetContent>
          </Sheet>
          <span className="lg:hidden">
            <Brand />
          </span>

          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <ModeBadge mode={CURRENT_MODE} />
            <Button variant="ghost" size="icon" onClick={toggle} aria-label="Switch light or dark theme">
              <Sun className="hidden dark:block" />
              <Moon className="dark:hidden" />
            </Button>
            <span className="hidden text-sm text-muted-foreground sm:inline">{user.username}</span>
            <Button variant="ghost" size="icon" onClick={onLogout} aria-label="Log out">
              <LogOut />
            </Button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
