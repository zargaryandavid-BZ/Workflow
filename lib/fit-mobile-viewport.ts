/**
 * Undo any pinch/focus zoom on phones and tablets so the page fits the screen
 * again. Browsers have no "reset zoom" API; briefly capping the viewport scale
 * at 1 makes iOS Safari and Android Chrome snap back, then the original
 * viewport (with pinch-zoom allowed) is restored.
 */
export function resetMobileZoom(): void {
  if (typeof document === "undefined") return;
  if (!window.matchMedia?.("(pointer: coarse)").matches) return;
  if ((window.visualViewport?.scale ?? 1) <= 1.01) return;

  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) return;
  const original = meta.content;
  meta.content = "width=device-width, initial-scale=1, maximum-scale=1";
  window.setTimeout(() => {
    meta.content = original;
  }, 300);
}

/** Scroll `el`'s nearest scrolling ancestor (and the window) back to the top. */
export function scrollToTopFrom(el: HTMLElement | null): void {
  if (typeof window === "undefined") return;
  let node = el?.parentElement ?? null;
  while (node) {
    const { overflowY } = window.getComputedStyle(node);
    if (/(auto|scroll)/.test(overflowY) && node.scrollHeight > node.clientHeight) {
      node.scrollTo({ top: 0 });
      break;
    }
    node = node.parentElement;
  }
  window.scrollTo({ top: 0 });
}
