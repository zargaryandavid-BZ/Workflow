import { createAdminClient } from "@/lib/supabase/admin";
import {
  loadApprovalGroupItemSummaries,
  type ApprovalGroupItemSummary,
} from "@/lib/approval-group";
import {
  formatReadyToShipGroupLabel,
  listOrderGroupMembers,
} from "@/lib/ready-to-ship-group";
import {
  buildRespondOrderRows,
  respondCustomerNote,
  skusForRespond,
  type RespondOrderAsset,
} from "@/lib/respond-order";
import {
  fetchRespondOrderAssets,
  fetchRespondSkuImages,
} from "@/lib/respond-order-server";
import { orderMetaChips } from "@/lib/respond-page";
import type { OrderSpecs } from "@/lib/types";
import {
  ApprovalGroupView,
  type ApprovalGroupItemPayload,
  type ApprovalGroupProof,
} from "./approval-group-view";
import { alignSkusToPdfPages } from "@/lib/shared-pdf-pages";

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
    const cf = row.custom_fields as
      | { name?: string }
      | { name?: string }[]
      | null;
    const name = Array.isArray(cf) ? cf[0]?.name : cf?.name;
    if (name) fields[name] = row.value;
  }
  return fields;
}

async function loadFrozenApprovalAssets(
  admin: ReturnType<typeof createAdminClient>,
  notificationId: string | null
): Promise<RespondOrderAsset[] | null> {
  if (!notificationId) return null;
  const { data } = await admin
    .from("job_notifications")
    .select("approval_files")
    .eq("id", notificationId)
    .maybeSingle();
  const files = (data as { approval_files?: unknown } | null)?.approval_files;
  if (!Array.isArray(files) || files.length === 0) return null;
  return files.map((f, i) => {
    const file = f as {
      file_name?: string;
      mime_type?: string | null;
      sku_key?: string | null;
    };
    return {
      id: `snap:${i}`,
      file_name: file.file_name ?? `File ${i + 1}`,
      mime_type: file.mime_type ?? null,
      sku_key: file.sku_key ?? null,
      size: null,
    };
  });
}

async function buildItem(
  admin: ReturnType<typeof createAdminClient>,
  summary: ApprovalGroupItemSummary,
  member: {
    id: string;
    title: string;
    tenant_id: string;
    description: string | null;
    specs: Record<string, unknown>;
  },
  fields: Record<string, unknown>
): Promise<{
  payload: ApprovalGroupItemPayload;
}> {
  const specs = (member.specs ?? {}) as OrderSpecs;
  const rawProduct = fields["Product"] ?? fields["product"];
  const product = rawProduct ? String(rawProduct) : "order";

  let assets: RespondOrderAsset[] = [];
  let skuImages: Record<
    string,
    Awaited<ReturnType<typeof fetchRespondSkuImages>>[string]
  > = {};

  const frozen = await loadFrozenApprovalAssets(admin, summary.notificationId);
  if (frozen) {
    assets = frozen;
    try {
      skuImages = await fetchRespondSkuImages(member.id);
    } catch {
      // non-critical
    }
  } else {
    try {
      [assets, skuImages] = await Promise.all([
        fetchRespondOrderAssets(member.id),
        fetchRespondSkuImages(member.id),
      ]);
    } catch {
      // non-critical
    }
  }

  const ticketSkus = skusForRespond(specs);
  let approvalSkus = ticketSkus;
  let finalPdfs: Record<string, import("@/lib/respond-order").RespondFinalPdf> =
    {};
  let layerPreviews: Record<
    string,
    import("@/lib/approval-layer-preview-paths").RespondLayerPreview
  > = {};
  if (summary.notificationToken) {
    try {
      const {
        loadRespondPreviewIndex,
        expandRespondPreviewIndex,
        respondProofFromIndex,
      } = await import("@/lib/approval-layer-previews");
      const index = await loadRespondPreviewIndex(member.id);
      if (index) {
        const expanded = expandRespondPreviewIndex(index, ticketSkus);
        approvalSkus = alignSkusToPdfPages(ticketSkus, expanded.pages.length);
        const proof = respondProofFromIndex(expanded);
        finalPdfs = proof.finalPdfs;
        layerPreviews = proof.layerPreviews;
      }
    } catch (err) {
      console.error("[approval-group] proof load failed:", err);
    }
  }
  const skuIds = new Set(approvalSkus.map((s) => s.id));
  const proof: ApprovalGroupProof | null =
    summary.notificationToken != null
      ? {
          token: summary.notificationToken,
          heading: summary.itemLabel,
          rows: buildRespondOrderRows(member.description, fields, specs),
          skus: approvalSkus,
          assets,
          skuImages,
          orderId: member.id,
          customerNote: respondCustomerNote(member.description, specs),
          finalPdfs,
          layerPreviews,
        }
      : null;
  const payload: ApprovalGroupItemPayload = {
    summary,
    metaChips: orderMetaChips(fields, specs),
    productLabel: product,
    approvalSkus,
    approvalAssets: assets.filter(
      (a) => a.sku_key != null && skuIds.has(a.sku_key)
    ),
    approvalSkuGallery: skuImages,
    approvalPdfPageBySku: {},
    proof,
  };

  return { payload };
}

export default async function ApprovalGroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ item?: string | string[] }>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const initialItem = Array.isArray(sp.item) ? sp.item[0] : sp.item ?? null;
  const supabase = createAdminClient();
  const { data } = await supabase.rpc("get_approval_group_portal_by_token", {
    p_token: token,
  });

  const portal = (
    data as
      | {
          portal_id: string;
          tenant_id: string;
          group_key: string;
          tenant_name: string;
        }[]
      | null
  )?.[0];

  if (!portal) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f8fafc] p-4">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-slate-800">Link not found</h1>
          <p className="mt-2 text-sm text-slate-500">
            This approval link is invalid or has expired.
          </p>
        </div>
      </div>
    );
  }

  const admin = createAdminClient();

  const { data: byWebhook } = await admin
    .from("orders")
    .select("id, title, tenant_id, column_id, description, specs")
    .eq("tenant_id", portal.tenant_id)
    .is("removed_at", null)
    .eq("specs->>webhook_order_number", portal.group_key)
    .limit(1);

  type SeedOrder = {
    id: string;
    title: string;
    tenant_id: string;
    column_id: string | null;
    description: string | null;
    specs: Record<string, unknown>;
  };

  let seed = ((byWebhook ?? [])[0] ?? null) as SeedOrder | null;

  if (!seed) {
    const { data: byTitle } = await admin
      .from("orders")
      .select("id, title, tenant_id, column_id, description, specs")
      .eq("tenant_id", portal.tenant_id)
      .is("removed_at", null)
      .ilike("title", `${portal.group_key}-%`)
      .limit(1);
    seed = ((byTitle ?? [])[0] ?? null) as SeedOrder | null;
  }

  if (!seed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f8fafc] p-4">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-slate-800">Order not found</h1>
          <p className="mt-2 text-sm text-slate-500">
            We could not load the items for this approval link.
          </p>
        </div>
      </div>
    );
  }

  const members = await listOrderGroupMembers(admin, portal.tenant_id, seed);

  const fieldByOrderId = new Map<string, Record<string, unknown>>();
  await Promise.all(
    members.map(async (m) => {
      fieldByOrderId.set(m.id, await loadOrderFields(admin, m.id));
    })
  );

  const summaries = await loadApprovalGroupItemSummaries(
    admin,
    members,
    fieldByOrderId
  );

  const payloads: ApprovalGroupItemPayload[] = [];

  const built = await Promise.all(
    summaries.map((summary) => {
      const member = members.find((m) => m.id === summary.orderId)!;
      return buildItem(
        admin,
        summary,
        member,
        fieldByOrderId.get(member.id) ?? {}
      );
    })
  );
  for (let i = 0; i < summaries.length; i++) {
    payloads.push(built[i]!.payload);
  }

  const groupLabel = formatReadyToShipGroupLabel(members);

  return (
    <ApprovalGroupView
      groupLabel={groupLabel}
      tenantName={portal.tenant_name}
      items={payloads}
      initialItem={initialItem}
    />
  );
}
