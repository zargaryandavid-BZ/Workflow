"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  Archive,
  AlertTriangle,
  BarChart3,
  Clock,
  LayoutGrid,
  Link2,
  ListChecks,
  Plug,
  Package,
  HardDrive,
  MessageSquarePlus,
  Tag,
  Trash2,
  Workflow,
  MousePointerClick,
  ShieldAlert,
  UserCog,
  Columns3,
  Mail,
  Printer,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/types";
import { FEEDBACK_COUNT_CHANGED_EVENT } from "@/lib/feedback";
import { TimerWidget } from "@/components/time/TimerWidget";

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutGrid;
  /** When true, only admins see the item (unless `visibleTo` is set). */
  adminOnly?: boolean;
  /** If set, item is shown only when the role is in this list. */
  visibleTo?: Role[];
};

const nav: NavItem[] = [
  { href: "/board", label: "Board", icon: LayoutGrid },
  {
    href: "/analytics",
    label: "Analytics",
    icon: BarChart3,
    visibleTo: ["admin", "account_manager"],
  },
  { href: "/time", label: "Time (beta)", icon: Clock },
  { href: "/customers", label: "Customers", icon: Users },
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
    href: "/settings/tags",
    label: "Tags",
    icon: Tag,
    adminOnly: true,
  },
  {
    href: "/settings/automations",
    label: "Automations",
    icon: Workflow,
    adminOnly: true,
  },
  {
    href: "/settings/workspace-links",
    label: "Workspace links",
    icon: Link2,
    adminOnly: true,
  },
  {
    href: "/settings/button-automation",
    label: "Button Automation",
    icon: MousePointerClick,
    adminOnly: true,
  },
  {
    href: "/settings/message-templates",
    label: "SMS / Email templates",
    icon: Mail,
    adminOnly: true,
  },
  {
    href: "/settings/card-warnings",
    label: "Card Warnings",
    icon: ShieldAlert,
    adminOnly: true,
  },
  {
    href: "/settings/emergency-balance",
    label: "Emergency Balance",
    icon: AlertTriangle,
    adminOnly: true,
  },
  {
    href: "/settings/integrations",
    label: "Integrations",
    icon: Plug,
    adminOnly: true,
  },
  {
    href: "/settings/shipping",
    label: "Shipping",
    icon: Package,
    adminOnly: true,
  },
  {
    href: "/settings/gdrive",
    label: "GDrive",
    icon: HardDrive,
    adminOnly: true,
  },
  {
    href: "/settings/archive",
    label: "Archive",
    icon: Archive,
    adminOnly: true,
  },
  {
    href: "/settings/removed-orders",
    label: "Removed Orders",
    icon: Trash2,
    adminOnly: true,
  },
  { href: "/settings/team", label: "Team", icon: UserCog, adminOnly: true },
];

function navItemVisible(item: NavItem, role: Role): boolean {
  if (item.visibleTo) return item.visibleTo.includes(role);
  if (item.adminOnly) return role === "admin";
  return true;
}

const feedbackNav = {
  href: "/feedback",
  label: "Feedback",
  icon: MessageSquarePlus,
};

interface SidebarProps {
  role: Role;
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ role, open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const [feedbackCount, setFeedbackCount] = useState<number | null>(null);
  // Defer timer + feedback fetches until after first paint so they don't
  // compete with the board's column-order requests on cold start.
  const [sidebarReady, setSidebarReady] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setSidebarReady(true), 300);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!sidebarReady) return;

    let cancelled = false;

    async function loadCount() {
      try {
        const res = await fetch("/api/feedback/count");
        if (!res.ok) return;
        const json = (await res.json()) as { count?: number };
        if (!cancelled && typeof json.count === "number") {
          setFeedbackCount(json.count);
        }
      } catch {
        // Non-fatal — nav still works without the badge.
      }
    }

    void loadCount();

    function onFocus() {
      void loadCount();
    }
    function onCountChanged(e: Event) {
      const detail = (e as CustomEvent<{ count?: number }>).detail;
      if (typeof detail?.count === "number") {
        setFeedbackCount(detail.count);
      }
    }
    window.addEventListener("focus", onFocus);
    window.addEventListener(FEEDBACK_COUNT_CHANGED_EVENT, onCountChanged);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(FEEDBACK_COUNT_CHANGED_EVENT, onCountChanged);
    };
  }, [pathname, sidebarReady]);

  function handleNavClick() {
    if (window.matchMedia("(max-width: 767px)").matches) {
      onClose();
    }
  }

  function navLinkClass(href: string) {
    const active = pathname === href || pathname.startsWith(`${href}/`);
    return cn(
      "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
      active
        ? "bg-blue-50 text-[var(--primary)]"
        : "text-slate-600 hover:bg-slate-100"
    );
  }

  const FeedbackIcon = feedbackNav.icon;
  const feedbackLabel =
    feedbackCount != null
      ? `${feedbackNav.label} (${feedbackCount})`
      : feedbackNav.label;

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
          prefetch={false}
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
          .filter((item) => navItemVisible(item, role))
          .map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={false}
                onClick={handleNavClick}
                className={navLinkClass(item.href)}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
      </nav>
      <div className="border-t border-slate-200 p-3">
        <Link
          href={feedbackNav.href}
          prefetch={false}
          onClick={handleNavClick}
          className={navLinkClass(feedbackNav.href)}
          title={feedbackLabel}
          aria-label={feedbackLabel}
        >
          <FeedbackIcon className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{feedbackNav.label}</span>
          {feedbackCount != null ? (
            <span
              className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-slate-200 px-1.5 text-[11px] font-semibold tabular-nums text-slate-600"
              aria-hidden
            >
              {feedbackCount}
            </span>
          ) : null}
        </Link>
      </div>
      {sidebarReady ? <TimerWidget /> : null}
      <div className="border-t border-slate-200 p-3 text-xs text-slate-400">
        {role === "admin" ? "Admin" : "Member"}
      </div>
    </aside>
  );
}
