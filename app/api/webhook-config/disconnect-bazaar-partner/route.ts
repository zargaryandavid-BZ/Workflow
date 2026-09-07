import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { removePartnerFromTenant } from "@/lib/bazaar-connect";
import { parseBazaarPortalInboundKeys } from "@/lib/bazaar-portal-keys";
import { notifyBazaarPortalDisconnect } from "@/lib/bazaar-portal-sync";
import { ensureWebhookConfig } from "@/lib/webhook-config";

export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    brokerId?: unknown;
  };
  const brokerId = typeof body.brokerId === "string" ? body.brokerId.trim() : "";
  if (!brokerId) {
    return NextResponse.json({ error: "brokerId is required" }, { status: 400 });
  }

  const supabase = await createClient();
  await ensureWebhookConfig(supabase, ctx.tenant.id);

  const { data: before } = await supabase
    .from("webhook_configs")
    .select("bazaar_api_url, bazaar_portal_inbound_keys")
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  const parsed = parseBazaarPortalInboundKeys(
    before?.bazaar_portal_inbound_keys
  );
  const osk = parsed.keys[brokerId] ?? null;
  const bazaarApiUrl =
    typeof before?.bazaar_api_url === "string"
      ? before.bazaar_api_url.trim()
      : "";

  let adminNotified = false;
  let adminMessage = "";
  if (osk && bazaarApiUrl) {
    const notice = await notifyBazaarPortalDisconnect({
      bazaarApiUrl,
      oskKey: osk,
    });
    adminNotified = notice.ok;
    adminMessage = notice.message;
  }

  await removePartnerFromTenant(supabase, ctx.tenant.id, brokerId);
  const config = await ensureWebhookConfig(supabase, ctx.tenant.id);

  return NextResponse.json({
    ok: true,
    config,
    adminNotified,
    adminMessage,
  });
}
