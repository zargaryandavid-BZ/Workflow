export type ApprovalPreviewIndexRef = {
  fileId: string;
  rev: string;
  pages?: number[];
  bySku?: Record<string, unknown>;
};

export type DrivePdfSourceRef = {
  fileId: string;
  rev: string;
};

export function indexHasLayerPictures(
  index: ApprovalPreviewIndexRef | null | undefined
): boolean {
  if (!index?.fileId || !index.rev) return false;
  if (!index.pages?.length) return false;
  return Object.keys(index.bySku ?? {}).length > 0;
}

/** True when stored /respond JPEGs are missing or from a different Drive PDF. */
export function approvalPreviewIsStale(
  index: ApprovalPreviewIndexRef | null | undefined,
  source: DrivePdfSourceRef
): boolean {
  if (!indexHasLayerPictures(index)) return true;
  return index!.fileId !== source.fileId || index!.rev !== source.rev;
}

/**
 * Board/status refresh: only rebuild when pictures already exist and the
 * Final PDF on Drive is a different file or a newer revision.
 */
export function shouldRebuildStoredProofs(
  index: ApprovalPreviewIndexRef | null | undefined,
  source: DrivePdfSourceRef
): boolean {
  if (!indexHasLayerPictures(index)) return false;
  return approvalPreviewIsStale(index, source);
}

/** Bump when proof raster encoding changes so old images are rebuilt.
 *  "tl" = transparent per-layer overlays + lower-res cap. */
export const PROOF_RASTER_TAG = "png-tl";

export function proofRasterRev(modifiedTime: string): string {
  const t = modifiedTime.trim() || "unknown";
  const suffix = `-${PROOF_RASTER_TAG}`;
  return t.endsWith(suffix) ? t : `${t}${suffix}`;
}

export function drivePdfFingerprint(fileId: string, modifiedTime: string): string {
  return `${fileId.trim()}:${modifiedTime.trim()}`;
}
