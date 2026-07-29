import "server-only";

import JSZip from "jszip";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadOrderExportData } from "@/lib/button-automation-order-data";
import { createFedExShipment } from "@/lib/fedex";
import { ORDER_ASSETS_BUCKET } from "@/lib/order-assets";
import {
  loadShippingSettings,
  resolveFedExConfig,
} from "@/lib/shipping-settings";
import type {
  FedExRateOption,
  FedExShipmentStatus,
  ShippingBox,
  ShippingDeliveryAddress,
  ShippingRequest,
} from "@/lib/types";

export type EnsureFedExLabelResult =
  | {
      ok: true;
      skipped?: boolean;
      trackingNumber: string | null;
      status: FedExShipmentStatus | null;
      storagePath: string | null;
    }
  | {
      ok: false;
      error: string;
      status: FedExShipmentStatus;
    };

function isFedExDeliveryRequest(row: {
  client_choice: string | null;
  fedex_selection: FedExRateOption | null;
}): boolean {
  if (row.client_choice !== "delivery") return false;
  if (row.fedex_selection?.provider === "curri") return false;
  return Boolean(row.fedex_selection?.serviceType);
}

async function markFailed(
  admin: SupabaseClient,
  shippingRequestId: string,
  error: string
): Promise<EnsureFedExLabelResult> {
  const message = error.slice(0, 500);
  await admin
    .from("shipping_requests")
    .update({
      fedex_shipment_status: "failed",
      fedex_label_error: message,
    })
    .eq("id", shippingRequestId);

  return { ok: false, error: message, status: "failed" };
}

/**
 * Create a FedEx shipment label for a confirmed FedEx delivery request.
 * Idempotent: skips when a label already exists.
 * Failures are recorded on the row and do not throw to the caller path.
 */
export async function ensureFedExLabel(
  admin: SupabaseClient,
  shippingRequestId: string,
  options?: { force?: boolean }
): Promise<EnsureFedExLabelResult> {
  const force = Boolean(options?.force);
  const { data: row, error: findError } = await admin
    .from("shipping_requests")
    .select("*")
    .eq("id", shippingRequestId)
    .maybeSingle();

  if (findError || !row) {
    return {
      ok: false,
      error: findError?.message ?? "Shipping request not found",
      status: "failed",
    };
  }

  const request = row as ShippingRequest;

  if (!isFedExDeliveryRequest(request)) {
    return {
      ok: true,
      skipped: true,
      trackingNumber: null,
      status: null,
      storagePath: null,
    };
  }

  if (
    request.fedex_shipment_status === "created" &&
    request.fedex_tracking_number &&
    request.fedex_label_storage_path
  ) {
    return {
      ok: true,
      skipped: true,
      trackingNumber: request.fedex_tracking_number,
      status: "created",
      storagePath: request.fedex_label_storage_path,
    };
  }

  // Avoid double-booking when Stripe webhook and portal confirm race.
  // Staff retry uses force=true to continue from pending/failed.
  if (!force && request.fedex_shipment_status === "pending") {
    return {
      ok: true,
      skipped: true,
      trackingNumber: request.fedex_tracking_number,
      status: "pending",
      storagePath: request.fedex_label_storage_path,
    };
  }

  await admin
    .from("shipping_requests")
    .update({
      fedex_shipment_status: "pending",
      fedex_label_error: null,
    })
    .eq("id", shippingRequestId);

  const settings = await loadShippingSettings(admin, request.tenant_id);
  const config = resolveFedExConfig(settings);

  const shipperName = config.shipperContactName?.trim();
  const shipperPhone = config.shipperPhone?.trim();
  if (!shipperName || !shipperPhone) {
    return markFailed(
      admin,
      shippingRequestId,
      "Shipper contact name and phone are required for FedEx labels. Add them in Settings → Shipping."
    );
  }

  const address = request.delivery_address as ShippingDeliveryAddress | null;
  if (
    !address?.street?.trim() ||
    !address?.city?.trim() ||
    !address?.state?.trim() ||
    !address?.zip?.trim()
  ) {
    return markFailed(
      admin,
      shippingRequestId,
      "Delivery address is missing; cannot create FedEx label."
    );
  }

  const boxes = Array.isArray(request.boxes)
    ? (request.boxes as ShippingBox[])
    : [];
  if (boxes.length === 0) {
    return markFailed(
      admin,
      shippingRequestId,
      "Box sizes are required to create a FedEx label."
    );
  }

  const serviceType = request.fedex_selection?.serviceType?.trim();
  if (!serviceType) {
    return markFailed(
      admin,
      shippingRequestId,
      "FedEx service type is missing."
    );
  }

  const exportData = await loadOrderExportData(
    admin,
    request.order_id,
    request.tenant_id,
    ""
  );
  if (!exportData) {
    return markFailed(admin, shippingRequestId, "Order not found.");
  }

  const recipientPhone = exportData.customerPhone?.trim() || null;
  if (!recipientPhone) {
    return markFailed(
      admin,
      shippingRequestId,
      "Customer phone is required for FedEx labels. Add a phone on the order customer."
    );
  }

  const recipientName =
    exportData.customerName && exportData.customerName !== "—"
      ? exportData.customerName
      : exportData.order.customer?.name?.trim() || "Customer";

  try {
    const created = await createFedExShipment({
      boxes,
      deliveryAddress: {
        street: address.street.trim(),
        city: address.city.trim(),
        state: address.state.trim().toUpperCase(),
        zip: address.zip.trim(),
        country: (address.country ?? "US").trim().toUpperCase() || "US",
      },
      serviceType,
      settings,
      shipperContact: {
        personName: shipperName,
        phoneNumber: shipperPhone,
      },
      recipientContact: {
        personName: recipientName,
        phoneNumber: recipientPhone,
      },
    });

    let fileBytes: Buffer;
    let fileName: string;
    let contentType: string;

    if (created.labelPdfs.length === 1) {
      fileBytes = created.labelPdfs[0]!;
      fileName = `fedex-label-${shippingRequestId}.pdf`;
      contentType = "application/pdf";
    } else {
      const zip = new JSZip();
      created.labelPdfs.forEach((pdf, i) => {
        zip.file(`fedex-label-package-${i + 1}.pdf`, pdf);
      });
      fileBytes = Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
      fileName = `fedex-labels-${shippingRequestId}.zip`;
      contentType = "application/zip";
    }

    const storagePath = `${request.tenant_id}/shipping-labels/${fileName}`;

    const { error: uploadError } = await admin.storage
      .from(ORDER_ASSETS_BUCKET)
      .upload(storagePath, fileBytes, {
        contentType,
        upsert: true,
      });

    if (uploadError) {
      return markFailed(
        admin,
        shippingRequestId,
        `Label created but storage upload failed: ${uploadError.message}`
      );
    }

    const { error: updateError } = await admin
      .from("shipping_requests")
      .update({
        fedex_tracking_number: created.trackingNumber,
        fedex_label_storage_path: storagePath,
        fedex_shipment_status: "created",
        fedex_label_error: null,
        fedex_shipped_at: new Date().toISOString(),
      })
      .eq("id", shippingRequestId);

    if (updateError) {
      return markFailed(
        admin,
        shippingRequestId,
        `Label stored but failed to update request: ${updateError.message}`
      );
    }

    return {
      ok: true,
      trackingNumber: created.trackingNumber,
      status: "created",
      storagePath,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create FedEx label";
    console.error("[ensureFedExLabel]", shippingRequestId, message);
    return markFailed(admin, shippingRequestId, message);
  }
}
