import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { RESPOND_MAX_BYTES } from "@/lib/respond-page";

const BUCKET = "order-assets";
const ALLOWED_EXT = new Set([
  "pdf",
  "ai",
  "eps",
  "png",
  "jpg",
  "jpeg",
]);

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  const token = form.get("token");

  if (!(file instanceof File) || typeof token !== "string") {
    return NextResponse.json(
      { error: "file and token are required" },
      { status: 400 }
    );
  }

  if (file.size > RESPOND_MAX_BYTES) {
    return NextResponse.json(
      { error: "File must be 50MB or less." },
      { status: 400 }
    );
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXT.has(ext)) {
    return NextResponse.json(
      { error: "Allowed file types: PDF, AI, EPS, PNG, JPG." },
      { status: 400 }
    );
  }

  // Anonymous customer upload: validate the unguessable token first.
  const admin = createAdminClient();
  const { data: notification } = await admin
    .from("job_notifications")
    .select("*")
    .eq("token", token)
    .maybeSingle();

  if (!notification || notification.type !== "missing_info") {
    return NextResponse.json({ error: "Invalid link" }, { status: 404 });
  }
  if (notification.status === "responded") {
    return NextResponse.json(
      { error: "This request has already been answered." },
      { status: 409 }
    );
  }
  if (
    notification.token_expires_at &&
    new Date(notification.token_expires_at).getTime() < Date.now()
  ) {
    return NextResponse.json({ error: "This link has expired." }, { status: 410 });
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${notification.tenant_id}/${notification.order_id}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 400 });
  }

  const { data: asset, error } = await admin
    .from("assets")
    .insert({
      tenant_id: notification.tenant_id,
      order_id: notification.order_id,
      notification_id: notification.id,
      file_name: file.name,
      storage_path: path,
      mime_type: file.type || null,
      size: file.size,
    })
    .select("id, file_name")
    .single();

  if (error) {
    await admin.storage.from(BUCKET).remove([path]);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ asset });
}
