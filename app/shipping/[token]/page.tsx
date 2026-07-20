import { Package } from "lucide-react";
import {
  thumbnailUrlsByOrder,
  type OrderAssetPreviewRow,
} from "@/lib/board-card-previews";
import { defaultDeliveryAddress } from "@/lib/shipping-address";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  ShippingPortalClient,
  type ShippingPortalData,
} from "@/components/shipping/shipping-portal-client";
import type {
  FedExRateOption,
  ShippingBox,
  ShippingClientChoice,
  ShippingDeliveryAddress,
} from "@/lib/types";

interface ShippingRpcRow {
  shipping_request_id: string;
  status: string;
  boxes: ShippingBox[] | null;
  client_choice: ShippingClientChoice | null;
  fedex_selection: FedExRateOption | null;
  delivery_address: ShippingDeliveryAddress | null;
  delivery_notes: string | null;
  expires_at: string | null;
  responded_at: string | null;
  order_id: string;
  order_title: string;
  order_fields: Record<string, unknown> | null;
  tenant_name: string;
  tenant_id: string;
  payment_enabled: boolean;
  payment_status: string | null;
  payment_amount: number | null;
  payment_currency: string | null;
  shipper_street: string | null;
  shipper_city: string | null;
  shipper_state: string | null;
  shipper_zip: string | null;
  shipper_country: string | null;
  pickup_hours_note: string | null;
  offer_pickup: boolean | null;
  offer_fedex: boolean | null;
  offer_uber: boolean | null;
  offer_curri: boolean | null;
}

function productFromFields(fields: Record<string, unknown> | null): string {
  if (!fields) return "";
  const product = fields["Product"] ?? fields["product"];
  return product ? String(product) : "";
}

function pickupLinesFromRow(row: ShippingRpcRow): string[] {
  const street = row.shipper_street?.trim() || "306 Boyd St";
  const city = row.shipper_city?.trim() || "Los Angeles";
  const state = row.shipper_state?.trim() || "CA";
  const zip = row.shipper_zip?.trim() || "90013";
  const hours =
    row.pickup_hours_note?.trim() ||
    "Available for pickup: Mon–Fri 9:30 AM – 5:30 PM, Sat until 4:00 PM";
  return [street, `${city}, ${state} ${zip}`, hours];
}

/** Same first image as the board card (SKU gallery, then order assets). */
async function mainImageUrlForOrder(orderId: string): Promise<string | null> {
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return null;
  }

  const [skuImagesRes, assetsRes] = await Promise.all([
    admin
      .from("order_sku_images")
      .select("order_id, storage_path, file_name, mime_type, position, created_at")
      .eq("order_id", orderId)
      .order("position", { ascending: true }),
    admin
      .from("assets")
      .select("order_id, storage_path, external_url, file_name, mime_type, created_at")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true }),
  ]);

  const skuRows: OrderAssetPreviewRow[] = (skuImagesRes.data ?? []).map(
    (r) => ({
      order_id: r.order_id as string,
      storage_path: r.storage_path as string | null,
      external_url: null,
      file_name: r.file_name as string,
      mime_type: r.mime_type as string | null,
      created_at: r.created_at as string,
    })
  );
  const assetRows = (assetsRes.data ?? []) as OrderAssetPreviewRow[];
  const byOrder = await thumbnailUrlsByOrder(
    [...skuRows, ...assetRows],
    async (paths) => {
      const { data: signed } = await admin.storage
        .from("order-assets")
        .createSignedUrls(paths, 3600);
      return new Map(
        ((signed ?? []) as { path: string | null; signedUrl: string }[])
          .filter((s) => s.path)
          .map((s) => [s.path as string, s.signedUrl])
      );
    }
  );
  return byOrder[orderId]?.[0] ?? null;
}

function PortalShell({
  tenantName,
  orderTitle,
  children,
  footer,
}: {
  tenantName: string;
  orderTitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#f8fafc] px-4 py-8">
      <div className="mx-auto w-full max-w-[640px] overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-sm">
        <div className="flex items-center justify-between bg-[#1a1f2e] px-4 py-3 text-white">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15">
              <Package className="h-4 w-4" />
            </span>
            <span className="text-sm font-semibold tracking-wide">
              {tenantName}
            </span>
          </div>
          {orderTitle ? (
            <span className="text-sm text-white/90">Order {orderTitle}</span>
          ) : null}
        </div>
        <div className="p-6">{children}</div>
        {footer ? (
          <div className="border-t border-slate-100 px-6 py-4 text-center text-xs text-slate-400">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default async function ShippingPortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ payment?: string; session_id?: string }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const { data, error: rpcError } = await supabase.rpc(
    "get_shipping_request_by_token",
    { p_token: token }
  );

  const row = (data as ShippingRpcRow[] | null)?.[0] ?? null;

  if (rpcError || !row) {
    return (
      <PortalShell tenantName="BazaarPrinting">
        <div className="text-center">
          <h1 className="text-lg font-semibold text-slate-800">
            Link not found
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            This link is invalid or no longer available.
          </p>
        </div>
      </PortalShell>
    );
  }

  const expiredWarning =
    row.expires_at != null &&
    new Date(row.expires_at).getTime() < Date.now() &&
    row.status !== "client_responded";

  const paymentReturnSessionId =
    query.payment === "success" && query.session_id
      ? query.session_id
      : null;

  const mainImageUrl = await mainImageUrlForOrder(row.order_id);

  const portalData: ShippingPortalData = {
    token,
    status: row.status,
    boxes: Array.isArray(row.boxes) ? row.boxes : [],
    clientChoice: row.client_choice,
    fedexSelection: row.fedex_selection,
    deliveryAddress: defaultDeliveryAddress(
      row.order_fields,
      row.delivery_address
    ),
    deliveryNotes: row.delivery_notes ?? "",
    expiresAt: row.expires_at,
    orderTitle: row.order_title,
    productLabel: productFromFields(row.order_fields),
    tenantName: row.tenant_name,
    expiredWarning,
    paymentEnabled: Boolean(row.payment_enabled),
    pickupLines: pickupLinesFromRow(row),
    offerPickup: row.offer_pickup !== false,
    offerFedex: row.offer_fedex !== false,
    offerUber: row.offer_uber !== false,
    offerCurri: Boolean(row.offer_curri),
    paymentReturnSessionId,
    paymentCancelled: query.payment === "cancelled",
    mainImageUrl,
  };

  return (
    <PortalShell
      tenantName={row.tenant_name}
      orderTitle={row.order_title}
      footer={
        <>
          This link expires in 7 days · Powered by {row.tenant_name}
        </>
      }
    >
      <ShippingPortalClient data={portalData} />
    </PortalShell>
  );
}
