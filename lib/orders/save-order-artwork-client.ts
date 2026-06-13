import { isStartColumn } from "@/lib/board-columns";
import type { BoardColumn } from "@/lib/types";

/** Background download of webhook external artwork into Storage. */
export function saveOrderArtwork(orderId: string): void {
  void fetch(`/api/orders/${orderId}/save-all-artwork`, { method: "POST" }).catch(
    (error) => {
      console.warn("Auto-save artwork failed for order", orderId, error);
    }
  );
}

export function maybeSaveArtworkOnLeaveStart(params: {
  orderId: string;
  fromColumnId: string | null | undefined;
  columns: BoardColumn[];
}): void {
  const { orderId, fromColumnId, columns } = params;
  if (!fromColumnId || !isStartColumn(fromColumnId, columns)) return;
  saveOrderArtwork(orderId);
}
