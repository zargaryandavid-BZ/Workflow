"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  dedupedFetchRetryingStale404,
  fetchRetryingStale404,
} from "@/lib/fetch-with-auth";
import { cn } from "@/lib/utils";
import type { UserNotification } from "@/lib/user-notifications";
import type { Role } from "@/lib/types";

function formatStamp(iso: string): { time: string; date: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { time: "", date: "" };
  return {
    time: d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }),
    date: d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
  };
}

export function NotificationInbox({
  userId,
  tenantId,
  role,
}: {
  userId: string;
  tenantId: string;
  role: Role;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<UserNotification[]>([]);

  const isAdmin = role === "admin";

  const load = useCallback(async () => {
    try {
      const res = await dedupedFetchRetryingStale404("/api/user-notifications", {
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = (await res.json()) as { notifications?: UserNotification[] };
      if (Array.isArray(json.notifications)) setItems(json.notifications);
    } catch {
      // Non-fatal — inbox still renders empty.
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 30_000);
    function onFocus() {
      void load();
    }
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function bind() {
      const { data: sessionData } = await supabase.auth.getSession();
      if (cancelled) return;
      const token = sessionData.session?.access_token;
      if (token) await supabase.realtime.setAuth(token);
      if (cancelled) return;

      const filter = isAdmin
        ? `tenant_id=eq.${tenantId}`
        : `user_id=eq.${userId}`;

      channel = supabase
        .channel(`user-notifications-${isAdmin ? tenantId : userId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "user_notifications",
            filter,
          },
          () => {
            void load();
          }
        )
        .subscribe();
    }

    void bind();
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [userId, tenantId, isAdmin, load]);

  // Badge = MY unread only. Admins see the team's notifications in the list,
  // but teammates' unread items no longer keep the top-right badge lit.
  const isMine = useCallback((n: UserNotification) => n.user_id === userId, [userId]);
  const unreadCount = useMemo(
    () => items.filter((n) => isMine(n) && !n.read_at).length,
    [items, isMine]
  );
  const preview = useMemo(
    () =>
      items.find((n) => isMine(n) && !n.read_at) ??
      items.find((n) => isMine(n)) ??
      items[0] ??
      null,
    [items, isMine]
  );
  const previewStamp = preview ? formatStamp(preview.created_at) : null;

  async function markUnread(id: string) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: null } : n)));
    await fetchRetryingStale404(`/api/user-notifications/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unread: true }),
    }).catch(() => undefined);
  }

  async function markRead(id: string) {
    setItems((prev) =>
      prev.map((n) =>
        n.id === id ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n
      )
    );
    await fetchRetryingStale404(`/api/user-notifications/${id}`, {
      method: "PATCH",
    }).catch(() => undefined);
  }

  async function markAllRead() {
    const now = new Date().toISOString();
    setItems((prev) =>
      prev.map((n) => (isMine(n) ? { ...n, read_at: n.read_at ?? now } : n))
    );
    await fetchRetryingStale404("/api/user-notifications", {
      method: "PATCH",
    }).catch(() => undefined);
  }

  function openItem(n: UserNotification) {
    if (isMine(n)) void markRead(n.id);
    setOpen(false);
    if (n.order_id) {
      router.push(`/board?order=${encodeURIComponent(n.order_id)}`);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex max-w-[220px] items-center gap-2 rounded-md border px-2 py-1 text-left transition-colors",
          unreadCount > 0
            ? "border-amber-200 bg-amber-50 hover:bg-amber-100"
            : "border-slate-200 bg-white hover:bg-slate-50"
        )}
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : "Notifications"
        }
        aria-expanded={open}
      >
        <span className="relative shrink-0">
          <Bell
            className={cn(
              "h-4 w-4",
              unreadCount > 0 ? "text-amber-700" : "text-slate-500"
            )}
          />
          {unreadCount > 0 ? (
            <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />
          ) : null}
        </span>
        {preview && previewStamp ? (
          <span className="min-w-0">
            <span className="block truncate text-[11px] leading-tight text-slate-500">
              {previewStamp.time}
              <span className="mx-1 text-slate-300">·</span>
              {previewStamp.date}
            </span>
            <span className="block truncate text-xs font-medium text-slate-700">
              {preview.title}
            </span>
          </span>
        ) : (
          <span className="truncate text-xs text-slate-500">No notifications</span>
        )}
      </button>
      {open ? (
        <>
          <div
            className="fixed inset-0 z-[60]"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full z-[70] mt-1 w-80 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                {isAdmin ? "All notifications" : "Notifications"}
              </p>
              {unreadCount > 0 ? (
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  className="text-xs font-medium text-[var(--primary)] hover:underline"
                >
                  Mark all read
                </button>
              ) : null}
            </div>
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-slate-500">
                {isAdmin
                  ? "No notifications in this workspace yet."
                  : "You have no notifications yet."}
              </p>
            ) : (
              <ul className="max-h-80 overflow-y-auto py-1">
                {items.map((n) => {
                  const stamp = formatStamp(n.created_at);
                  return (
                    <li
                      key={n.id}
                      className={cn(
                        "group relative",
                        !n.read_at && isMine(n) ? "bg-amber-50/70" : ""
                      )}
                    >
                      {isMine(n) ? (
                        <button
                          type="button"
                          onClick={() =>
                            void (n.read_at ? markUnread(n.id) : markRead(n.id))
                          }
                          className="absolute right-2 top-2 z-10 rounded px-1.5 py-0.5 text-[10px] font-medium text-slate-500 opacity-70 hover:bg-white hover:text-slate-800 hover:opacity-100 group-hover:opacity-100"
                          title={n.read_at ? "Mark as unread" : "Mark as read"}
                        >
                          {n.read_at ? "Mark unread" : "Mark read"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => openItem(n)}
                        className="flex w-full flex-col gap-0.5 px-3 py-2 pr-20 text-left hover:bg-slate-50/80"
                      >
                        <span className="text-[11px] text-slate-500">
                          {stamp.time}
                          <span className="mx-1 text-slate-300">·</span>
                          {stamp.date}
                          {n.actor_name ? (
                            <>
                              <span className="mx-1 text-slate-300">·</span>
                              {n.actor_name}
                            </>
                          ) : null}
                          {isAdmin && n.recipient_name ? (
                            <>
                              <span className="mx-1 text-slate-300">·</span>
                              For {n.recipient_name}
                            </>
                          ) : null}
                        </span>
                        <span className="text-sm font-medium text-slate-800">
                          {n.title}
                        </span>
                        {n.body ? (
                          <span className="line-clamp-2 text-xs text-slate-500">
                            {n.body}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
