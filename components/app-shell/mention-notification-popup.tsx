"use client";

import { useEffect, useState } from "react";
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

export function MentionNotificationPopup({
  userId,
}: {
  userId: string;
}) {
  const router = useRouter();
  const [queue, setQueue] = useState<UserNotification[]>([]);
  const current = queue[0] ?? null;

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
            if (!n || n.type !== "note_mention") return;
            setQueue((prev) =>
              prev.some((x) => x.id === n.id) ? prev : [...prev, n]
            );
          }
        )
        .subscribe();
    }

    void bind();
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [userId]);

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
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-labelledby="mention-popup-title"
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
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
