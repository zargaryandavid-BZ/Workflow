"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  ListChecks,
  Plug,
  Workflow,
  UserCog,
  Columns3,
  Printer,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/types";

const nav = [
  { href: "/board", label: "Board", icon: LayoutGrid, adminOnly: false },
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

export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="flex h-14 items-center gap-2 border-b border-slate-200 px-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--primary)] text-white">
          <Printer className="h-4 w-4" />
        </span>
        <span className="text-sm font-semibold text-slate-800">
          Print Manager
        </span>
      </div>
      <nav className="flex-1 space-y-1 p-3">
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
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-blue-50 text-[var(--primary)]"
                    : "text-slate-600 hover:bg-slate-100"
                )}
              >
                <Icon className="h-4 w-4" />
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
