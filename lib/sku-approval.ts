export type SkuApprovalDecision = "approved" | "rejected";

export type SkuApprovalEntry = {
  skuId: string;
  index: number;
  name: string;
  decision: SkuApprovalDecision;
};

const LINE_RE =
  /^SKU (\d+)(?: — (.*?))?: (Approved|Not approved)\s*$/;

export function skuLabel(index: number, name?: string | null): string {
  const trimmed = name?.trim() ?? "";
  return trimmed ? `SKU ${index} — ${trimmed}` : `SKU ${index}`;
}

export function formatSkuApprovalNote(
  entries: SkuApprovalEntry[],
  comment: string
): string {
  const lines = entries.map(
    (entry) =>
      `${skuLabel(entry.index, entry.name)}: ${
        entry.decision === "approved" ? "Approved" : "Not approved"
      }`
  );
  const extra = comment.trim();
  return extra ? `${lines.join("\n")}\n\n${extra}` : lines.join("\n");
}

export function parseSkuApprovalNote(note: string | null | undefined): {
  entries: { index: number; name: string; decision: SkuApprovalDecision }[];
  comment: string | null;
} {
  const raw = note?.trim() ?? "";
  if (!raw) return { entries: [], comment: null };

  const lines = raw.split("\n");
  const entries: {
    index: number;
    name: string;
    decision: SkuApprovalDecision;
  }[] = [];
  let i = 0;
  for (; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "") break;
    const match = LINE_RE.exec(line);
    if (!match) break;
    entries.push({
      index: Number(match[1]),
      name: match[2] ?? "",
      decision: match[3] === "Approved" ? "approved" : "rejected",
    });
  }
  if (entries.length === 0) {
    return { entries: [], comment: raw };
  }
  while (i < lines.length && lines[i].trim() === "") i += 1;
  const comment = lines.slice(i).join("\n").trim();
  return { entries, comment: comment || null };
}

export function decisionsBySkuId(
  skus: { id: string }[],
  entries: { index: number; decision: SkuApprovalDecision }[]
): Record<string, SkuApprovalDecision> {
  const byId: Record<string, SkuApprovalDecision> = {};
  for (const entry of entries) {
    const sku = skus[entry.index - 1];
    if (sku) byId[sku.id] = entry.decision;
  }
  return byId;
}

export function overallApprovalResponse(
  entries: { decision: SkuApprovalDecision }[]
): "approved" | "changes_requested" {
  return entries.some((entry) => entry.decision === "rejected")
    ? "changes_requested"
    : "approved";
}
