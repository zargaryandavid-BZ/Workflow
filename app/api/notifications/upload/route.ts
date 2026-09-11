import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { RESPOND_MAX_BYTES } from "@/lib/respond-page";
import { normalizeSkus } from "@/lib/skus";

const BUCKET = "order-assets";
const ALLOWED_EXT = new Set(["pdf", "ai", "eps", "png", "jpg", "jpeg"]);

type NotificationRow = {
  id: string;
  tenant_id: string;
  order_id: string;
  type: string;
  status: string;
  token_expires_at: string | null;
};

function fileExt(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

async function loadOpenMissingInfo(token: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("job_notifications")
    .select("id, tenant_id, order_id, type, status, token_expires_at")
    .eq("token", token)
    .maybeSingle();
  const notification = data as NotificationRow | null;
  if (!notification || notification.type !== "missing_info") {
    return { admin, error: jsonError("Invalid link", 404) as NextResponse };
  }
  if (notification.status === "responded") {
    return {
      admin,
      error: jsonError("This request has already been answered.", 409),
    };
  }
  if (notification.status === "expired") {
    return {
      admin,
      error: jsonError(
        "This request was replaced. Please use the newest link.",
        410
      ),
    };
  }
  if (
    notification.token_expires_at &&
    new Date(notification.token_expires_at).getTime() < Date.now()
  ) {
    return { admin, error: jsonError("This link has expired.", 410) };
  }
  return { admin, notification };
}

async function resolveSkuKey(
  admin: ReturnType<typeof createAdminClient>,
  orderId: string,
  requested: string | null
): Promise<string | null> {
  if (!requested) return null;
  const { data: orderRow } = await admin
    .from("orders")
    .select("specs")
    .eq("id", orderId)
    .maybeSingle();
  const skus = normalizeSkus(
    (orderRow?.specs as { skus?: unknown } | null)?.skus
  );
  return skus.some((s) => s.id === requested) ? requested : null;
}

function pathFor(notification: NotificationRow, fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${notification.tenant_id}/${notification.order_id}/${Date.now()}-${safeName}`;
}

function ownsPath(notification: NotificationRow, path: string): boolean {
  const prefix = `${notification.tenant_id}/${notification.order_id}/`;
  return path.startsWith(prefix) && !path.includes("..");
}

/**
 * Customer missing-info uploads.
 * Files go to Storage via a signed URL so they never pass through Vercel’s
 * ~4.5 MB function body limit (the form still allows up to 50 MB).
 */
export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      token?: string;
      fileName?: string;
      size?: number;
      mimeType?: string | null;
      skuKey?: string | null;
      path?: string;
    };
    const token = typeof body.token === "string" ? body.token : "";
    if (!token) return jsonError("file and token are required", 400);

    const loaded = await loadOpenMissingInfo(token);
    if (loaded.error) return loaded.error;
    const { admin, notification } = loaded;
    if (!notification) return jsonError("Invalid link", 404);

    if (body.action === "complete") {
      const path = typeof body.path === "string" ? body.path : "";
      const fileName = typeof body.fileName === "string" ? body.fileName : "";
      if (!path || !fileName || !ownsPath(notification, path)) {
        return jsonError("Upload could not be saved.", 400);
      }
      const skuKey = await resolveSkuKey(
        admin,
        notification.order_id,
        typeof body.skuKey === "string" ? body.skuKey : null
      );
      const { data: asset, error } = await admin
        .from("assets")
        .insert({
          tenant_id: notification.tenant_id,
          order_id: notification.order_id,
          notification_id: notification.id,
          sku_key: skuKey,
          file_name: fileName,
          storage_path: path,
          mime_type: body.mimeType || null,
          size: typeof body.size === "number" ? body.size : null,
        })
        .select("id, file_name")
        .single();
      if (error) {
        await admin.storage.from(BUCKET).remove([path]);
        return jsonError(error.message, 400);
      }
      return NextResponse.json({ asset });
    }

    const fileName = typeof body.fileName === "string" ? body.fileName : "";
    const size = typeof body.size === "number" ? body.size : 0;
    if (!fileName) return jsonError("file and token are required", 400);
    if (size > RESPOND_MAX_BYTES) {
      return jsonError("File must be 50MB or less.", 400);
    }
    if (!ALLOWED_EXT.has(fileExt(fileName))) {
      return jsonError("Allowed file types: PDF, AI, EPS, PNG, JPG.", 400);
    }

    const path = pathFor(notification, fileName);
    const { data: signed, error } = await admin.storage
      .from(BUCKET)
      .createSignedUploadUrl(path);
    if (error || !signed?.signedUrl) {
      return jsonError(error?.message ?? "Could not start upload.", 400);
    }
    return NextResponse.json({
      path: signed.path ?? path,
      signedUrl: signed.signedUrl,
      token: signed.token,
    });
  }

  const form = await request.formData();
  const file = form.get("file");
  const token = form.get("token");
  const skuKeyRaw = form.get("skuKey");
  const requestedSkuKey =
    typeof skuKeyRaw === "string" && skuKeyRaw.trim() ? skuKeyRaw.trim() : null;

  if (!(file instanceof File) || typeof token !== "string") {
    return jsonError("file and token are required", 400);
  }
  if (file.size > RESPOND_MAX_BYTES) {
    return jsonError("File must be 50MB or less.", 400);
  }
  if (!ALLOWED_EXT.has(fileExt(file.name))) {
    return jsonError("Allowed file types: PDF, AI, EPS, PNG, JPG.", 400);
  }

  const loaded = await loadOpenMissingInfo(token);
  if (loaded.error) return loaded.error;
  const { admin, notification } = loaded;
  if (!notification) return jsonError("Invalid link", 404);

  const skuKey = await resolveSkuKey(
    admin,
    notification.order_id,
    requestedSkuKey
  );
  const path = pathFor(notification, file.name);
  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) return jsonError(uploadError.message, 400);

  const { data: asset, error } = await admin
    .from("assets")
    .insert({
      tenant_id: notification.tenant_id,
      order_id: notification.order_id,
      notification_id: notification.id,
      sku_key: skuKey,
      file_name: file.name,
      storage_path: path,
      mime_type: file.type || null,
      size: file.size,
    })
    .select("id, file_name")
    .single();
  if (error) {
    await admin.storage.from(BUCKET).remove([path]);
    return jsonError(error.message, 400);
  }
  return NextResponse.json({ asset });
}
