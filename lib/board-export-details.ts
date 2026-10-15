/**
 * Optional per-card detail fields for GET /api/export/board-columns. PURE so it
 * runs under `node --test`. Every field is additive: the export's existing keys
 * are unchanged, and a reader that ignores these keeps working exactly as before.
 * The Bazaar portal poller already reads these names (item_index, item_title,
 * design_folder_url, production_notes, approval_url, approval_status).
 */

import {
  designFolderFromSpecs,
  pickNewestLiveApprovalRound,
  type ApprovalRow,
} from "./reorder-source.ts";

export type BoardExportDetails = {
  item_index: number | null;
  item_title: string | null;
  design_folder_url: string | null;
  production_notes: string | null;
  approval_url: string | null;
  approval_status: "approved" | "rejected" | "pending" | null;
  is_reorder: boolean;
  reorder_of: string | null;
};

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

export function boardExportDetails(
  specs: Record<string, unknown> | null | undefined,
  approvals: ApprovalRow[],
  respondUrl: (token: string) => string,
  nowMs: number = Date.now()
): BoardExportDetails {
  const s = specs ?? {};
  const rawIdx = s.webhook_item_index;
  const idx =
    typeof rawIdx === "number" ? rawIdx : Number.parseInt(String(rawIdx ?? ""), 10);
  const round = pickNewestLiveApprovalRound(approvals, nowMs);
  const isReorder = s.is_reorder === true;
  return {
    item_index: Number.isInteger(idx) && idx >= 0 ? idx : null,
    item_title: str(s.webhook_item_title),
    design_folder_url: designFolderFromSpecs(s),
    production_notes: str(s.production_notes),
    approval_url: round ? respondUrl(round.token) : null,
    approval_status: round?.status ?? null,
    is_reorder: isReorder,
    reorder_of: isReorder ? str(s.reorder_of) : null,
  };
}
