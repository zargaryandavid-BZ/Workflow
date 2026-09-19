/** Pad packing-box numbers so 1 and 01 sort the same. */
export function padBoxNumber(n: number): string {
  return String(n).padStart(2, "0");
}

function usedInts(taken: string[]): Set<number> {
  const used = new Set<number>();
  for (const raw of taken) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1) used.add(n);
  }
  return used;
}

/** Next free 1, 2, 3… skipping numbers already used (no 1, 3 gap). */
export function nextAvailableBoxNumbers(
  taken: string[],
  count: number
): string[] {
  const used = usedInts(taken);
  const out: string[] = [];
  for (let n = 1; out.length < count; n++) {
    if (used.has(n)) continue;
    out.push(padBoxNumber(n));
    used.add(n);
  }
  return out;
}

export type BoxNumberRow = { id: string; box_number: string };

/** Reassign open boxes to 1, 2, 3… in current order. */
export function sequentialOpenRenumber(
  openSorted: BoxNumberRow[],
  _closedNumbers: string[] = []
): { id: string; box_number: string }[] {
  return openSorted.map((box, i) => ({
    id: box.id,
    box_number: padBoxNumber(i + 1),
  }));
}
