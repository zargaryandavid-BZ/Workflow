import "server-only";

import { respondPreviewIndexPath } from "@/lib/approval-layer-preview-paths";
import { ORDER_ASSETS_BUCKET } from "@/lib/order-assets";
import { createAdminClient } from "@/lib/supabase/admin";

/** Number of PDF pages in the stored Final Production proof (one page per SKU). */
export async function loadFinalArtworkSkuCount(
  orderId: string
): Promise<number | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(ORDER_ASSETS_BUCKET)
    .download(respondPreviewIndexPath(orderId));
  if (error || !data) return null;

  try {
    const parsed = JSON.parse(await data.text()) as { pages?: unknown };
    if (!Array.isArray(parsed.pages)) return null;
    const pages = new Set(
      parsed.pages.filter(
        (page): page is number =>
          typeof page === "number" && Number.isInteger(page) && page > 0
      )
    );
    return pages.size > 0 ? pages.size : null;
  } catch {
    return null;
  }
}
