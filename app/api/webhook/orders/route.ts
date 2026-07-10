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
  type WebhookCreateResult,
  type WebhookOrderPayload,
} from "@/lib/webhook-order";

/**
 * Inbound order webhook — POST /api/webhook/orders
 *
 * Auth: x-webhook-secret header (per-tenant key in webhook_configs).
 * Logic: lib/webhook-order.ts — all 8 payload configs; dropdown fields are
 * fuzzy-matched against tenant Custom Fields (lib/fuzzyMatch.ts) with hardcoded
 * fallbacks; corrections appear in the response `warning` field.
 */
export async function POST(request: Request) {
  const secret = request.headers.get("x-webhook-secret")?.trim();
  if (!secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let adminClient: ReturnType<typeof createAdminClient>;
  try {
    adminClient = createAdminClient();
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  const webhookConfig = await findWebhookConfigBySecret(adminClient, secret);
  if (!webhookConfig || !secretsMatch(secret, webhookConfig.secret_key)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const activeConfig = webhookConfig;

  const rawBody = await request.text();
  let body: WebhookOrderPayload | null = null;
  try {
    body = JSON.parse(rawBody) as WebhookOrderPayload;
  } catch {
    body = null;
  }

  async function logWebhookHistory(params: {
    requestPayload?: WebhookOrderPayload | null;
    requestRaw?: string | null;
    responsePayload?: Record<string, unknown>;
    responseStatus: number;
    success: boolean;
    errorMessage?: string | null;
    result?: WebhookCreateResult;
  }) {
    const orderIds: string[] = [];
    const orderNumbers: string[] = [];
    if (params.result) {
      if (params.result.isMultiItem) {
        orderNumbers.push(params.result.orderNumber);
        for (const job of params.result.jobs) {
          orderIds.push(job.order_id);
        }
      } else {
        orderIds.push(params.result.orderId);
        orderNumbers.push(params.result.orderNumber);
      }
    }

    await adminClient
      .from("webhook_history")
      .insert({
        tenant_id: activeConfig.tenant_id,
        webhook_config_id: activeConfig.id,
        request_payload: params.requestPayload ?? null,
        request_raw: params.requestRaw ?? null,
        response_payload: params.responsePayload ?? null,
        response_status: params.responseStatus,
        success: params.success,
        error_message: params.errorMessage ?? null,
        order_ids: orderIds,
        order_numbers: orderNumbers,
      })
      .then(({ error }) => {
        if (error) {
          console.error("[webhook/orders] history insert error:", error.message);
        }
      });
  }

  if (!activeConfig.enabled) {
    await logWebhookHistory({
      requestPayload: body,
      requestRaw: body ? null : rawBody || null,
      responsePayload: { error: "Webhook is disabled" },
      responseStatus: 403,
      success: false,
      errorMessage: "Webhook is disabled",
    });
    return NextResponse.json({ error: "Webhook is disabled" }, { status: 403 });
  }

  if (!body) {
    await logWebhookHistory({
      requestPayload: null,
      requestRaw: rawBody || null,
      responsePayload: { error: "Invalid JSON" },
      responseStatus: 400,
      success: false,
      errorMessage: "Invalid JSON",
    });
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Product exclusion check — skip orders whose product type is on the exclusion list.
  const excluded: string[] = activeConfig.excluded_products ?? [];
  if (excluded.length > 0) {
    function isExcluded(product: unknown): boolean {
      if (typeof product !== "string" || product.trim() === "") return false;
      const lower = product.trim().toLowerCase();
      return excluded.some((e) => e.toLowerCase() === lower);
    }

    if (Array.isArray(body.items) && body.items.length > 0) {
      const filteredItems = body.items.filter(
        (item) => !isExcluded((item as Record<string, unknown>).product)
      );
      if (filteredItems.length === 0) {
        const response = { skipped: true, reason: "product_excluded" };
        await logWebhookHistory({
          requestPayload: body,
          requestRaw: null,
          responsePayload: response,
          responseStatus: 200,
          success: true,
        });
        return NextResponse.json(response);
      }
      body = { ...body, items: filteredItems };
    } else if (isExcluded((body as Record<string, unknown>).product)) {
      const response = { skipped: true, reason: "product_excluded" };
      await logWebhookHistory({
        requestPayload: body,
        requestRaw: null,
        responsePayload: response,
        responseStatus: 200,
        success: true,
      });
      return NextResponse.json(response);
    }
  }

  try {
    const result = await createOrderFromWebhook(adminClient, activeConfig, body);
    await touchWebhookLastUsed(adminClient, activeConfig.id);

    if (result.isMultiItem) {
      const response = {
        success: true,
        order_number: result.orderNumber,
        jobs: result.jobs,
        ...(result.ownerId ? { owner_id: result.ownerId } : {}),
        ...(result.ownerName ? { owner_name: result.ownerName } : {}),
        ...(result.warning ? { warning: result.warning } : {}),
      };
      await logWebhookHistory({
        requestPayload: body,
        requestRaw: null,
        responsePayload: response,
        responseStatus: 200,
        success: true,
        result,
      });
      return NextResponse.json(response);
    }

    const response = {
      success: true,
      order_id: result.orderId,
      order_number: result.orderNumber,
      ...(result.ownerId ? { owner_id: result.ownerId } : {}),
      ...(result.ownerName ? { owner_name: result.ownerName } : {}),
      ...(result.warning ? { warning: result.warning } : {}),
    };
    await logWebhookHistory({
      requestPayload: body,
      requestRaw: null,
      responsePayload: response,
      responseStatus: 200,
      success: true,
      result,
    });
    return NextResponse.json(response);
  } catch (err) {
    if (err instanceof WebhookValidationError) {
      await logWebhookHistory({
        requestPayload: body,
        requestRaw: null,
        responsePayload: { error: err.message },
        responseStatus: 422,
        success: false,
        errorMessage: err.message,
      });
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    const message = err instanceof Error ? err.message : "Server error";
    console.error("[webhook/orders] unhandled error:", {
      message,
      stack: err instanceof Error ? err.stack : undefined,
      has_items: Array.isArray(body?.items) && body.items.length > 0,
      item_count: Array.isArray(body?.items) ? body.items.length : 0,
    });
    await logWebhookHistory({
      requestPayload: body,
      requestRaw: null,
      responsePayload: { error: message || "Internal server error" },
      responseStatus: 500,
      success: false,
      errorMessage: message || "Internal server error",
    });
    return NextResponse.json(
      { error: message || "Internal server error" },
      { status: 500 }
    );
  }
}
