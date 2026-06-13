"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  LayoutGrid,
  ListChecks,
  Plug,
  Workflow,
  UserCog,
  Columns3,
  Printer,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/types";

const nav = [
  { href: "/board", label: "Board", icon: LayoutGrid, adminOnly: false },
  { href: "/analytics", label: "Analytics", icon: BarChart3, adminOnly: true },
  { href: "/customers", label: "Customers", icon: Users, adminOnly: false },
  {
    href: "/settings/columns",
    label: "Columns",
    icon: Columns3,
    adminOnly: true,
  },
  {
    href: "/settings/fields",
    label: "Custom Fields",
    icon: ListChecks,
    adminOnly: true,
  },
  {
    href: "/settings/automations",
    label: "Automations",
    icon: Workflow,
    adminOnly: true,
  },
  {
    href: "/settings/integrations",
    label: "Integrations",
    icon: Plug,
    adminOnly: true,
  },
  { href: "/settings/team", label: "Team", icon: UserCog, adminOnly: true },
];

interface SidebarProps {
  role: Role;
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ role, open, onClose }: SidebarProps) {
  const pathname = usePathname();

  function handleNavClick() {
    if (window.matchMedia("(max-width: 767px)").matches) {
      onClose();
    }
  }

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-50 flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white transition-transform duration-200 ease-in-out md:static",
        open ? "translate-x-0" : "-translate-x-full md:hidden"
      )}
    >
      <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4">
        <Link
          href="/board"
          onClick={handleNavClick}
          className="flex min-w-0 items-center gap-2 transition-colors hover:bg-slate-50"
          aria-label="Go to Board"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--primary)] text-white">
            <Printer className="h-4 w-4" />
          </span>
          <span className="truncate text-sm font-semibold text-slate-800">
            Print Manager
          </span>
        </Link>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label="Close menu"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {nav
          .filter((item) => !item.adminOnly || role === "admin")
          .map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={handleNavClick}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-blue-50 text-[var(--primary)]"
                    : "text-slate-600 hover:bg-slate-100"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
      </nav>
      <div className="border-t border-slate-200 p-3 text-xs text-slate-400">
        {role === "admin" ? "Admin" : "Member"}
      </div>
    </aside>
  );
}
