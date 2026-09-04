"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, LogOut, Menu, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn, initials } from "@/lib/utils";
import { ROLE_LABELS } from "@/lib/constants";
import type { Role } from "@/lib/types";
import { BoardHealthButton } from "@/components/app-shell/board-health-button";
import { NotificationInbox } from "@/components/app-shell/notification-inbox";
import { MentionNotificationPopup } from "@/components/app-shell/mention-notification-popup";

interface TopbarProps {
  tenants: { id: string; name: string }[];
  activeTenantId: string;
  userId: string;
  email: string | null;
  fullName: string | null;
  role: Role;
  sidebarOpen: boolean;
  onMenuToggle: () => void;
  boardHealthVisible?: boolean;
  dieQuotedCount?: number;
}

function avatarLetter(fullName: string | null, email: string | null) {
  const fromName = fullName?.trim()[0];
  if (fromName) return fromName.toUpperCase();
  const fromEmail = email?.trim()[0];
  if (fromEmail) return fromEmail.toUpperCase();
  return "?";
}

export function Topbar({
  tenants,
  activeTenantId,
  userId,
  email,
  fullName,
  role,
  sidebarOpen,
  onMenuToggle,
  boardHealthVisible = true,
  dieQuotedCount = 0,
}: TopbarProps) {
  const router = useRouter();
  const [openTenant, setOpenTenant] = useState(false);
  const [openUser, setOpenUser] = useState(false);
  const active = tenants.find((t) => t.id === activeTenantId);

  async function switchTenant(id: string) {
    if (id === activeTenantId) {
      setOpenTenant(false);
      return;
    }
    await fetch("/api/tenant/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: id }),
    });
    setOpenTenant(false);
    router.push("/board");
    router.refresh();
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="relative z-50 flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onMenuToggle}
          className="relative rounded-md p-2 text-slate-600 hover:bg-slate-100"
          aria-label={
            sidebarOpen
              ? "Close menu"
              : dieQuotedCount > 0
                ? `Open menu, ${dieQuotedCount} die quote${dieQuotedCount === 1 ? "" : "s"} waiting`
                : "Open menu"
          }
          aria-expanded={sidebarOpen}
        >
          <Menu className="h-5 w-5" />
          {dieQuotedCount > 0 ? (
            <span
              className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white"
              aria-hidden
            />
          ) : null}
        </button>
        <div className="relative min-w-0">
        <button
          onClick={() => setOpenTenant((o) => !o)}
          className="flex max-w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded bg-slate-200 text-xs font-semibold text-slate-600">
            {initials(active?.name)}
          </span>
          <span className="truncate">{active?.name ?? "Workspace"}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
        </button>
        {openTenant ? (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setOpenTenant(false)}
            />
            <div className="absolute left-0 z-50 mt-1 w-60 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Workspaces
              </div>
              {tenants.map((t) => (
                <button
                  key={t.id}
                  onClick={() => switchTenant(t.id)}
                  className="flex w-full items-center justify-between px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  {t.name}
                  {t.id === activeTenantId ? (
                    <Check className="h-4 w-4 text-[var(--primary)]" />
                  ) : null}
                </button>
              ))}
              {role === "admin" ? (
                <>
                  <div className="my-1 border-t border-slate-100" />
                  <button
                    onClick={() => {
                      setOpenTenant(false);
                      router.push("/onboarding?new=1");
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <Plus className="h-4 w-4" /> New workspace
                  </button>
                </>
              ) : null}
            </div>
          </>
        ) : null}
        </div>
        <BoardHealthButton enabled={boardHealthVisible} />
      </div>

      <div className="relative flex shrink-0 items-center gap-2">
        <NotificationInbox
          userId={userId}
          tenantId={activeTenantId}
          role={role}
        />
        <MentionNotificationPopup userId={userId} />
        <button
          onClick={() => setOpenUser((o) => !o)}
          className={cn(
            "flex items-center gap-2 rounded-md py-0.5 pl-1 pr-1.5 hover:bg-slate-100"
          )}
        >
          {fullName?.trim() ? (
            <span className="hidden max-w-[140px] truncate text-sm font-medium text-slate-700 sm:inline">
              {fullName.trim()}
            </span>
          ) : null}
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--primary)] text-xs font-semibold text-white">
            {avatarLetter(fullName, email)}
          </span>
        </button>
        {openUser ? (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setOpenUser(false)}
            />
            <div className="absolute right-0 z-50 mt-1 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              <div className="px-3 py-2 text-sm text-slate-700">
                {fullName?.trim() ? (
                  <p>
                    <span className="font-medium">{fullName.trim()}</span>
                    <span className="text-slate-500">
                      {": "}
                      {ROLE_LABELS[role]}
                    </span>
                  </p>
                ) : (
                  <p className="font-medium">{ROLE_LABELS[role]}</p>
                )}
                {email ? <p className="text-slate-500">{email}</p> : null}
              </div>
              <div className="my-1 border-t border-slate-100" />
              <button
                onClick={signOut}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </div>
          </>
        ) : null}
      </div>
    </header>
  );
}
