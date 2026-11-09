import type { FedExRateOption } from "./types.ts";

/**
 * "I'll send my own shipping label" on the customer shipping page.
 *
 * Stored like "FedEx with my account": client_choice = "delivery" and a
 * marker selection in `shipping_requests.fedex_selection`. serviceType stays
 * EMPTY on purpose so nothing downstream buys a FedEx label or asks for
 * payment. The uploaded label files are also added to the order's Files.
 */
export const CUSTOMER_OWN_LABEL_SERVICE_NAME = "Customer's own label";
export const OWN_LABEL_MAX_FILES = 10;
export const OWN_LABEL_MAX_BYTES = 10 * 1024 * 1024;
export const OWN_LABEL_ACCEPT = ".pdf,.png,.jpg,.jpeg";

const OWN_LABEL_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
};

export type OwnLabelFile = { name: string; path: string; assetId?: string | null };

export function customerOwnLabelSelection(
  files: OwnLabelFile[],
  carrierNote?: string | null
): FedExRateOption {
  return {
    serviceType: "",
    serviceName: CUSTOMER_OWN_LABEL_SERVICE_NAME,
    totalCharge: null,
    currency: "USD",
    deliveryDate: null,
    transitDays: null,
    provider: "fedex",
    ownLabel: true,
    ownLabelFiles: files,
    ownLabelNote: carrierNote?.trim().slice(0, 500) || null,
  };
}

export function isCustomerOwnLabelSelection(
  rate: FedExRateOption | null | undefined
): boolean {
  return Boolean(rate && rate.ownLabel === true);
}

/** File extension for an allowed label upload, or null when not allowed. */
export function ownLabelExtension(mime: string, fileName: string): string | null {
  const byMime = OWN_LABEL_MIME[mime.toLowerCase()];
  if (byMime) return byMime;
  const ext = fileName.toLowerCase().match(/\.(pdf|png|jpe?g)$/)?.[1];
  if (!ext) return null;
  return ext === "jpeg" ? "jpg" : ext;
}

/** "Customer shipping label 2.pdf" — one name per file, numbered when several. */
export function ownLabelFileName(index: number, total: number, ext: string): string {
  return total > 1
    ? `Customer shipping label ${index + 1}.${ext}`
    : `Customer shipping label.${ext}`;
}
