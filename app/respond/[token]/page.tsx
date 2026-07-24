import { Printer } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildRespondOrderRows,
  fetchRespondOrderAssets,
  fetchRespondSkuImages,
  skusForRespond,
  type RespondOrderAsset,
  type RespondOrderRow,
  type RespondSkuImage,
} from "@/lib/respond-order";
import { OrderReview } from "@/components/respond/order-review";
import { orderMetaChips } from "@/lib/respond-page";
import {
  formatReadyToShipGroupLabel,
  listOrderGroupMembers,
  type GroupOrderMember,
} from "@/lib/ready-to-ship-group";
import { RespondForm } from "./respond-form";
import type {
  CustomerResponse,
  NotificationStatus,
  NotificationType,
  OrderSpecs,
} from "@/lib/types";
import type { SkuItem } from "@/lib/skus";

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

type RespondPart = {
  id: string;
  title: string;
  rows: RespondOrderRow[];
  skus: SkuItem[];
  assets: RespondOrderAsset[];
  skuImages: Record<string, RespondSkuImage[]>;
};

function productFromFields(fields: Record<string, unknown>): string {
  const product = fields["Product"] ?? fields["product"];
  return product ? String(product) : "order";
}

async function loadOrderFields(
  admin: ReturnType<typeof createAdminClient>,
  orderId: string
): Promise<Record<string, unknown>> {
  const { data } = await admin
    .from("custom_field_values")
    .select("value, custom_fields(name)")
    .eq("order_id", orderId);

  const fields: Record<string, unknown> = {};
  for (const row of data ?? []) {
    const cf = row.custom_fields as { name?: string } | { name?: string }[] | null;
    const name = Array.isArray(cf) ? cf[0]?.name : cf?.name;
    if (name) fields[name] = row.value;
  }
  return fields;
}

async function buildRespondParts(
  members: GroupOrderMember[],
  primary: NotificationRow
): Promise<RespondPart[]> {
  const admin = createAdminClient();
  const parts: RespondPart[] = [];

  for (const member of members) {
    const isPrimary = member.id === primary.order_id;
    const fields = isPrimary
      ? primary.order_fields ?? {}
      : await loadOrderFields(admin, member.id);
    const description = isPrimary
      ? primary.order_description
      : member.description;
    const specs = isPrimary
      ? (primary.order_specs ?? {})
      : (member.specs ?? {});

    let assets: RespondOrderAsset[] = [];
    let skuImages: Record<string, RespondSkuImage[]> = {};
    try {
      [assets, skuImages] = await Promise.all([
        fetchRespondOrderAssets(member.id),
        fetchRespondSkuImages(member.id),
      ]);
    } catch {
      // non-critical
    }

    parts.push({
      id: member.id,
      title: member.title,
      rows: buildRespondOrderRows(description, fields, specs),
      skus: skusForRespond(specs),
      assets,
      skuImages,
    });
  }

  return parts;
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
  const { data } = await supabase.rpc("get_notification_by_token", {
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

  let headerTitle = notification.order_title;
  let orderReview: React.ReactNode = null;

  if (notification.type === "ready_to_ship") {
    const admin = createAdminClient();
    const { data: primaryOrder } = await admin
      .from("orders")
      .select("id, title, tenant_id, column_id, description, specs")
      .eq("id", notification.order_id)
      .maybeSingle();

    const members = primaryOrder
      ? await listOrderGroupMembers(admin, primaryOrder.tenant_id as string, {
          id: primaryOrder.id as string,
          title: primaryOrder.title as string,
          column_id: primaryOrder.column_id as string | null,
          description: primaryOrder.description as string | null,
          specs: (primaryOrder.specs ?? {}) as Record<string, unknown>,
        })
      : [];

    if (members.length > 1) {
      headerTitle = formatReadyToShipGroupLabel(members);
      const parts = await buildRespondParts(members, notification);
      orderReview = (
        <div className="space-y-4">
          {parts.map((part) => (
            <OrderReview
              key={part.id}
              token={token}
              heading={part.title}
              rows={part.rows}
              skus={part.skus}
              assets={part.assets}
              skuImages={part.skuImages}
            />
          ))}
        </div>
      );
    }
  }

  if (!orderReview) {
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
    orderReview = (
      <OrderReview
        token={token}
        rows={orderRows}
        skus={skus}
        assets={assets}
        skuImages={skuImages}
      />
    );
  }

  if (expired && !alreadyDone) {
    return (
      <RespondCard
        tenantName={notification.tenant_name}
        orderTitle={headerTitle}
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
        orderTitle={headerTitle}
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
      orderTitle={headerTitle}
      footer={footer}
    >
      <RespondForm
        token={token}
        type={notification.type}
        productLabel={productLabel}
        orderNumber={headerTitle}
        staffNote={notification.staff_note}
        metaChips={metaChips}
        tenantName={notification.tenant_name}
        orderReview={orderReview}
      />
    </RespondCard>
  );
}
