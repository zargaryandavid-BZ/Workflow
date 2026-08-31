/**
 * Fired in the browser when a card's designer-queue position changes, so the
 * board can update the rank badges without a full refetch.
 */
export const QUEUE_CHANGED_EVENT = "workflow:designer-queue-changed";

export type QueueChangedDetail = {
  designerId: string;
  /** order id → new 0-based queue position for that designer */
  posById: Record<string, number>;
};

export function notifyQueueChanged(detail: QueueChangedDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(QUEUE_CHANGED_EVENT, { detail }));
}
