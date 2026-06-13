import type { BoardColumn } from "@/lib/types";

/** First pipeline column (Start / Create Order) — lowest `position`. */
export function startColumnId(columns: BoardColumn[]): string | undefined {
  if (columns.length === 0) return undefined;
  return [...columns].sort((a, b) => a.position - b.position)[0].id;
}

export function isStartColumn(
  columnId: string,
  columns: BoardColumn[]
): boolean {
  const startId = startColumnId(columns);
  return Boolean(startId && startId === columnId);
}
