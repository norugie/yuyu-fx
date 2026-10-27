import {
  CirclePlus,
  FlaskConical,
  LayoutDashboard,
  ListOrdered,
  type LucideIcon,
  Settings,
  Workflow,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** The dashboard's pages (DESIGN.md §2). */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/positions", label: "Positions & orders", icon: ListOrdered },
  { href: "/orders/new", label: "New order", icon: CirclePlus },
  { href: "/strategies", label: "Strategies", icon: Workflow },
  { href: "/backtests", label: "Backtests", icon: FlaskConical },
  { href: "/settings", label: "Settings", icon: Settings },
];
