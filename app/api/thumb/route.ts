import { NextResponse } from "next/server";
import sharp from "sharp";
import { getTenantContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ORDER_ASSETS_BUCKET } from "@/lib/order-assets";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Small board-card thumbnail for an image in the order-assets bucket.
 * The board used to download the full uploaded picture (often MBs) into a
 * 112px box. This returns a ~10–30 KB WebP instead. Storage paths contain an
 * upload timestamp, so a path's picture never changes → safe to let the
 * browser keep it for a week. Read-only: nothing is written anywhere.
 */
const ALLOWED_WIDTHS = new Set([112, 224, 336, 448]);
const MEM_MAX = 300;
const memThumbs = new Map<string, Buffer>();

export async function GET(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const path = (searchParams.get("p") ?? "").trim();
  const wRaw = Number(searchParams.get("w") ?? 224);
  const width = ALLOWED_WIDTHS.has(wRaw) ? wRaw : 224;

  // Only this tenant's files, no path tricks.
  if (!path || path.includes("..") || !path.startsWith(`${ctx.tenant.id}/`)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const memKey = `${width}:${path}`;
  let out = memThumbs.get(memKey) ?? null;
  if (!out) {
    const admin = createAdminClient();
    const { data, error } = await admin.storage.from(ORDER_ASSETS_BUCKET).download(path);
    if (error || !data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    try {
      const input = Buffer.from(await data.arrayBuffer());
      out = await sharp(input, { failOn: "none", limitInputPixels: 268_402_689 })
        .rotate()
        .resize({ width, height: width, fit: "cover", withoutEnlargement: true })
        .webp({ quality: 78 })
        .toBuffer();
    } catch {
      return NextResponse.json({ error: "Not an image" }, { status: 415 });
    }
    if (memThumbs.size >= MEM_MAX) {
      const oldest = memThumbs.keys().next().value;
      if (oldest !== undefined) memThumbs.delete(oldest);
    }
    memThumbs.set(memKey, out);
  }

  return new NextResponse(new Uint8Array(out), {
    status: 200,
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "private, max-age=604800, immutable",
      "Content-Length": String(out.length),
    },
  });
}
