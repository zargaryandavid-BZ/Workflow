import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { completeShippingResponse } from "@/lib/shipping-confirm";
import {
  isShippingChoiceOffered,
  loadShippingSettings,
} from "@/lib/shipping-settings";
import { ORDER_ASSETS_BUCKET } from "@/lib/order-assets";
import {
  customerOwnLabelSelection,
  OWN_LABEL_MAX_BYTES,
  OWN_LABEL_MAX_FILES,
  ownLabelExtension,
  ownLabelFileName,
  type OwnLabelFile,
} from "@/lib/customer-own-label";

export const runtime = "nodejs";

/**
 * Customer shipping page → "I'll send my own label". Multipart form:
 *   files: one or more PDF / PNG / JPG labels (required)
 *   note:  carrier / anything staff should know (optional)
 * Saves each file to the order's Files, then records the choice exactly like
 * the other options (shipping request answered + card moved by the Ship Opt
 * rule). No FedEx label is bought and nothing is charged.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token) {
    return NextResponse.json({ error: "Token required" }, { status: 422 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Upload your label file." }, { status: 422 });
  }
  const files = form
    .getAll("files")
    .filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f);
  const note = typeof form.get("note") === "string" ? String(form.get("note")) : "";

  if (files.length === 0) {
    return NextResponse.json({ error: "Upload your shipping label." }, { status: 422 });
  }
  if (files.length > OWN_LABEL_MAX_FILES) {
    return NextResponse.json(
      { error: `Up to ${OWN_LABEL_MAX_FILES} label files at a time.` },
      { status: 422 }
    );
  }
  const prepared: { file: File; ext: string }[] = [];
  for (const file of files) {
    const ext = ownLabelExtension(file.type || "", file.name || "");
    if (!ext) {
      return NextResponse.json(
        { error: `${file.name || "File"}: labels must be PDF, PNG or JPG.` },
        { status: 422 }
      );
    }
    if (file.size === 0 || file.size > OWN_LABEL_MAX_BYTES) {
      return NextResponse.json(
        { error: `${file.name || "File"} must be under 10 MB.` },
        { status: 422 }
      );
    }
    prepared.push({ file, ext });
  }

  const admin = createAdminClient();
  const { data: shipReq, error: findError } = await admin
    .from("shipping_requests")
    .select("id, status, tenant_id, order_id")
    .eq("token", token)
    .maybeSingle();
  if (findError || !shipReq) {
    return NextResponse.json({ error: "Shipping link not found" }, { status: 404 });
  }
  if (shipReq.status === "client_responded") {
    return NextResponse.json(
      { error: "This shipping request was already confirmed." },
      { status: 409 }
    );
  }

  const settings = await loadShippingSettings(admin, shipReq.tenant_id);
  if (!isShippingChoiceOffered(settings, "delivery")) {
    return NextResponse.json(
      { error: "That shipping option is not available." },
      { status: 403 }
    );
  }

  const tenantId = shipReq.tenant_id as string;
  const orderId = shipReq.order_id as string;
  const uploadedPaths: string[] = [];
  const assetIds: string[] = [];
  const saved: OwnLabelFile[] = [];
  const rollback = async () => {
    if (assetIds.length) await admin.from("assets").delete().in("id", assetIds);
    if (uploadedPaths.length) {
      await admin.storage.from(ORDER_ASSETS_BUCKET).remove(uploadedPaths);
    }
  };

  for (const [index, { file, ext }] of prepared.entries()) {
    const fileName = ownLabelFileName(index, prepared.length, ext);
    const path = `${tenantId}/${orderId}/assets/${Date.now()}-${index}-${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    const mime = ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : "image/jpeg";
    const { error: upErr } = await admin.storage
      .from(ORDER_ASSETS_BUCKET)
      .upload(path, bytes, { contentType: mime, upsert: false });
    if (upErr) {
      await rollback();
      return NextResponse.json({ error: "Could not save your label. Try again." }, { status: 500 });
    }
    uploadedPaths.push(path);
    const { data: asset, error: assetErr } = await admin
      .from("assets")
      .insert({
        tenant_id: tenantId,
        order_id: orderId,
        sku_key: null,
        file_name: fileName,
        storage_path: path,
        mime_type: mime,
        size: bytes.length,
        uploaded_by: null,
      })
      .select("id")
      .single();
    if (assetErr || !asset) {
      await rollback();
      return NextResponse.json({ error: "Could not save your label. Try again." }, { status: 500 });
    }
    assetIds.push((asset as { id: string }).id);
    saved.push({ name: fileName, path, assetId: (asset as { id: string }).id });
  }

  const result = await completeShippingResponse(admin, token, {
    choice: "delivery",
    fedexSelection: customerOwnLabelSelection(saved, note),
    deliveryAddress: null,
    deliveryNotes: note.trim() || null,
  });
  if (!result.ok) {
    // Another tab confirmed first — don't leave orphan label files behind.
    await rollback();
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, files: saved.map((f) => f.name) });
}
