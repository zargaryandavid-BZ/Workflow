import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { orderIdsForReadyToShipToken } from "@/lib/ready-to-ship-group";

const BUCKET = "order-assets";

/** Resolve allowed order IDs for a token (notification or approval). */
async function resolveTokenOrderIds(
  admin: ReturnType<typeof createAdminClient>,
  token: string
): Promise<{ orderIds: string[]; expired: boolean }> {
  const [{ data: notification }, { data: approval }] = await Promise.all([
    admin
      .from("job_notifications")
      .select("order_id, status, token_expires_at, type")
      .eq("token", token)
      .maybeSingle(),
    admin
      .from("approvals")
      .select("order_id, status")
      .eq("token", token)
      .maybeSingle(),
  ]);

  if (notification) {
    const expiredByDate =
      notification.token_expires_at != null &&
      new Date(notification.token_expires_at).getTime() < Date.now();
    const expired =
      notification.status === "expired" ||
      (expiredByDate && notification.status !== "responded");

    if (notification.type === "ready_to_ship") {
      const orderIds = await orderIdsForReadyToShipToken(admin, token);
      return {
        orderIds:
          orderIds.length > 0 ? orderIds : [notification.order_id as string],
        expired,
      };
    }

    return { orderIds: [notification.order_id as string], expired };
  }

  if (approval) {
    return { orderIds: [approval.order_id as string], expired: false };
  }

  return { orderIds: [], expired: false };
}

/**
 * Token-gated download for order artwork on client respond / approve pages.
 * Supports two asset types via the `type` query param:
 *   - (default) "asset"    — rows from the `assets` table
 *   - "sku_image"          — rows from the `order_sku_images` table
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  const id = searchParams.get("id");
  const type = searchParams.get("type") ?? "asset";

  if (!token || !id) {
    return NextResponse.json(
      { error: "token and id are required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Frozen approval snapshot: id = "snap:<index>" into this round's
  // job_notifications.approval_files (the file the customer saw when sent).
  if (id.startsWith("snap:")) {
    const index = Number(id.slice("snap:".length));
    const { data: notif } = await admin
      .from("job_notifications")
      .select("approval_files, token_expires_at, status")
      .eq("token", token)
      .maybeSingle();
    if (!notif) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const n = notif as {
      approval_files?: Array<{
        file_name?: string;
        storage_path?: string | null;
        external_url?: string | null;
      }> | null;
      token_expires_at?: string | null;
      status?: string;
    };
    const expired =
      n.status !== "responded" &&
      n.token_expires_at != null &&
      new Date(n.token_expires_at).getTime() < Date.now();
    if (expired) {
      return NextResponse.json({ error: "Link expired" }, { status: 403 });
    }
    const file = n.approval_files?.[index];
    if (!file) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (file.external_url?.trim()) {
      return NextResponse.redirect(file.external_url);
    }
    if (!file.storage_path) {
      return NextResponse.json({ error: "File has no content" }, { status: 400 });
    }
    const { data: signed, error } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(file.storage_path, 3600, {
        download: file.file_name ?? "file",
      });
    if (error || !signed) {
      return NextResponse.json(
        { error: error?.message ?? "Could not sign URL" },
        { status: 400 }
      );
    }
    return NextResponse.redirect(signed.signedUrl);
  }

  if (type === "final_pdf") {
    const orderId = searchParams.get("order");
    if (!orderId) {
      return NextResponse.json(
        { error: "order is required for final_pdf" },
        { status: 400 }
      );
    }

    const { orderIds, expired } = await resolveTokenOrderIds(admin, token);
    if (!orderIds.includes(orderId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (expired) {
      return NextResponse.json({ error: "Link expired" }, { status: 403 });
    }

    const { data: order } = await admin
      .from("orders")
      .select("id, title, tenant_id, specs")
      .eq("id", orderId)
      .maybeSingle();
    if (!order) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { skusForRespond } = await import("@/lib/respond-order");
    const { isRespondFinalPdfForOrder } = await import(
      "@/lib/respond-final-pdf"
    );
    const { proofsDriveClient, downloadDriveFileBytes } = await import(
      "@/lib/gdrive-proofs"
    );
    const { ensureGdriveSettings } = await import("@/lib/gdrive-settings");

    const specs = (order.specs ?? {}) as Record<string, unknown>;
    const allowed = await isRespondFinalPdfForOrder(
      admin,
      order.tenant_id as string,
      {
        id: order.id as string,
        title: String(order.title ?? ""),
        specs,
      },
      skusForRespond(specs),
      id
    );
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    try {
      const settings = await ensureGdriveSettings(
        admin,
        order.tenant_id as string
      );
      const client = proofsDriveClient(settings);
      const downloaded = await downloadDriveFileBytes(client, id);
      if (!downloaded) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return new NextResponse(new Uint8Array(downloaded.buffer), {
        headers: {
          "Content-Type": downloaded.mimeType.includes("pdf")
            ? "application/pdf"
            : downloaded.mimeType,
          "Cache-Control": "private, max-age=120",
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Download failed";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  if (type === "sku_image") {
    const { data: skuImage } = await admin
      .from("order_sku_images")
      .select("id, order_id, file_name, storage_path")
      .eq("id", id)
      .maybeSingle();

    if (!skuImage) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { orderIds, expired } = await resolveTokenOrderIds(admin, token);
    if (!orderIds.includes(skuImage.order_id as string)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (expired) {
      return NextResponse.json({ error: "Link expired" }, { status: 403 });
    }

    const { data: signed, error } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(skuImage.storage_path as string, 3600, {
        download: skuImage.file_name as string,
      });

    if (error || !signed) {
      return NextResponse.json(
        { error: error?.message ?? "Could not sign URL" },
        { status: 400 }
      );
    }

    return NextResponse.redirect(signed.signedUrl);
  }

  // Default: serve from assets table
  const { data: asset } = await admin
    .from("assets")
    .select("id, order_id, file_name, storage_path, notification_id, is_locked")
    .eq("id", id)
    .maybeSingle();

  if (!asset) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (asset.notification_id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Locked reference images (CRM/manager attachment) are internal-only.
  if ((asset as { is_locked?: boolean }).is_locked) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { orderIds, expired } = await resolveTokenOrderIds(admin, token);
  if (!orderIds.includes(asset.order_id as string)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (expired) {
    return NextResponse.json({ error: "Link expired" }, { status: 403 });
  }

  const { data: signed, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(asset.storage_path, 3600, {
      download: asset.file_name,
    });

  if (error || !signed) {
    return NextResponse.json(
      { error: error?.message ?? "Could not sign URL" },
      { status: 400 }
    );
  }

  return NextResponse.redirect(signed.signedUrl);
}
