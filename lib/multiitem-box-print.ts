export type PrintableBoxCandidate = {
  id: string;
  name: string;
  items: unknown[];
};

/** Split a requested box set without silently generating empty slips. */
export function partitionBoxesForSlip<T extends PrintableBoxCandidate>(
  boxes: T[]
): { printable: T[]; empty: T[] } {
  const printable: T[] = [];
  const empty: T[] = [];
  for (const box of boxes) {
    (box.items.length > 0 ? printable : empty).push(box);
  }
  return { printable, empty };
}

export type BoxSlipAssignment = {
  boxId: string;
  shipmentBoxNumber: number;
  shipmentBoxCount: number;
  palletNumber: number | null;
  palletCount: number | null;
  palletBoxNumber: number | null;
  palletBoxCount: number | null;
};

export function distributeBoxIdsAcrossPallets(
  boxIds: string[],
  requestedPalletCount: number
): string[][] {
  if (boxIds.length === 0) return [];
  const palletCount = Math.max(
    1,
    Math.min(boxIds.length, Math.floor(requestedPalletCount))
  );
  const baseSize = Math.floor(boxIds.length / palletCount);
  const extra = boxIds.length % palletCount;
  const groups: string[][] = [];
  let boxIndex = 0;
  for (let palletIndex = 0; palletIndex < palletCount; palletIndex++) {
    const groupSize = baseSize + (palletIndex < extra ? 1 : 0);
    groups.push(boxIds.slice(boxIndex, boxIndex + groupSize));
    boxIndex += groupSize;
  }
  return groups;
}

export function buildBoxSlipAssignmentsFromPallets(
  palletBoxIds: string[][]
): BoxSlipAssignment[] {
  const shipmentBoxCount = palletBoxIds.reduce(
    (total, group) => total + group.length,
    0
  );
  const palletCount = palletBoxIds.length;
  let shipmentBoxNumber = 0;
  return palletBoxIds.flatMap((group, palletIndex) =>
    group.map((boxId, boxIndex) => {
      shipmentBoxNumber += 1;
      return {
        boxId,
        shipmentBoxNumber,
        shipmentBoxCount,
        palletNumber: palletIndex + 1,
        palletCount,
        palletBoxNumber: boxIndex + 1,
        palletBoxCount: group.length,
      };
    })
  );
}

/**
 * Assign selected boxes in display order. Pallet loads are balanced, with any
 * remainder placed on the earliest pallets.
 */
export function buildBoxSlipAssignments(
  boxIds: string[],
  requestedPalletCount: number | null
): BoxSlipAssignment[] {
  const shipmentBoxCount = boxIds.length;
  if (shipmentBoxCount === 0) return [];

  const palletCount =
    requestedPalletCount == null
      ? null
      : Math.max(1, Math.min(shipmentBoxCount, Math.floor(requestedPalletCount)));
  if (palletCount == null) {
    return boxIds.map((boxId, index) => ({
      boxId,
      shipmentBoxNumber: index + 1,
      shipmentBoxCount,
      palletNumber: null,
      palletCount: null,
      palletBoxNumber: null,
      palletBoxCount: null,
    }));
  }

  return buildBoxSlipAssignmentsFromPallets(
    distributeBoxIdsAcrossPallets(boxIds, palletCount)
  );
}
