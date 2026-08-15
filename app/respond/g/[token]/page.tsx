import { createClient } from "@/lib/supabase/server";
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
  fetchRespondOrderAssets,
  fetchRespondSkuImages,
  skusForRespond,
  type RespondOrderAsset,
} from "@/lib/respond-order";
import { orderMetaChips } from "@/lib/respond-page";
import type { OrderSpecs } from "@/lib/types";
import {
  ApprovalGroupView,
  type ApprovalGroupItemPayload,
} from "./approval-group-view";

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

async function buildItemPayload(
  admin: ReturnType<typeof createAdminClient>,
  summary: ApprovalGroupItemSummary,
  member: {
    id: string;
    title: string;
    description: string | null;
    specs: Record<string, unknown>;
  },
  fields: Record<string, unknown>
): Promise<ApprovalGroupItemPayload> {
  const specs = (member.specs ?? {}) as OrderSpecs;
  const rawProduct = fields["Product"] ?? fields["product"];
  const product = rawProduct ? String(rawProduct) : "order";

  let assets: RespondOrderAsset[] = [];
  let skuImages: Record<string, Awaited<ReturnType<typeof fetchRespondSkuImages>>[string]> =
    {};

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

  return {
    summary,
    metaChips: orderMetaChips(fields, specs),
    rows: buildRespondOrderRows(member.description, fields, specs),
    skus: skusForRespond(specs),
    assets,
    skuImages,
    productLabel: product,
  };
}

export default async function ApprovalGroupPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_approval_group_portal_by_token", {
    p_token: token,
  });

  const portal = (
    data as
      | { portal_id: string; tenant_id: string; group_key: string; tenant_name: string }[]
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

  // Seed any order in this group (webhook key or title PREFIX-N).
  const { data: byWebhook } = await admin
    .from("orders")
    .select("id, title, tenant_id, column_id, description, specs")
    .eq("tenant_id", portal.tenant_id)
    .is("removed_at", null)
    .filter("specs->>'webhook_order_number'", "eq", portal.group_key)
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
  for (const summary of summaries) {
    const member = members.find((m) => m.id === summary.orderId)!;
    payloads.push(
      await buildItemPayload(
        admin,
        summary,
        member,
        fieldByOrderId.get(member.id) ?? {}
      )
    );
  }

  const groupLabel = formatReadyToShipGroupLabel(members);

  return (
    <ApprovalGroupView
      groupLabel={groupLabel}
      tenantName={portal.tenant_name}
      items={payloads}
    />
  );
}
