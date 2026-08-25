"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { fetchRetryingStale404 } from "@/lib/fetch-with-auth";
import { DIE_QUOTED_COUNT_CHANGED_EVENT } from "@/lib/die-nav";
import { canViewDieOrder } from "@/lib/permissions";
import type { Role } from "@/lib/types";

export function useDieQuotedCount(role: Role): number {
  const pathname = usePathname();
  const [count, setCount] = useState(0);
  const enabled = canViewDieOrder(role);

  useEffect(() => {
    if (!enabled) {
      setCount(0);
      return;
    }

    let cancelled = false;

    async function loadCount() {
      try {
        const res = await fetchRetryingStale404("/api/die-requests/quoted-count");
        if (!res.ok) return;
        const json = (await res.json()) as { count?: number };
        if (!cancelled && typeof json.count === "number") {
          setCount(json.count);
        }
      } catch {
        // Non-fatal — nav still works without the badge.
      }
    }

    void loadCount();
    const interval = window.setInterval(() => void loadCount(), 30_000);

    function onFocus() {
      void loadCount();
    }
    function onCountChanged(e: Event) {
      const detail = (e as CustomEvent<{ count?: number }>).detail;
      if (typeof detail?.count === "number") {
        setCount(detail.count);
        return;
      }
      void loadCount();
    }

    window.addEventListener("focus", onFocus);
    window.addEventListener(DIE_QUOTED_COUNT_CHANGED_EVENT, onCountChanged);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(DIE_QUOTED_COUNT_CHANGED_EVENT, onCountChanged);
    };
  }, [enabled, pathname]);

  return enabled ? count : 0;
}
