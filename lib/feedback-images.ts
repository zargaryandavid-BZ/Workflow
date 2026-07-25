import type { SupabaseClient } from "@supabase/supabase-js";
import { safeAssetFileName, uploadSizeError } from "@/lib/order-assets";
import type { FeedbackImage } from "@/lib/feedback";

export const FEEDBACK_IMAGES_BUCKET = "feedback-images";
export const MAX_FEEDBACK_IMAGES = 5;
export const FEEDBACK_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const FEEDBACK_IMAGE_RAW_MAX_BYTES = 25 * 1024 * 1024;
const SIGNED_URL_TTL_SEC = 60 * 60 * 48;

export type FeedbackImageRow = {
  id: string;
  tenant_id: string;
  feedback_id: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  storage_path: string;
  position: number;
  created_at: string;
};

export function feedbackImageStoragePath(
  tenantId: string,
  feedbackId: string,
  fileName: string
): string {
  return `${tenantId}/${feedbackId}/${Date.now()}-${safeAssetFileName(fileName)}`;
}

export function feedbackImageSizeError(size: number): string | null {
  return uploadSizeError(size, FEEDBACK_IMAGE_MAX_BYTES);
}

export async function attachSignedUrlsToFeedbackImages(
  supabase: SupabaseClient,
  rows: FeedbackImageRow[]
): Promise<FeedbackImage[]> {
  if (rows.length === 0) return [];

  const results = await Promise.all(
    rows.map(async (row) => {
      const { data } = await supabase.storage
        .from(FEEDBACK_IMAGES_BUCKET)
        .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SEC);
      return {
        id: row.id,
        file_name: row.file_name,
        mime_type: row.mime_type,
        url: data?.signedUrl ?? null,
      } satisfies FeedbackImage;
    })
  );

  return results;
}

export async function loadFeedbackImagesByFeedbackIds(
  supabase: SupabaseClient,
  tenantId: string,
  feedbackIds: string[]
): Promise<Record<string, FeedbackImage[]>> {
  const map: Record<string, FeedbackImage[]> = {};
  if (feedbackIds.length === 0) return map;

  const { data, error } = await supabase
    .from("feedback_images")
    .select("*")
    .eq("tenant_id", tenantId)
    .in("feedback_id", feedbackIds)
    .order("position", { ascending: true });

  if (error || !data) return map;

  const rows = data as FeedbackImageRow[];
  const withUrls = await attachSignedUrlsToFeedbackImages(supabase, rows);

  for (let i = 0; i < rows.length; i++) {
    const feedbackId = rows[i].feedback_id;
    (map[feedbackId] ??= []).push(withUrls[i]);
  }

  return map;
}

export async function deleteFeedbackImageFiles(
  supabase: SupabaseClient,
  storagePaths: string[]
): Promise<void> {
  if (storagePaths.length === 0) return;
  await supabase.storage.from(FEEDBACK_IMAGES_BUCKET).remove(storagePaths);
}
