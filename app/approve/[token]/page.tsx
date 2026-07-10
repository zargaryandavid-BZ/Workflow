import { Printer } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { OrderReview } from "@/components/respond/order-review";
import {
  buildRespondOrderRows,
  fetchRespondOrderAssets,
  fetchRespondSkuImages,
  skusForRespond,
} from "@/lib/respond-order";
import { ApprovalForm } from "./approval-form";
import type { ApprovalStatus, OrderSpecs } from "@/lib/types";

interface ApprovalRow {
  approval_id: string;
  order_id: string;
  status: ApprovalStatus;
  order_title: string;
  order_description: string | null;
  order_specs: OrderSpecs;
  order_fields: Record<string, unknown>;
  tenant_name: string;
  comment: string | null;
  decided_at: string | null;
}

export default async function ApprovalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_approval_by_token", {
    p_token: token,
  });

  const approval = (data as ApprovalRow[] | null)?.[0] ?? null;
  const orderFields = approval?.order_fields ?? {};
  const orderRows = approval
    ? buildRespondOrderRows(
        approval.order_description,
        orderFields,
        approval.order_specs ?? {}
      )
    : [];
  const skus = approval ? skusForRespond(approval.order_specs ?? {}) : [];
  const [assets, skuImages] = approval
    ? await Promise.all([
        fetchRespondOrderAssets(approval.order_id),
        fetchRespondSkuImages(approval.order_id),
      ])
    : [[], {}];

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 to-blue-50 p-4">
      <div className="w-full max-w-2xl">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--primary)] text-white">
            <Printer className="h-5 w-5" />
          </span>
          <span className="text-lg font-semibold text-slate-800">
            {approval?.tenant_name ?? "Print Production"}
          </span>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {!approval ? (
            <div className="text-center">
              <h1 className="text-lg font-semibold text-slate-800">
                Link not found
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                This approval link is invalid or has expired.
              </p>
            </div>
          ) : (
            <>
              <h1 className="text-lg font-semibold text-slate-800">
                {approval.order_title}
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Please review your order details and artwork below.
              </p>

              <div className="mt-4">
                <OrderReview
                  token={token}
                  rows={orderRows}
                  skus={skus}
                  assets={assets}
                  skuImages={skuImages}
                />
              </div>

              <div className="mt-6">
                {approval.status === "pending" ? (
                  <ApprovalForm token={token} />
                ) : (
                  <div
                    className={
                      approval.status === "approved"
                        ? "rounded-lg bg-emerald-50 p-4 text-center text-emerald-700"
                        : "rounded-lg bg-red-50 p-4 text-center text-red-700"
                    }
                  >
                    <p className="font-semibold capitalize">
                      {approval.status}
                    </p>
                    {approval.comment ? (
                      <p className="mt-1 text-sm">“{approval.comment}”</p>
                    ) : null}
                    <p className="mt-1 text-xs opacity-70">
                      Thank you for your response.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
