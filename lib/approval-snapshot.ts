import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { ORDER_ASSETS_BUCKET, safeAssetFileName } from "@/lib/order-assets";

/** One frozen file in an approval round's snapshot. */
export interface ApprovalSnapshotFile {
  file_name: string;
  mime_type: string | null;
  sku_key: string | null;
  /** Frozen copy path in the order-assets bucket (null for external files). */
  storage_path: string | null;
  /** For webhook / reference files served by URL. */
  external_url: string | null;
}

export function approvalSnapshotPrefix(notificationId: string): string {
  return `approval-snapshots/${notificationId}`;
}

/**
 * Freeze a copy of the files currently shown to the customer for this order,
 * tied to a single approval round (notification). Copies each staff-uploaded
 * proof file to a per-notification path so it survives later re-uploads, and
 * records the set on job_notifications.approval_files.
 *
 * Excludes: customer reply uploads (notification_id set) and locked reference
 * images (is_locked — the internal CRM image, see migration 0075). Best-effort:
 * a copy failure skips that one file rather than aborting the whole round.
 */
export async function snapshotApprovalFiles(
  _client: SupabaseClient,
  notificationId: string
): Promise<ApprovalSnapshotFile[]> {
  // Storage copy + the snapshot write need service-role access (RLS blocks a
  // user-context copy), so run the whole snapshot with the admin client.
  const client = createAdminClient();
  const { data: notif } = await client
    .from("job_notifications")
    .select("order_id")
    .eq("id", notificationId)
    .maybeSingle();
  const orderId = (notif as { order_id?: string } | null)?.order_id;
  if (!orderId) return [];

  const { data: assetRows } = await client
    .from("assets")
    .select("id, file_name, mime_type, sku_key, storage_path, external_url, is_locked")
    .eq("order_id", orderId)
    .is("notification_id", null)
    .order("created_at", { ascending: true });

  const assets = (assetRows ?? []) as Array<{
    id: string;
    file_name: string;
    mime_type: string | null;
    sku_key: string | null;
    storage_path: string | null;
    external_url: string | null;
    is_locked?: boolean;
  }>;

  const prefix = approvalSnapshotPrefix(notificationId);
  const files: ApprovalSnapshotFile[] = [];

  for (let i = 0; i < assets.length; i++) {
    const a = assets[i];
    if (a.is_locked) continue; // internal reference — never customer-facing
    if (a.external_url) {
      files.push({
        file_name: a.file_name,
        mime_type: a.mime_type,
        sku_key: a.sku_key,
        storage_path: null,
        external_url: a.external_url,
      });
      continue;
    }
    if (!a.storage_path) continue;
    const frozenPath = `${prefix}/${i}-${safeAssetFileName(a.file_name)}`;
    const { error } = await client.storage
      .from(ORDER_ASSETS_BUCKET)
      .copy(a.storage_path, frozenPath);
    if (error) {
      // Fall back to referencing the live path so the round still records the file.
      files.push({
        file_name: a.file_name,
        mime_type: a.mime_type,
        sku_key: a.sku_key,
        storage_path: a.storage_path,
        external_url: null,
      });
      continue;
    }
    files.push({
      file_name: a.file_name,
      mime_type: a.mime_type,
      sku_key: a.sku_key,
      storage_path: frozenPath,
      external_url: null,
    });
  }

  await client
    .from("job_notifications")
    .update({ approval_files: files })
    .eq("id", notificationId);

  return files;
}
