import { Printer } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  buildRespondOrderRows,
  fetchRespondOrderAssets,
  fetchRespondSkuImages,
  skusForRespond,
  type RespondOrderAsset,
  type RespondSkuImage,
} from "@/lib/respond-order";
import { OrderReview } from "@/components/respond/order-review";
import { orderMetaChips } from "@/lib/respond-page";
import { RespondForm } from "./respond-form";
import type {
  CustomerResponse,
  NotificationStatus,
  NotificationType,
  OrderSpecs,
} from "@/lib/types";

interface NotificationRow {
  notification_id: string;
  order_id: string;
  type: NotificationType;
  status: NotificationStatus;
  token_expires_at: string | null;
  staff_note: string | null;
  customer_note: string | null;
  customer_response: CustomerResponse | null;
  order_title: string;
  order_description: string | null;
  order_specs: OrderSpecs;
  order_fields: Record<string, unknown>;
  tenant_name: string;
  responded_at: string | null;
}

function productFromFields(fields: Record<string, unknown>): string {
  const product = fields["Product"] ?? fields["product"];
  return product ? String(product) : "order";
}

function RespondCard({
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
        <div className="flex items-center justify-between bg-[#1d4ed8] px-4 py-3 text-white">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20">
              <Printer className="h-4 w-4" />
            </span>
            <span className="text-sm font-semibold">{tenantName}</span>
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

export default async function RespondPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createClient();
  const { data, error: rpcError } = await supabase.rpc("get_notification_by_token", {
    p_token: token,
  });

  const notification = (data as NotificationRow[] | null)?.[0] ?? null;
  const footer = notification ? (
    <>
      This link expires in 7 days · Powered by {notification.tenant_name}
    </>
  ) : null;

  if (!notification) {
    return (
      <RespondCard tenantName="BazaarPrinting">
        <div className="text-center">
          <h1 className="text-lg font-semibold text-slate-800">
            Link not found
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            This link is invalid or has already been used.
          </p>
        </div>
      </RespondCard>
    );
  }

  const expiredByDate =
    notification.token_expires_at != null &&
    new Date(notification.token_expires_at).getTime() < Date.now();
  const expired =
    notification.status === "expired" ||
    (expiredByDate && notification.status !== "responded");
  const alreadyDone = notification.status === "responded";
  const orderFields = notification.order_fields ?? {};
  const productLabel = productFromFields(orderFields);
  const metaChips = orderMetaChips(orderFields, notification.order_specs ?? {});
  const orderRows = buildRespondOrderRows(
    notification.order_description,
    orderFields,
    notification.order_specs ?? {}
  );
  const skus = skusForRespond(notification.order_specs ?? {});
  let assets: RespondOrderAsset[] = [];
  let skuImages: Record<string, RespondSkuImage[]> = {};
  try {
    [assets, skuImages] = await Promise.all([
      fetchRespondOrderAssets(notification.order_id),
      fetchRespondSkuImages(notification.order_id),
    ]);
  } catch {
    // non-critical; proceed without assets
  }

  if (expired && !alreadyDone) {
    return (
      <RespondCard
        tenantName={notification.tenant_name}
        orderTitle={notification.order_title}
        footer={footer}
      >
        <div className="text-center">
          <h1 className="text-lg font-semibold text-slate-800">Link expired</h1>
          <p className="mt-2 text-sm text-slate-500">
            This link has expired. Please contact us directly.
          </p>
        </div>
      </RespondCard>
    );
  }

  if (alreadyDone) {
    return (
      <RespondCard
        tenantName={notification.tenant_name}
        orderTitle={notification.order_title}
        footer={footer}
      >
        <div className="text-center">
          <h1 className="text-lg font-semibold text-slate-800">Thank you</h1>
          <p className="mt-2 text-sm text-slate-600">
            We already received your response. Thank you!
          </p>
        </div>
      </RespondCard>
    );
  }

  return (
    <RespondCard
      tenantName={notification.tenant_name}
      orderTitle={notification.order_title}
      footer={footer}
    >
      <RespondForm
        token={token}
        type={notification.type}
        productLabel={productLabel}
        orderNumber={notification.order_title}
        staffNote={notification.staff_note}
        metaChips={metaChips}
        tenantName={notification.tenant_name}
        orderReview={
          <OrderReview
            token={token}
            rows={orderRows}
            skus={skus}
            assets={assets}
            skuImages={skuImages}
          />
        }
      />
    </RespondCard>
  );
}
