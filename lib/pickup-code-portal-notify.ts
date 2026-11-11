import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { logActivity } from "@/lib/automation";
import { loadOrderExportData } from "@/lib/button-automation-order-data";
import { getMessageTemplates } from "@/lib/message-templates.server";
import { assignPickupCode } from "@/lib/pickup-code.server";
import { sendPickupReadyNotifications, shippingPortalPublicUrl } from "@/lib/shipping";
import { resolvePickupNotifyFields } from "@/lib/shipping-settings";

/**
 * Customer chose "Self pickup" on the shipping link → text + email them the
 * "ready for pickup" message WITH the pickup code, so they have it at the
 * counter (the link only showed it on screen). Reuses the code the order
 * already has, or creates one. Never throws: the customer's choice is saved
 * either way.
 */
export async function sendPickupCodeAfterPortalChoice(
  admin: SupabaseClient,
  token: string
): Promise<{ sent: boolean; error?: string }> {
  try {
    const { data: req } = await admin
      .from("shipping_requests")
      .select("order_id, tenant_id")
      .eq("token", token)
      .maybeSingle();
    const row = req as { order_id: string; tenant_id: string } | null;
    if (!row) return { sent: false, error: "Shipping link not found" };

    const { data: tenant } = await admin
      .from("tenants")
      .select("name")
      .eq("id", row.tenant_id)
      .maybeSingle();
    const tenantName = ((tenant as { name?: string } | null)?.name ?? "").trim();

    const exportData = await loadOrderExportData(admin, row.order_id, row.tenant_id, tenantName);
    if (!exportData) return { sent: false, error: "Order not found" };
    const email = exportData.customerEmail?.trim() || null;
    const phone = exportData.customerPhone?.trim() || null;
    if (!email && !phone) return { sent: false, error: "No email or phone on file" };

    const { code } = await assignPickupCode(admin, row.tenant_id, [row.order_id]);
    const [templates, pickup, portalUrl] = await Promise.all([
      getMessageTemplates(admin, row.tenant_id),
      resolvePickupNotifyFields(admin, row.tenant_id, null),
      shippingPortalPublicUrl(admin, row.tenant_id, token),
    ]);

    const result = await sendPickupReadyNotifications({
      email,
      phone,
      customerName: exportData.customerName,
      orderNumber: exportData.orderNumberDisplay || exportData.orderNumber || exportData.order.title,
      portalUrl,
      pickupLocation: pickup.pickupLocation,
      pickupHours: pickup.pickupHours,
      pickupCode: code,
      tenantName,
      templates,
    });
    const sent = result.emailSent || result.smsSent;
    await logActivity(admin, {
      tenantId: row.tenant_id,
      orderId: row.order_id,
      actor: null,
      action: "pickup_code_sent",
      metadata: {
        source: "shipping_link_pickup_choice",
        emailSent: result.emailSent,
        smsSent: result.smsSent,
        errors: result.errors,
      },
    }).catch(() => undefined);
    return sent ? { sent } : { sent, error: result.errors[0] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[pickup-code] portal pickup send failed", message);
    return { sent: false, error: message };
  }
}
