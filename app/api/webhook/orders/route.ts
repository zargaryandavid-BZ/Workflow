import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  findWebhookConfigBySecret,
  touchWebhookLastUsed,
} from "@/lib/webhook-config";
import {
  createOrderFromWebhook,
  secretsMatch,
  WebhookValidationError,
  type WebhookOrderPayload,
} from "@/lib/webhook-order";

export async function POST(request: Request) {
  const secret = request.headers.get("x-webhook-secret")?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "Invalid or missing secret key" },
      { status: 401 }
    );
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  const config = await findWebhookConfigBySecret(admin, secret);
  if (!config || !secretsMatch(secret, config.secret_key)) {
    return NextResponse.json(
      { error: "Invalid or missing secret key" },
      { status: 401 }
    );
  }

  if (!config.enabled) {
    return NextResponse.json({ error: "Webhook is disabled" }, { status: 403 });
  }

  let body: WebhookOrderPayload;
  try {
    body = (await request.json()) as WebhookOrderPayload;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 422 }
    );
  }

  try {
    const result = await createOrderFromWebhook(admin, config, body);
    await touchWebhookLastUsed(admin, config.id);

    if (result.isMultiItem) {
      return NextResponse.json({
        success: true,
        order_number: result.orderNumber,
        jobs: result.jobs,
        ...(result.warning ? { warning: result.warning } : {}),
      });
    }

    return NextResponse.json({
      success: true,
      order_id: result.orderId,
      order_number: result.orderNumber,
      ...(result.warning ? { warning: result.warning } : {}),
    });
  } catch (err) {
    if (err instanceof WebhookValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    const message = err instanceof Error ? err.message : "Server error";
    console.error("[webhook/orders] unhandled error:", {
      message,
      stack: err instanceof Error ? err.stack : undefined,
      has_skus: Array.isArray(body.skus) && body.skus.length > 0,
      sku_count: Array.isArray(body.skus) ? body.skus.length : 0,
    });
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
