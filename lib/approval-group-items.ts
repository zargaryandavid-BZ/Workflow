import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApprovalGroupItemSummary } from "@/lib/approval-group";
import type { GroupOrderMember } from "@/lib/ready-to-ship-group";
import { itemTitleFromSpecs } from "@/lib/notification-messages";
import {
  buildRespondOrderRows,
  respondCustomerNote,
  skusForRespond,
  type RespondFinalPdf,
} from "@/lib/respond-order";
import { orderMetaChips } from "@/lib/respond-page";
import { approvalPdfPageBySku as pagesFromPdfs } from "@/lib/approval-proof-source";
import type { RespondLayerPreview } from "@/lib/approval-layer-preview-paths";
import type { CustomerResponse, NotificationStatus, OrderSpecs } from "@/lib/types";
import {
  latestRowPerOrder,
  selectOrderSiblings,
  siblingApprovalState,
  titleOrderBase,
  webhookOrderKey,
  type SiblingApprovalRow,
} from "@/lib/approval-siblings";
import type {
  ApprovalGroupItemPayload,
  ApprovalGroupProof,
} from "@/app/respond/g/[token]/approval-group-view";

type Client = SupabaseClient;

const MEMBER_COLUMNS =
  "id, title, tenant_id, column_id, description, specs, removed_at";

/** Custom field values for one order, keyed by field name. */
export async function loadOrderFields(
  admin: Client,
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

/** Sub-item payload (summary + proof) for the group approval layout. */
export async function buildApprovalGroupItem(
  summary: ApprovalGroupItemSummary,
  member: {
    id: string;
    title: string;
    tenant_id: string;
    description: string | null;
    specs: Record<string, unknown>;
  },
  fields: Record<string, unknown>
): Promise<ApprovalGroupItemPayload> {
  const specs = (member.specs ?? {}) as OrderSpecs;
  const rawProduct = fields["Product"] ?? fields["product"];
  const product = rawProduct ? String(rawProduct) : "order";

  const ticketSkus = skusForRespond(specs);
  let approvalSkus = ticketSkus;
  let finalPdfs: Record<string, RespondFinalPdf> = {};
  let layerPreviews: Record<string, RespondLayerPreview> = {};
  if (summary.notificationToken) {
    try {
      const { loadRespondCustomerProof } = await import(
        "@/lib/approval-layer-previews"
      );
      const proofPack = await loadRespondCustomerProof(
        {
          id: member.id,
          title: member.title,
          tenant_id: member.tenant_id,
          specs,
        },
        ticketSkus
      );
      approvalSkus = proofPack.skus;
      finalPdfs = proofPack.finalPdfs;
      layerPreviews = proofPack.layerPreviews;
    } catch (err) {
      console.error("[approval-group] proof load failed:", err);
    }
  }
  const proof: ApprovalGroupProof | null =
    summary.notificationToken != null
      ? {
          token: summary.notificationToken,
          heading: summary.itemLabel,
          rows: buildRespondOrderRows(member.description, fields, specs),
          skus: approvalSkus,
          assets: [],
          skuImages: {},
          orderId: member.id,
          customerNote: respondCustomerNote(member.description, specs),
          finalPdfs,
          layerPreviews,
        }
      : null;
  return {
    summary,
    metaChips: orderMetaChips(fields, specs),
    productLabel: product,
    approvalSkus,
    approvalAssets: [],
    approvalSkuGallery: {},
    approvalPdfPageBySku: pagesFromPdfs(finalPdfs),
    proof,
  };
}

/**
 * Every line item of the same order as `orderId` (same tenant, not removed,
 * same webhook order number or same "NNNN-" title base). Returns just the
 * order itself for single-line orders, or [] when the order is missing.
 */
export async function listApprovalSiblingMembers(
  admin: Client,
  orderId: string
): Promise<GroupOrderMember[]> {
  const { data: seedRow } = await admin
    .from("orders")
    .select(MEMBER_COLUMNS)
    .eq("id", orderId)
    .maybeSingle();
  if (!seedRow) return [];
  type Row = GroupOrderMember & { removed_at: string | null };
  const seed = { ...(seedRow as Row), specs: (seedRow.specs ?? {}) as Record<string, unknown> };

  const webhookKey = webhookOrderKey(seed.specs);
  const base = titleOrderBase(seed.title);
  const candidates: Row[] = [];

  if (webhookKey) {
    const { data } = await admin
      .from("orders")
      .select(MEMBER_COLUMNS)
      .eq("tenant_id", seed.tenant_id)
      .is("removed_at", null)
      .eq("specs->>webhook_order_number", webhookKey);
    candidates.push(...((data ?? []) as Row[]));
  }
  if (base) {
    const { data } = await admin
      .from("orders")
      .select(MEMBER_COLUMNS)
      .eq("tenant_id", seed.tenant_id)
      .is("removed_at", null)
      .like("title", `${base.replace(/[\\%_]/g, (c) => `\\${c}`)}-%`);
    candidates.push(...((data ?? []) as Row[]));
  }

  return selectOrderSiblings(
    seed,
    candidates.map((c) => ({ ...c, specs: (c.specs ?? {}) as Record<string, unknown> }))
  ).map((m) => ({
    id: m.id,
    title: m.title,
    tenant_id: m.tenant_id,
    column_id: m.column_id,
    description: m.description,
    specs: m.specs,
  }));
}

/**
 * List summaries for the single-link page. Unlike the group portal, a sibling
 * only gets a token when its latest customer_approval round is live (open and
 * not expired) or already decided; anything else is "Not ready yet".
 */
export async function loadSiblingApprovalSummaries(
  admin: Client,
  members: GroupOrderMember[],
  fieldByOrderId: Map<string, Record<string, unknown>>,
  nowMs: number = Date.now()
): Promise<ApprovalGroupItemSummary[]> {
  type Row = SiblingApprovalRow & {
    order_id: string;
    customer_note: string | null;
    staff_note: string | null;
  };
  const { data } = await admin
    .from("job_notifications")
    .select(
      "id, order_id, token, status, customer_response, customer_note, staff_note, token_expires_at, created_at"
    )
    .in(
      "order_id",
      members.map((m) => m.id)
    )
    .eq("type", "customer_approval")
    .order("created_at", { ascending: false });
  const latest = latestRowPerOrder((data ?? []) as Row[]);

  return members.map((m) => {
    const row = latest.get(m.id) ?? null;
    const state = siblingApprovalState(row, nowMs);
    const fields = fieldByOrderId.get(m.id) ?? {};
    const rawProduct = fields["Product"] ?? fields["product"];
    const exposed = state.token != null && row != null;
    return {
      orderId: m.id,
      title: m.title,
      itemLabel: itemTitleFromSpecs(
        m.specs,
        rawProduct ? String(rawProduct) : "order",
        m.title
      ),
      status: state.status,
      notificationToken: state.token,
      staffNote: exposed ? row.staff_note : null,
      customerNote: exposed ? row.customer_note : null,
      customerResponse: exposed
        ? (row.customer_response as CustomerResponse | null)
        : null,
      notificationStatus: exposed ? (row.status as NotificationStatus) : null,
      notificationId: exposed ? row.id : null,
    };
  });
}
