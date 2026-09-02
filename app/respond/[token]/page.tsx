import { Printer } from "lucide-react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  collectSkuApprovalImages,
  imagesBySkuId,
  buildRespondOrderRows,
  skusForRespond,
  type RespondOrderAsset,
  type RespondOrderRow,
  type RespondSkuImage,
  type RespondFinalPdf,
} from "@/lib/respond-order";
import {
  fetchRespondOrderAssets,
  fetchRespondSkuImages,
} from "@/lib/respond-order-server";
import { OrderReview } from "@/components/respond/order-review";
import { fetchRespondFinalPdfsBySku } from "@/lib/respond-final-pdf";
import { SkuDecisionProvider } from "@/components/respond/sku-decision-context";
import { orderMetaChips, type UploadSlot } from "@/lib/respond-page";
import { itemTitleFromSpecs } from "@/lib/notification-messages";
import {
  formatReadyToShipGroupLabel,
  listOrderGroupMembers,
  orderGroupKey,
  type GroupOrderMember,
} from "@/lib/ready-to-ship-group";
import { ensureApprovalGroupPortal } from "@/lib/approval-group";
import { RespondForm } from "./respond-form";
import {
  PORTAL_FOOTER,
  PORTAL_PRODUCT_NAME,
} from "@/lib/portal-branding";
import type {
  CustomerResponse,
  NotificationStatus,
  NotificationType,
  OrderSpecs,
} from "@/lib/types";
import type { SkuItem } from "@/lib/skus";
import {
  decisionsBySkuId,
  imageDecisionsByKey,
  parseSkuApprovalNote,
  skuApprovalDisplayLines,
} from "@/lib/sku-approval";

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
  finalPdfs: Record<string, RespondFinalPdf>;
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

    let finalPdfs: RespondPart["finalPdfs"] = {};
    try {
      finalPdfs = await fetchRespondFinalPdfsBySku(
        admin,
        member.tenant_id,
        {
          id: member.id,
          title: member.title,
          specs: specs as Record<string, unknown>,
        },
        skusForRespond(specs as Record<string, unknown>)
      );
    } catch {
      // Drive lookup is optional
    }

    parts.push({
      id: member.id,
      title: member.title,
      rows: buildRespondOrderRows(description, fields, specs),
      skus: skusForRespond(specs),
      assets,
      skuImages,
      finalPdfs,
    });
  }

  return parts;
}

/**
 * For a customer_approval round, load the frozen file snapshot captured when it
 * was sent (job_notifications.approval_files). Returns them as review assets
 * whose id is `snap:<index>` (served by /api/notifications/asset), or null when
 * the round has no snapshot.
 */
async function loadFrozenApprovalAssets(
  notification: NotificationRow
): Promise<RespondOrderAsset[] | null> {
  if (notification.type !== "customer_approval") return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("job_notifications")
    .select("approval_files")
    .eq("id", notification.notification_id)
    .maybeSingle();
  const files = (data as { approval_files?: unknown } | null)?.approval_files;
  if (!Array.isArray(files) || files.length === 0) return null;
  return files.map((f, i) => {
    const file = f as { file_name?: string; mime_type?: string | null; sku_key?: string | null };
    return {
      id: `snap:${i}`,
      file_name: file.file_name ?? `File ${i + 1}`,
      mime_type: file.mime_type ?? null,
      sku_key: file.sku_key ?? null,
      size: null,
    };
  });
}

function RespondCard({
  orderTitle,
  children,
  footer,
}: {
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
            <span className="text-sm font-semibold">{PORTAL_PRODUCT_NAME}</span>
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
  const footer = notification ? <>{PORTAL_FOOTER}</> : null;

  if (!notification) {
    return (
      <RespondCard>
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

  // This part's own line-item title (each card is its own item).
  const itemTitle = itemTitleFromSpecs(
    notification.order_specs ?? {},
    productLabel,
    notification.order_title
  );

  // Titled per-SKU upload targets for the missing-info reply page. Each SKU
  // becomes its own labeled upload slot so the file is tagged to that SKU;
  // with no SKUs (legacy) we fall back to a single item-titled slot.
  const notifSkus = skusForRespond(notification.order_specs ?? {});
  const uploadSlots: UploadSlot[] =
    notification.type === "missing_info"
      ? notifSkus.length > 0
        ? notifSkus.map((sku, index) => ({
            skuKey: sku.id,
            label:
              notifSkus.length === 1
                ? itemTitle
                : sku.name.trim()
                  ? `SKU ${index + 1} — ${sku.name.trim()}`
                  : `SKU ${index + 1}`,
          }))
        : [{ skuKey: null, label: itemTitle }]
      : [];

  let headerTitle = notification.order_title;
  let orderReview: React.ReactNode = null;
  let reviewAssets: RespondOrderAsset[] = [];
  let reviewSkuImages: Record<string, RespondSkuImage[]> = {};

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
              orderId={part.id}
              finalPdfs={part.finalPdfs}
            />
          ))}
        </div>
      );
    }
  }

  // Multi-item customer approvals use a stable group portal (one SMS link for
  // the whole order). Old per-item tokens redirect there.
  if (notification.type === "customer_approval") {
    const admin = createAdminClient();
    const { data: primaryOrder } = await admin
      .from("orders")
      .select("id, title, tenant_id, column_id, description, specs")
      .eq("id", notification.order_id)
      .maybeSingle();
    if (primaryOrder) {
      const members = await listOrderGroupMembers(
        admin,
        primaryOrder.tenant_id as string,
        {
          id: primaryOrder.id as string,
          title: primaryOrder.title as string,
          column_id: primaryOrder.column_id as string | null,
          description: primaryOrder.description as string | null,
          specs: (primaryOrder.specs ?? {}) as Record<string, unknown>,
        }
      );
      if (members.length > 1) {
        const key = orderGroupKey({
          title: primaryOrder.title as string,
          specs: (primaryOrder.specs ?? {}) as Record<string, unknown>,
        });
        if (key) {
          const portal = await ensureApprovalGroupPortal(
            admin,
            primaryOrder.tenant_id as string,
            key
          );
          redirect(`/respond/g/${portal.token}`);
        }
      }
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
    // Customer approval: serve the frozen snapshot captured when THIS round was
    // sent, so the customer always sees exactly what went out — even if the
    // designer later changed the live file. Falls back to live files if this
    // round has no snapshot (older rounds / missing_info).
    const frozen = await loadFrozenApprovalAssets(notification);
    if (frozen) {
      assets = frozen;
      try {
        skuImages = await fetchRespondSkuImages(notification.order_id);
      } catch {
        // non-critical
      }
    } else {
      try {
        [assets, skuImages] = await Promise.all([
          fetchRespondOrderAssets(notification.order_id),
          fetchRespondSkuImages(notification.order_id),
        ]);
      } catch {
        // non-critical; proceed without assets
      }
    }
    let finalPdfs: Record<string, RespondFinalPdf> = {};
    try {
      const admin = createAdminClient();
      const { data: orderRow } = await admin
        .from("orders")
        .select("id, title, tenant_id, specs")
        .eq("id", notification.order_id)
        .maybeSingle();
      if (orderRow?.tenant_id) {
        finalPdfs = await fetchRespondFinalPdfsBySku(
          admin,
          orderRow.tenant_id as string,
          {
            id: orderRow.id as string,
            title: String(orderRow.title ?? ""),
            specs: (orderRow.specs ?? {}) as Record<string, unknown>,
          },
          skus
        );
      }
    } catch {
      // Drive lookup is optional
    }
    orderReview = (
      <OrderReview
        token={token}
        rows={orderRows}
        skus={skus}
        assets={assets}
        skuImages={skuImages}
        orderId={notification.order_id}
        finalPdfs={finalPdfs}
      />
    );
    reviewAssets = assets;
    reviewSkuImages = skuImages;
  }

  if (expired && !alreadyDone) {
    return (
      <RespondCard orderTitle={headerTitle} footer={footer}>
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
    const response = notification.customer_response;
    const isApproved = response === "approved";
    const isRejected = response === "changes_requested";
    const customerNote = notification.customer_note?.trim() || null;
    const staffNote = notification.staff_note?.trim() || null;
    const parsedSku = parseSkuApprovalNote(customerNote);
    const skuDecisionById = decisionsBySkuId(
      notifSkus,
      parsedSku.entries,
      parsedSku.imageEntries
    );
    const imageByKey = imageDecisionsByKey(
      notifSkus,
      imagesBySkuId(notifSkus, reviewAssets, reviewSkuImages),
      parsedSku.imageEntries
    );
    const displayLines = skuApprovalDisplayLines(parsedSku);
    const mixed =
      displayLines.some((e) => e.decision === "approved") &&
      displayLines.some((e) => e.decision === "rejected");

    const statusTitle = mixed
      ? "Partial approval"
      : isApproved
        ? "Approved"
        : isRejected
          ? "Not approved"
          : "Response received";
    const statusBody = mixed
      ? "We recorded which SKUs were approved and which need changes. Our team will be in touch shortly."
      : isApproved
        ? "Your approval has been recorded. Thank you!"
        : isRejected
          ? "Your feedback was received. Our team will be in touch shortly."
          : "We already received your response. Thank you!";

    const reviewWithSkuStatus =
      displayLines.length > 0 ? (
        <SkuDecisionProvider
          mode="result"
          byId={skuDecisionById}
          byImageKey={imageByKey}
        >
          {orderReview}
        </SkuDecisionProvider>
      ) : (
        orderReview
      );

    return (
      <RespondCard orderTitle={headerTitle} footer={footer}>
        <div className="space-y-5">
          <div
            className={
              isApproved
                ? "rounded-lg bg-emerald-50 p-4 text-center text-emerald-800"
                : isRejected
                  ? "rounded-lg bg-red-50 p-4 text-center text-red-800"
                  : "rounded-lg bg-slate-50 p-4 text-center text-slate-800"
            }
          >
            <h1 className="text-lg font-semibold">{statusTitle}</h1>
            <p className="mt-1 text-sm opacity-90">{statusBody}</p>
            {displayLines.length > 0 ? (
              <ul className="mt-3 space-y-1.5 text-left">
                {displayLines.map((entry) => (
                  <li
                    key={entry.key}
                    className={`flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm ${
                      entry.decision === "approved"
                        ? "bg-white/80 text-emerald-900"
                        : "bg-white/80 text-red-900"
                    }`}
                  >
                    <span className="min-w-0 truncate font-medium">
                      {entry.label}
                    </span>
                    <span className="shrink-0 text-xs font-semibold uppercase tracking-wide">
                      {entry.decision === "approved"
                        ? "Approved"
                        : "Not approved"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {parsedSku.comment ? (
              <div className="mt-3 rounded-md bg-white/70 px-3 py-2 text-left">
                <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
                  {isRejected ? "Reason for rejection" : "Your note"}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm">
                  &ldquo;{parsedSku.comment}&rdquo;
                </p>
              </div>
            ) : null}
          </div>

          {staffNote ? (
            <div className="rounded-r-lg border-l-[3px] border-[#1d4ed8] bg-[#f0f9ff] px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#1d4ed8]">
                Note from our team
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                {staffNote}
              </p>
            </div>
          ) : null}

          {reviewWithSkuStatus}
        </div>
      </RespondCard>
    );
  }

  return (
    <RespondCard orderTitle={headerTitle} footer={footer}>
      <RespondForm
        token={token}
        type={notification.type}
        productLabel={productLabel}
        orderNumber={headerTitle}
        itemTitle={itemTitle}
        uploadSlots={uploadSlots}
        staffNote={notification.staff_note}
        metaChips={metaChips}
        tenantName={notification.tenant_name}
        orderReview={orderReview}
        approvalSkus={
          notification.type === "customer_approval" ? notifSkus : undefined
        }
        approvalAssets={
          notification.type === "customer_approval"
            ? reviewAssets.filter(
                (a) =>
                  Boolean(a.sku_key) &&
                  notifSkus.some((s) => s.id === a.sku_key)
              )
            : undefined
        }
        approvalSkuGallery={
          notification.type === "customer_approval" ? reviewSkuImages : undefined
        }
      />
    </RespondCard>
  );
}
