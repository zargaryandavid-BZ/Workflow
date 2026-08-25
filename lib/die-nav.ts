export const DIE_QUOTED_COUNT_CHANGED_EVENT =
  "workflow:die-quoted-count-changed";

export function dispatchDieQuotedCountChanged(count?: number) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(DIE_QUOTED_COUNT_CHANGED_EVENT, {
      detail: count != null ? { count } : {},
    })
  );
}
