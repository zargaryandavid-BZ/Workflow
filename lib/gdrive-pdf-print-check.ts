import "server-only";

import type { GdriveSettings } from "@/lib/types";
import { findLatestPdfInFolders } from "@/lib/google-drive";
import {
  downloadDriveFileHead,
  proofsDriveClient,
} from "@/lib/gdrive-proofs";
import {
  inspectPdf,
  pdfPrintSpecValid,
  PDF_PRINT_SPEC_SCAN_BYTES,
} from "@/lib/pdf-print-spec";
import { cacheGet, cacheSet } from "@/lib/cache";

// A Drive file's bytes never change without its modifiedTime changing, so the
// inspection of (file id + modifiedTime) is cached for 7 days — exact, never
// stale. Skips re-downloading + re-inspecting the PDF on every card open.
const INSPECT_TTL_SECONDS = 7 * 24 * 60 * 60;

export type PdfPrintCheckResult = {
  checked: boolean;
  hasLayers: boolean;
  isLinearized: boolean;
  valid: boolean;
  fileName: string | null;
};

export const PDF_CHECK_UNCHECKED: PdfPrintCheckResult = {
  checked: false,
  hasLayers: true,
  isLinearized: true,
  valid: true,
  fileName: null,
};

export async function checkFinalFolderPdfPrintSpec(
  settings: GdriveSettings,
  finalIds: string[],
  opts?: { directOnly?: boolean }
): Promise<PdfPrintCheckResult> {
  if (finalIds.length === 0) return PDF_CHECK_UNCHECKED;

  try {
    const latest = await findLatestPdfInFolders(settings, finalIds, opts);
    if (!latest) return PDF_CHECK_UNCHECKED;

    const modified = String(latest.modifiedTime ?? "").trim();
    const inspectKey = modified ? `wf:pdf-inspect:v1:${latest.id}:${modified}` : null;
    if (inspectKey) {
      const hit = await cacheGet<PdfPrintCheckResult>(inspectKey);
      if (hit?.checked) return { ...hit, fileName: latest.name };
    }

    const client = proofsDriveClient(settings);
    const head = await downloadDriveFileHead(
      client,
      latest.id,
      PDF_PRINT_SPEC_SCAN_BYTES
    );
    if (!head || head.byteLength < 5) return PDF_CHECK_UNCHECKED;

    const inspect = inspectPdf(head);
    const result: PdfPrintCheckResult = {
      checked: true,
      hasLayers: inspect.hasLayers,
      isLinearized: inspect.isLinearized,
      valid: pdfPrintSpecValid(inspect),
      fileName: latest.name,
    };
    if (inspectKey) await cacheSet(inspectKey, result, INSPECT_TTL_SECONDS);
    return result;
  } catch (err) {
    console.error("[pdf-check] inspect failed", err);
    return PDF_CHECK_UNCHECKED;
  }
}
