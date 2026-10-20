"use client";

import { useEffect, useRef } from "react";
import { CARD_IMAGE_CHANGED_EVENT } from "@/lib/card-image";
import { fetchWithAuth } from "@/lib/fetch-with-auth";

/** Orders already asked this page-load (hit or miss) — never ask twice. */
const requested = new Set<string>();

/**
 * List rows have no Kanban card mounted, so a picture that lives only in the
 * Drive card image (`/api/orders/[id]/card-image`, what the card fetches when
 * it has no DB thumbnail) never reached the list. When a row with no picture
 * scrolls into view, ask once and broadcast the same event the card uses —
 * the board stores it for list rows and cards alike. Server caches 10 min.
 */
export function useListCardImage(orderId: string, hasThumb: boolean) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (hasThumb || requested.has(orderId)) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    let cancelled = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        if (requested.has(orderId)) return;
        requested.add(orderId);
        void fetchWithAuth(`/api/orders/${orderId}/card-image`)
          .then((res) => (res.ok ? res.json() : null))
          .then((json: { id?: string; url?: string; source?: string } | null) => {
            if (cancelled || !json?.id || !json.url) return;
            window.dispatchEvent(
              new CustomEvent(CARD_IMAGE_CHANGED_EVENT, {
                detail: {
                  orderId,
                  id: json.id,
                  source: json.source === "asset" ? "asset" : "sku_image",
                  url: json.url,
                },
              })
            );
          })
          .catch(() => {
            requested.delete(orderId);
          });
      },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [orderId, hasThumb]);

  return ref;
}

/** Invisible marker element that runs `useListCardImage` for one row. */
export function ListCardImageFallback({
  orderId,
  hasThumb,
}: {
  orderId: string;
  hasThumb: boolean;
}) {
  const ref = useListCardImage(orderId, hasThumb);
  if (hasThumb) return null;
  return <span ref={ref} aria-hidden className="inline-block h-px w-px" />;
}
