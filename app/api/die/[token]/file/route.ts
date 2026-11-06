import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ORDER_ASSETS_BUCKET,
  ORDER_ASSET_SIGNED_URL_TTL_SEC,
} from "@/lib/order-assets";
import {
  diePortalFiles,
  parseDieRequestFiles,
  type DieRequestFile,
} from "@/lib/die-request";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const url = new URL(request.url);
  const preview = url.searchParams.get("preview") === "1";
  const index = Math.max(0, Number(url.searchParams.get("i") ?? "0") || 0);
  const admin = createAdminClient();
  let result = await admin
    .from("die_requests")
    .select(
      "file_path, file_name, file_mime, files, die:dies(pdf_path, pdf_name)"
    )
    .eq("token", token)
    .maybeSingle();
  if (result.error && /die_id|dies|relationship/i.test(result.error.message)) {
    result = await admin
      .from("die_requests")
      .select("file_path, file_name, file_mime, files")
      .eq("token", token)
      .maybeSingle();
  }
  const data = result.data as Record<string, unknown> | null;

  if (!data) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const dieRelation = data.die as
    | { pdf_path?: string | null; pdf_name?: string | null }
    | { pdf_path?: string | null; pdf_name?: string | null }[]
    | null;
  const die = Array.isArray(dieRelation) ? dieRelation[0] ?? null : dieRelation;
  const files: DieRequestFile[] = diePortalFiles(
    {
      files: parseDieRequestFiles(data.files),
      file_path: data.file_path ? String(data.file_path) : null,
      file_name: data.file_name ? String(data.file_name) : null,
      file_mime: data.file_mime ? String(data.file_mime) : null,
    },
    die
  );
  const file = files[index];
  if (!file?.path) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const { data: signed } = await admin.storage
    .from(ORDER_ASSETS_BUCKET)
    .createSignedUrl(
      file.path,
      ORDER_ASSET_SIGNED_URL_TTL_SEC,
      preview ? undefined : { download: file.name }
    );

  if (!signed?.signedUrl) {
    return NextResponse.json({ error: "Could not open file" }, { status: 400 });
  }

  return NextResponse.redirect(signed.signedUrl);
}
