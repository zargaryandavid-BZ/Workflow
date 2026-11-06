import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { diePdfError } from "@/lib/dies";
import { diePdfRef, saveDiePdf } from "@/lib/dies.server";
import { ORDER_ASSETS_BUCKET, ORDER_ASSET_SIGNED_URL_TTL_SEC } from "@/lib/order-assets";
import { canViewDieOrder } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

async function ctxOrError() {
  const ctx = await getTenantContext();
  if (!ctx) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!canViewDieOrder(ctx.role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ctx };
}

/** GET: open the die PDF (`?download=1` to save it). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Any signed-in staff member can open the PDF (die page / scan).
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const auth = { ctx };
  const { id } = await params;
  const supabase = await createClient();
  const ref = await diePdfRef(supabase, auth.ctx.tenant.id, id);
  if (!ref) return NextResponse.json({ error: "No PDF on this die" }, { status: 404 });
  const download = new URL(request.url).searchParams.get("download") === "1";
  const { data } = await supabase.storage
    .from(ORDER_ASSETS_BUCKET)
    .createSignedUrl(
      ref.path,
      ORDER_ASSET_SIGNED_URL_TTL_SEC,
      download ? { download: ref.name } : undefined
    );
  if (!data?.signedUrl) {
    return NextResponse.json({ error: "Could not open file" }, { status: 400 });
  }
  return NextResponse.redirect(data.signedUrl);
}

/** POST multipart `file`: attach or replace the die PDF. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await ctxOrError();
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Attach a PDF." }, { status: 422 });
  }
  const invalid = diePdfError(file);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 422 });
  const result = await saveDiePdf(await createClient(), {
    tenantId: auth.ctx.tenant.id,
    id,
    file,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}
