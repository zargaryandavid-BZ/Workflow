"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { fetchRetryingStale404 } from "@/lib/fetch-with-auth";
import type { UserNotification } from "@/lib/user-notifications";

function asNotification(row: Record<string, unknown>): UserNotification | null {
  if (typeof row.id !== "string" || typeof row.user_id !== "string") return null;
  if (typeof row.type !== "string") return null;
  return {
    id: row.id,
    tenant_id: typeof row.tenant_id === "string" ? row.tenant_id : "",
    user_id: row.user_id,
    type: row.type,
    title: typeof row.title === "string" ? row.title : "",
    body: typeof row.body === "string" ? row.body : null,
    order_id: typeof row.order_id === "string" ? row.order_id : null,
    actor_id: typeof row.actor_id === "string" ? row.actor_id : null,
    actor_name: typeof row.actor_name === "string" ? row.actor_name : null,
    read_at: typeof row.read_at === "string" ? row.read_at : null,
    created_at: typeof row.created_at === "string" ? row.created_at : "",
  };
}

const RECENT_MS = 10 * 60 * 1000;

export function MentionNotificationPopup({
  userId,
}: {
  userId: string;
}) {
  const router = useRouter();
  const [queue, setQueue] = useState<UserNotification[]>([]);
  const current = queue[0] ?? null;

  const enqueue = useCallback(
    (n: UserNotification) => {
      // Only the mentioned teammate — never the person who wrote the note.
      if (n.type !== "note_mention") return;
      if (n.user_id !== userId) return;
      if (n.actor_id && n.actor_id === userId) return;
      setQueue((prev) =>
        prev.some((x) => x.id === n.id) ? prev : [...prev, n]
      );
    },
    [userId]
  );

  useEffect(() => {
    if (!userId) return;
    const cutoff = Date.now() - RECENT_MS;
    void fetchRetryingStale404("/api/user-notifications", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json()) as { notifications?: UserNotification[] };
        for (const n of json.notifications ?? []) {
          if (n.read_at) continue;
          const t = new Date(n.created_at).getTime();
          if (!Number.isFinite(t) || t < cutoff) continue;
          enqueue(n);
        }
      })
      .catch(() => undefined);
  }, [userId, enqueue]);

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

      channel = supabase
        .channel(`note-mention-popup-${userId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "user_notifications",
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            const n = asNotification(
              (payload.new ?? {}) as Record<string, unknown>
            );
            if (n) enqueue(n);
          }
        )
        .subscribe();
    }

    void bind();
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [userId, enqueue]);

  function dismiss() {
    const id = current?.id;
    setQueue((prev) => prev.slice(1));
    if (id) {
      void fetchRetryingStale404(`/api/user-notifications/${id}`, {
        method: "PATCH",
      }).catch(() => undefined);
    }
  }

  function openJob() {
    const orderId = current?.order_id;
    dismiss();
    if (orderId) {
      router.push(`/board?order=${encodeURIComponent(orderId)}`);
    }
  }

  if (!current || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed left-0 top-0 z-[220] flex h-[100dvh] w-screen items-center justify-center bg-black/40 p-4"
      role="presentation"
    >
      <div
        role="dialog"
        aria-labelledby="mention-popup-title"
        className="relative mx-auto w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Mentioned you
          {current.actor_name ? (
            <span className="font-normal text-slate-500">
              {" "}
              · {current.actor_name}
            </span>
          ) : null}
        </p>
        <p
          id="mention-popup-title"
          className="mt-3 whitespace-pre-wrap text-sm text-slate-900"
        >
          {current.body?.trim() || "You were mentioned in a note."}
        </p>
        {current.order_id ? (
          <button
            type="button"
            onClick={openJob}
            className="mt-4 text-left text-base font-semibold text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900"
          >
            {current.title || "Open job"}
          </button>
        ) : (
          <p className="mt-4 text-base font-semibold text-slate-800">
            {current.title}
          </p>
        )}
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={dismiss}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
