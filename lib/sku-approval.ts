export type SkuApprovalDecision = "approved" | "rejected";

export type SkuApprovalEntry = {
  skuId: string;
  index: number;
  name: string;
  decision: SkuApprovalDecision;
};

export type SkuImageApprovalEntry = {
  skuId: string;
  skuIndex: number;
  skuName: string;
  assetId: string;
  imageIndex: number;
  decision: SkuApprovalDecision;
};

export type ParsedSkuApprovalEntry = {
  index: number;
  name: string;
  decision: SkuApprovalDecision;
};

export type ParsedSkuImageApproval = {
  skuIndex: number;
  skuName: string;
  imageIndex: number;
  decision: SkuApprovalDecision;
};

const LINE_RE =
  /^SKU (\d+)(?: — (.*?))?: (Approved|Not approved)\s*$/;

const LINE_IMAGE_RE =
  /^SKU (\d+)(?: — (.*?))? — Image (\d+): (Approved|Not approved)\s*$/;

export function skuLabel(index: number, name?: string | null): string {
  const trimmed = name?.trim() ?? "";
  return trimmed ? `SKU ${index} — ${trimmed}` : `SKU ${index}`;
}

export function imageDecisionKey(skuId: string, assetId: string): string {
  return `${skuId}::${assetId}`;
}

/** Gallery file for Image N, or `pdfpage:N` when that slot is a PDF page. */
export function approvalImageAssetId(
  imageIndex: number,
  gallery: { id: string }[]
): string {
  return gallery[imageIndex - 1]?.id ?? `pdfpage:${imageIndex}`;
}

/** Photos → one slot per file. PDF multilayer → one slot per page. */
export function approvalSlotAssetId(
  imageIndex: number,
  gallery: { id: string }[],
  pdfPageCount = 0
): string {
  if (pdfPageCount > 1) return `pdfpage:${imageIndex}`;
  return approvalImageAssetId(imageIndex, gallery);
}

/** How many Image 1…N slots. PDF pages count when the PDF is open (page count > 1). */
export function approvalImageSlotCount(
  galleryLength: number,
  pdfPageCount = 0,
  /** 1-based page when this SKU is locked to one page of a shared PDF. */
  pdfLockedPage?: number | null
): number {
  if (pdfLockedPage != null) return 1;
  if (galleryLength >= 2 || pdfPageCount > 1) {
    return Math.max(galleryLength, pdfPageCount);
  }
  return galleryLength;
}

export function rollupSkuDecisionFromImages(
  decisions: (SkuApprovalDecision | undefined)[]
): SkuApprovalDecision | undefined {
  if (decisions.length === 0) return undefined;
  if (decisions.some((d) => d === "rejected")) return "rejected";
  if (decisions.every((d) => d === "approved")) return "approved";
  return undefined;
}

function decisionLabel(decision: SkuApprovalDecision): string {
  return decision === "approved" ? "Approved" : "Not approved";
}

/**
 * @param imageEntriesOrComment Image rows, or (legacy) the free-text comment.
 * @param comment Used when the second argument is image entries.
 */
export function formatSkuApprovalNote(
  entries: SkuApprovalEntry[],
  imageEntriesOrComment: SkuImageApprovalEntry[] | string = [],
  comment = ""
): string {
  const imageEntries = Array.isArray(imageEntriesOrComment)
    ? imageEntriesOrComment
    : [];
  const extra = (
    typeof imageEntriesOrComment === "string"
      ? imageEntriesOrComment
      : comment
  ).trim();

  const lines: string[] = [];
  if (imageEntries.length === 0) {
    for (const entry of entries) {
      lines.push(
        `${skuLabel(entry.index, entry.name)}: ${decisionLabel(entry.decision)}`
      );
    }
  } else {
    const skuIndexes = [
      ...new Set([
        ...entries.map((e) => e.index),
        ...imageEntries.map((e) => e.skuIndex),
      ]),
    ].sort((a, b) => a - b);
    for (const idx of skuIndexes) {
      const imgs = imageEntries
        .filter((e) => e.skuIndex === idx)
        .sort((a, b) => a.imageIndex - b.imageIndex);
      if (imgs.length > 0) {
        const same = imgs.every((img) => img.decision === imgs[0]!.decision);
        if (same) {
          lines.push(
            `${skuLabel(imgs[0]!.skuIndex, imgs[0]!.skuName)}: ${decisionLabel(imgs[0]!.decision)}`
          );
          continue;
        }
        for (const img of imgs) {
          lines.push(
            `${skuLabel(img.skuIndex, img.skuName)} — Image ${img.imageIndex}: ${decisionLabel(img.decision)}`
          );
        }
        continue;
      }
      const sku = entries.find((e) => e.index === idx);
      if (sku) {
        lines.push(
          `${skuLabel(sku.index, sku.name)}: ${decisionLabel(sku.decision)}`
        );
      }
    }
  }

  if (lines.length === 0) return extra;
  return extra ? `${lines.join("\n")}\n\n${extra}` : lines.join("\n");
}

export function parseSkuApprovalNote(note: string | null | undefined): {
  entries: ParsedSkuApprovalEntry[];
  imageEntries: ParsedSkuImageApproval[];
  comment: string | null;
} {
  const raw = note?.trim() ?? "";
  if (!raw) return { entries: [], imageEntries: [], comment: null };

  const lines = raw.split("\n");
  const entries: ParsedSkuApprovalEntry[] = [];
  const imageEntries: ParsedSkuImageApproval[] = [];
  let i = 0;
  for (; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "") break;
    const imageMatch = LINE_IMAGE_RE.exec(line);
    if (imageMatch) {
      imageEntries.push({
        skuIndex: Number(imageMatch[1]),
        skuName: imageMatch[2] ?? "",
        imageIndex: Number(imageMatch[3]),
        decision: imageMatch[4] === "Approved" ? "approved" : "rejected",
      });
      continue;
    }
    const match = LINE_RE.exec(line);
    if (!match) break;
    entries.push({
      index: Number(match[1]),
      name: match[2] ?? "",
      decision: match[3] === "Approved" ? "approved" : "rejected",
    });
  }
  if (entries.length === 0 && imageEntries.length === 0) {
    return { entries: [], imageEntries: [], comment: raw };
  }
  while (i < lines.length && lines[i].trim() === "") i += 1;
  const comment = lines.slice(i).join("\n").trim();
  return { entries, imageEntries, comment: comment || null };
}

export function decisionsBySkuId(
  skus: { id: string }[],
  entries: { index: number; decision: SkuApprovalDecision }[],
  imageEntries: { skuIndex: number; decision: SkuApprovalDecision }[] = []
): Record<string, SkuApprovalDecision> {
  const byId: Record<string, SkuApprovalDecision> = {};
  for (const entry of entries) {
    const sku = skus[entry.index - 1];
    if (sku) byId[sku.id] = entry.decision;
  }
  const byIndex = new Map<number, SkuApprovalDecision[]>();
  for (const img of imageEntries) {
    const list = byIndex.get(img.skuIndex) ?? [];
    list.push(img.decision);
    byIndex.set(img.skuIndex, list);
  }
  for (const [skuIndex, decisions] of byIndex) {
    const sku = skus[skuIndex - 1];
    if (!sku) continue;
    const rolled = rollupSkuDecisionFromImages(decisions);
    if (rolled) byId[sku.id] = rolled;
  }
  return byId;
}

export function imageDecisionsByKey(
  skus: { id: string }[],
  imagesBySkuId: Record<string, { id: string }[]>,
  imageEntries: {
    skuIndex: number;
    imageIndex: number;
    decision: SkuApprovalDecision;
  }[]
): Record<string, SkuApprovalDecision> {
  const countBySku = new Map<number, number>();
  for (const entry of imageEntries) {
    countBySku.set(entry.skuIndex, (countBySku.get(entry.skuIndex) ?? 0) + 1);
  }
  const byKey: Record<string, SkuApprovalDecision> = {};
  for (const entry of imageEntries) {
    const sku = skus[entry.skuIndex - 1];
    if (!sku) continue;
    const gallery = imagesBySkuId[sku.id] ?? [];
    const decided = countBySku.get(entry.skuIndex) ?? 0;
    const assetId =
      decided > gallery.length
        ? `pdfpage:${entry.imageIndex}`
        : gallery[entry.imageIndex - 1]?.id ?? `pdfpage:${entry.imageIndex}`;
    byKey[imageDecisionKey(sku.id, assetId)] = entry.decision;
  }
  return byKey;
}

export function overallApprovalResponse(
  entries: { decision: SkuApprovalDecision }[]
): "approved" | "changes_requested" {
  return entries.some((entry) => entry.decision === "rejected")
    ? "changes_requested"
    : "approved";
}

export function skuApprovalDisplayLines(parsed: {
  entries: ParsedSkuApprovalEntry[];
  imageEntries: ParsedSkuImageApproval[];
}): { key: string; label: string; decision: SkuApprovalDecision }[] {
  const lines: { key: string; label: string; decision: SkuApprovalDecision }[] =
    [];
  const skuIndexes = [
    ...new Set([
      ...parsed.entries.map((e) => e.index),
      ...parsed.imageEntries.map((e) => e.skuIndex),
    ]),
  ].sort((a, b) => a - b);
  for (const idx of skuIndexes) {
    const imgs = parsed.imageEntries
      .filter((e) => e.skuIndex === idx)
      .sort((a, b) => a.imageIndex - b.imageIndex);
    if (imgs.length > 0) {
      const same = imgs.every((img) => img.decision === imgs[0]!.decision);
      if (same) {
        lines.push({
          key: `sku-${idx}`,
          label: skuLabel(imgs[0]!.skuIndex, imgs[0]!.skuName),
          decision: imgs[0]!.decision,
        });
        continue;
      }
      for (const img of imgs) {
        lines.push({
          key: `img-${idx}-${img.imageIndex}`,
          label: `${skuLabel(img.skuIndex, img.skuName)} — Image ${img.imageIndex}`,
          decision: img.decision,
        });
      }
      continue;
    }
    const sku = parsed.entries.find((e) => e.index === idx);
    if (sku) {
      lines.push({
        key: `sku-${idx}`,
        label: skuLabel(sku.index, sku.name),
        decision: sku.decision,
      });
    }
  }
  return lines;
}
