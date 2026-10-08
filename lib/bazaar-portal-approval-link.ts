/**
 * Finds the customer proof-approval URL for a card, for the Bazaar portal
 * status callback (`approval_url`). Read-only lookup of the newest live
 * `customer_approval` round; the URL is resolved exactly like the one the
 * customer receives (single card -> /respond/{token}, multi-item ->
 * /respond/g/{portal}?item={orderId}, both via the /l/{code} short link).
 *
 * Uses the service-role client on purpose: it runs from after()/cron contexts
 * and `resolveCustomerApprovalActionUrl` may need to bypass portal-table RLS
 * (same reason /api/orders/[id]/approval-customer-link uses it).
 */

import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { resolveCustomerApprovalActionUrl } from "@/lib/approval-group";
import {
  pickActiveApprovalToken,
  sanitizeApprovalUrl,
  type ApprovalNotificationRow,
} from "@/lib/bazaar-portal-status-payload";

export async function findActiveApprovalUrl(args: {
  tenantId: string;
  orderId: string;
}): Promise<string | null> {
  try {
    const admin = createAdminClient();

    const { data: rows } = await admin
      .from("job_notifications")
      .select("token, status, channel, token_expires_at, created_at")
      .eq("tenant_id", args.tenantId)
      .eq("order_id", args.orderId)
      .eq("type", "customer_approval")
      .in("status", ["pending", "sent"])
      .order("created_at", { ascending: false })
      .limit(10);

    const token = pickActiveApprovalToken(
      (rows ?? []) as ApprovalNotificationRow[]
    );
    if (!token) return null;

    const { data: order } = await admin
      .from("orders")
      .select("id, title, tenant_id, column_id, description, specs")
      .eq("id", args.orderId)
      .eq("tenant_id", args.tenantId)
      .maybeSingle();
    if (!order) return null;

    const url = await resolveCustomerApprovalActionUrl(admin, order, token);
    return sanitizeApprovalUrl(url);
  } catch (err) {
    console.error(
      "[bazaar-portal-sync] approval link lookup failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
