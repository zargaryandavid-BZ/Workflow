import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { absoluteCustomerUrl } from "@/lib/short-link";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const trimmed = code?.trim() ?? "";
  if (!trimmed) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("short_links")
    .select("target_path")
    .eq("code", trimmed)
    .maybeSingle();

  const path =
    typeof data?.target_path === "string" ? data.target_path.trim() : "";
  if (!path.startsWith("/") || path.startsWith("//")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const dest = absoluteCustomerUrl(path);
  return NextResponse.redirect(dest, 302);
}
