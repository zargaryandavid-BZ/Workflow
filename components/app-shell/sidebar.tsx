"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  Archive,
  BarChart3,
  ChevronDown,
  Clock,
  Columns3,
  Factory,
  FileText,
  FolderOpen,
  FormInput,
  LayoutGrid,
  Link2,
  ListOrdered,
  Mail,
  MessageSquarePlus,
  MousePointerClick,
  Plug,
  Printer,
  Scissors,
  Settings,
  Tag,
  Trash2,
  Truck,
  UserCog,
  Users,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { fetchRetryingStale404 } from "@/lib/fetch-with-auth";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/types";
import { FEEDBACK_COUNT_CHANGED_EVENT } from "@/lib/feedback";
import { SETTINGS_NAV_GROUPS } from "@/lib/settings-nav";
import { TimerWidget } from "@/components/time/TimerWidget";

type NavChild = { href: string; label: string; icon: LucideIcon };

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** When true, only admins see the item (unless `visibleTo` is set). */
  adminOnly?: boolean;
  /** If set, item is shown only when the role is in this list. */
  visibleTo?: Role[];
  /** Click expands these instead of navigating. */
  children?: NavChild[];
};

const SETTINGS_CHILD_ICONS: Record<string, LucideIcon> = {
  "/settings/columns": Columns3,
  "/settings/fields": FormInput,
  "/settings/tags": Tag,
  "/settings/card-warnings": AlertTriangle,
  "/settings/automations": Zap,
  "/settings/button-automation": MousePointerClick,
  "/settings/message-templates": Mail,
  "/settings/integrations": Plug,
  "/settings/gdrive": FolderOpen,
  "/settings/shipping": Truck,
  "/settings/die-manufacturers": Factory,
  "/settings/workspace-links": Link2,
  "/settings/archive": Archive,
  "/settings/removed-orders": Trash2,
  "/settings/emergency-balance": Activity,
  "/settings/team": UserCog,
};

const settingsChildren: NavChild[] = SETTINGS_NAV_GROUPS.flatMap((group) =>
  group.items.map((item) => ({
    href: item.href,
    label: item.label,
    icon: SETTINGS_CHILD_ICONS[item.href] ?? Settings,
  }))
);

const nav: NavItem[] = [
  { href: "/board", label: "Board", icon: LayoutGrid },
  { href: "/queue", label: "Designer Queue", icon: ListOrdered },
  { href: "/customers", label: "Customers", icon: Users },
  {
    href: "/die-order",
    label: "Die Order",
    icon: Scissors,
    visibleTo: ["admin", "account_manager", "preprod_owner"],
  },
  { href: "/time", label: "Time (beta)", icon: Clock },
  { href: "/pdf", label: "PDF", icon: FileText },
  {
    href: "/analytics",
    label: "Analytics",
    icon: BarChart3,
    visibleTo: ["admin", "account_manager"],
  },
  { href: "/feedback", label: "Feedback", icon: MessageSquarePlus },
  {
    href: "/settings",
    label: "Settings",
    icon: Settings,
    adminOnly: true,
    children: settingsChildren,
  },
];

function navItemVisible(item: NavItem, role: Role): boolean {
  if (item.visibleTo) return item.visibleTo.includes(role);
  if (item.adminOnly) return role === "admin";
  return true;
}

interface SidebarProps {
  role: Role;
  open: boolean;
  onClose: () => void;
  dieQuotedCount?: number;
}

export function Sidebar({ role, open, onClose, dieQuotedCount = 0 }: SidebarProps) {
  const pathname = usePathname();
  const [feedbackCount, setFeedbackCount] = useState<number | null>(null);
  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>({});
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
        const res = await fetchRetryingStale404("/api/feedback/count");
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

  useEffect(() => {
    setOpenMenus((prev) => {
      const next = { ...prev };
      for (const item of nav) {
        if (!item.children) continue;
        if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
          next[item.href] = true;
        }
      }
      return next;
    });
  }, [pathname]);

  function handleNavClick() {
    onClose();
  }

  function toggleMenu(href: string) {
    setOpenMenus((prev) => ({ ...prev, [href]: !isMenuOpen(href) }));
  }

  function isMenuOpen(href: string): boolean {
    if (openMenus[href] != null) return openMenus[href];
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  function navLinkClass(href: string, opts?: { nested?: boolean }) {
    const active = pathname === href || pathname.startsWith(`${href}/`);
    return cn(
      "flex items-center gap-3 rounded-md text-sm font-medium transition-colors",
      opts?.nested ? "gap-2 px-2 py-1.5 text-[13px]" : "px-3 py-2",
      active
        ? "bg-blue-50 text-[var(--primary)]"
        : "text-slate-600 hover:bg-slate-100"
    );
  }

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-50 flex w-60 max-w-[85vw] flex-col border-r border-slate-200 bg-white shadow-xl transition-transform duration-200 ease-in-out",
        open ? "translate-x-0" : "pointer-events-none -translate-x-full"
      )}
      aria-hidden={!open}
    >
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-4">
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
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
        <nav className="space-y-1 p-3">
          {nav
            .filter((item) => navItemVisible(item, role))
            .map((item) => {
              const Icon = item.icon;
              const isFeedback = item.href === "/feedback";
              const isDieOrder = item.href === "/die-order";
              const label =
                isFeedback && feedbackCount != null
                  ? `${item.label} (${feedbackCount})`
                  : isDieOrder && dieQuotedCount > 0
                    ? `${item.label} (${dieQuotedCount} quotes)`
                    : item.label;

              if (item.children && item.children.length > 0) {
                const expanded = isMenuOpen(item.href);
                return (
                  <div key={item.href}>
                    <button
                      type="button"
                      onClick={() => toggleMenu(item.href)}
                      className={cn(navLinkClass(item.href), "w-full")}
                      aria-expanded={expanded}
                      aria-controls={`nav-sub-${item.href.replace(/\W+/g, "-")}`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate text-left">
                        {item.label}
                      </span>
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 shrink-0 text-slate-400 transition-transform",
                          expanded && "rotate-180"
                        )}
                      />
                    </button>
                    {expanded ? (
                      <div
                        id={`nav-sub-${item.href.replace(/\W+/g, "-")}`}
                        className="mb-1 ml-4 mt-0.5 space-y-0.5 border-l border-slate-200 pl-2"
                      >
                        {item.children.map((child) => {
                          const ChildIcon = child.icon;
                          return (
                            <Link
                              key={child.href}
                              href={child.href}
                              prefetch={false}
                              onClick={handleNavClick}
                              className={navLinkClass(child.href, {
                                nested: true,
                              })}
                            >
                              <ChildIcon className="h-3.5 w-3.5 shrink-0" />
                              <span className="min-w-0 flex-1 truncate">
                                {child.label}
                              </span>
                            </Link>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={false}
                  onClick={handleNavClick}
                  className={navLinkClass(item.href)}
                  title={isFeedback || isDieOrder ? label : undefined}
                  aria-label={isFeedback || isDieOrder ? label : undefined}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {isFeedback && feedbackCount != null ? (
                    <span
                      className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-slate-200 px-1.5 text-[11px] font-semibold tabular-nums text-slate-600"
                      aria-hidden
                    >
                      {feedbackCount}
                    </span>
                  ) : null}
                  {isDieOrder && dieQuotedCount > 0 ? (
                    <span
                      className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-semibold tabular-nums text-white"
                      aria-hidden
                    >
                      {dieQuotedCount}
                    </span>
                  ) : null}
                </Link>
              );
            })}
        </nav>
        <div className="mt-auto">
          {sidebarReady ? <TimerWidget /> : null}
          <div className="border-t border-slate-200 p-3 text-xs text-slate-400">
            {role === "admin" ? "Admin" : "Member"}
          </div>
        </div>
      </div>
    </aside>
  );
}
