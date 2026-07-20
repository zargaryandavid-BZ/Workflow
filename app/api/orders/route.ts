import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { createOrder, type CreateOrderInput } from "@/lib/order-create";
import { fireNewJobNotificationRules } from "@/lib/fire-notification-rules";

export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as CreateOrderInput;
  const supabase = await createClient();
  const result = await createOrder(supabase, ctx, body);

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const order = result.order as { id: string; column_id: string; tenant_id: string };
  fireNewJobNotificationRules(order.id, order.column_id, order.tenant_id).catch(
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[NotifRule] fireNewJobNotificationRules error:", message);
    }
  );

  return NextResponse.json({
    order: result.order,
    gdriveFolderUrl: result.gdriveFolderUrl,
    gdriveOpenOnCreate: result.gdriveOpenOnCreate,
    gdriveWarning: result.gdriveWarning,
  });
}
