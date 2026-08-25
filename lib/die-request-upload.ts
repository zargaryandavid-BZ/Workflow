import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ORDER_ARTWORK_MAX_BYTES,
  ORDER_ASSETS_BUCKET,
  safeAssetFileName,
  uploadSizeError,
} from "@/lib/order-assets";
import {
  DIE_MAX_FILES,
  type DieRequestFile,
} from "@/lib/die-request";

export async function storeDieRequestFiles(
  supabase: SupabaseClient,
  tenantId: string,
  orderId: string,
  incoming: File[],
  existing: DieRequestFile[] = []
): Promise<{ files: DieRequestFile[] } | { error: string }> {
  const room = DIE_MAX_FILES - existing.length;
  if (incoming.length > room) {
    return {
      error: `You can attach up to ${DIE_MAX_FILES} files.`,
    };
  }
  const uploaded: DieRequestFile[] = [];
  for (let i = 0; i < incoming.length; i++) {
    const file = incoming[i];
    const sizeError = uploadSizeError(file.size, ORDER_ARTWORK_MAX_BYTES);
    if (sizeError) return { error: sizeError };
    const path = `${tenantId}/${orderId}/die-requests/${Date.now()}-${i}-${safeAssetFileName(file.name)}`;
    const { error } = await supabase.storage
      .from(ORDER_ASSETS_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) return { error: error.message };
    uploaded.push({
      path,
      name: file.name,
      mime: file.type || null,
    });
  }
  return { files: [...existing, ...uploaded] };
}

export function primaryDieFileFields(files: DieRequestFile[]): {
  file_path: string | null;
  file_name: string | null;
  file_mime: string | null;
} {
  const first = files[0];
  return {
    file_path: first?.path ?? null,
    file_name: first?.name ?? null,
    file_mime: first?.mime ?? null,
  };
}
