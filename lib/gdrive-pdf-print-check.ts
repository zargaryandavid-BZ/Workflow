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
  finalIds: string[]
): Promise<PdfPrintCheckResult> {
  if (finalIds.length === 0) return PDF_CHECK_UNCHECKED;

  try {
    const latest = await findLatestPdfInFolders(settings, finalIds);
    if (!latest) return PDF_CHECK_UNCHECKED;

    const client = proofsDriveClient(settings);
    const head = await downloadDriveFileHead(
      client,
      latest.id,
      PDF_PRINT_SPEC_SCAN_BYTES
    );
    if (!head || head.byteLength < 5) return PDF_CHECK_UNCHECKED;

    const inspect = inspectPdf(head);
    return {
      checked: true,
      hasLayers: inspect.hasLayers,
      isLinearized: inspect.isLinearized,
      valid: pdfPrintSpecValid(inspect),
      fileName: latest.name,
    };
  } catch (err) {
    console.error("[pdf-check] inspect failed", err);
    return PDF_CHECK_UNCHECKED;
  }
}
