import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";

const BUCKET = "order-assets";

// Download: redirect to a short-lived signed URL.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const { data: asset } = await supabase
    .from("assets")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!asset) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: signed, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(asset.storage_path, 60, { download: asset.file_name });

  if (error || !signed) {
    return NextResponse.json(
      { error: error?.message ?? "Could not sign URL" },
      { status: 400 }
    );
  }

  return NextResponse.redirect(signed.signedUrl);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const { data: asset } = await supabase
    .from("assets")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!asset) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await supabase.storage.from(BUCKET).remove([asset.storage_path]);
  const { error } = await supabase.from("assets").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
