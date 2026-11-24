import { createAdminClient } from "@/lib/supabase/admin";
import { loadApprovalGroupItemSummaries } from "@/lib/approval-group";
import {
  formatReadyToShipGroupLabel,
  listOrderGroupMembers,
} from "@/lib/ready-to-ship-group";
import {
  buildApprovalGroupItem,
  loadOrderFields,
} from "@/lib/approval-group-items";
import {
  ApprovalGroupView,
  type ApprovalGroupItemPayload,
} from "./approval-group-view";

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

  const payloads: ApprovalGroupItemPayload[] = await Promise.all(
    summaries.map((summary) => {
      const member = members.find((m) => m.id === summary.orderId)!;
      return buildApprovalGroupItem(
        summary,
        member,
        fieldByOrderId.get(member.id) ?? {}
      );
    })
  );

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
