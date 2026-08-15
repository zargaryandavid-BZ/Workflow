"use client";

import { useMemo, useState, type ReactNode } from "react";
import { RespondForm } from "@/app/respond/[token]/respond-form";
import {
  PORTAL_FOOTER,
  PORTAL_PRODUCT_NAME,
} from "@/lib/portal-branding";
import type {
  ApprovalGroupItemSummary,
  ApprovalItemStatus,
} from "@/lib/approval-group";
import type { OrderMetaChip } from "@/lib/respond-page";
import { cn } from "@/lib/utils";
import { Printer } from "lucide-react";

export type ApprovalGroupItemPayload = {
  summary: ApprovalGroupItemSummary;
  metaChips: OrderMetaChip[];
  productLabel: string;
};

function statusLabel(status: ApprovalItemStatus): string {
  switch (status) {
    case "waiting":
      return "Waiting for your approval";
    case "pending":
      return "Pending";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
  }
}

function statusClass(status: ApprovalItemStatus, selected: boolean): string {
  if (selected) {
    return "border-[#1d4ed8] bg-[#eff6ff] text-slate-900";
  }
  switch (status) {
    case "waiting":
      return "border-amber-300 bg-amber-50 text-amber-950 hover:border-amber-400";
    case "approved":
      return "border-emerald-200 bg-emerald-50/60 text-emerald-900 hover:border-emerald-300";
    case "rejected":
      return "border-red-200 bg-red-50/60 text-red-900 hover:border-red-300";
    case "pending":
      return "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed";
  }
}

function statusDot(status: ApprovalItemStatus): string {
  switch (status) {
    case "waiting":
      return "bg-amber-500";
    case "approved":
      return "bg-emerald-500";
    case "rejected":
      return "bg-red-500";
    case "pending":
      return "bg-slate-300";
  }
}

export function ApprovalGroupView({
  groupLabel,
  tenantName,
  items: initialItems,
  reviews,
}: {
  groupLabel: string;
  tenantName: string;
  items: ApprovalGroupItemPayload[];
  /** Server-rendered OrderReview nodes keyed by order id. */
  reviews: Record<string, ReactNode>;
}) {
  const [items, setItems] = useState(initialItems);

  const waiting = useMemo(
    () => items.filter((i) => i.summary.status === "waiting").length,
    [items]
  );

  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const firstWaiting = initialItems.find((i) => i.summary.status === "waiting");
    if (firstWaiting) return firstWaiting.summary.orderId;
    const clickable = initialItems.find((i) => i.summary.status !== "pending");
    return clickable?.summary.orderId ?? null;
  });

  const selected = items.find((i) => i.summary.orderId === selectedId) ?? null;
  const selectedReview = selectedId ? reviews[selectedId] ?? null : null;

  function selectItem(orderId: string, status: ApprovalItemStatus) {
    if (status === "pending") return;
    setSelectedId(orderId);
  }

  function onDecided(orderId: string, decision: "approved" | "rejected") {
    setItems((prev) =>
      prev.map((item) =>
        item.summary.orderId === orderId
          ? {
              ...item,
              summary: {
                ...item.summary,
                status: decision === "approved" ? "approved" : "rejected",
                customerResponse:
                  decision === "approved" ? "approved" : "changes_requested",
                notificationStatus: "responded",
              },
            }
          : item
      )
    );
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] px-3 py-6 sm:px-4 sm:py-8">
      <div className="mx-auto w-full max-w-5xl overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-sm">
        <div className="flex items-center justify-between bg-[#1d4ed8] px-4 py-3 text-white">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20">
              <Printer className="h-4 w-4" />
            </span>
            <span className="text-sm font-semibold">{PORTAL_PRODUCT_NAME}</span>
          </div>
          <span className="text-sm text-white/90">Order {groupLabel}</span>
        </div>

        <div className="border-b border-slate-100 px-4 py-3 sm:px-6">
          <h1 className="text-base font-semibold text-slate-900 sm:text-lg">
            Your order items are ready for review
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {waiting} of {items.length}{" "}
            {waiting === 1 ? "is" : "are"} waiting for your approval.
            Select an item on the left to approve or request changes.
          </p>
        </div>

        <div className="flex flex-col md:flex-row">
          <aside className="shrink-0 border-b border-slate-100 md:w-64 md:border-b-0 md:border-r md:border-slate-100">
            <div className="max-h-56 space-y-1.5 overflow-y-auto p-3 md:max-h-[min(70vh,640px)] md:p-4">
              <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Sub-items
              </p>
              {items.map((item) => {
                const { summary } = item;
                const selectedRow = summary.orderId === selectedId;
                const disabled = summary.status === "pending";
                return (
                  <button
                    key={summary.orderId}
                    type="button"
                    disabled={disabled}
                    onClick={() => selectItem(summary.orderId, summary.status)}
                    className={cn(
                      "flex w-full flex-col gap-0.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
                      statusClass(summary.status, selectedRow),
                      summary.status === "waiting" && !selectedRow
                        ? "ring-1 ring-amber-200"
                        : null
                    )}
                  >
                    <span className="flex items-start gap-2">
                      <span
                        className={cn(
                          "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                          statusDot(summary.status)
                        )}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {summary.itemLabel}
                        </span>
                        <span className="block truncate text-[11px] opacity-70">
                          {summary.title}
                        </span>
                        <span className="mt-0.5 block text-[11px] font-medium">
                          {statusLabel(summary.status)}
                        </span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          <main className="min-w-0 flex-1 p-4 sm:p-6">
            {!selected ? (
              <p className="text-sm text-slate-500">
                No items are ready for approval yet. You will get another message
                when the next item is ready.
              </p>
            ) : selected.summary.status === "pending" ? (
              <p className="text-sm text-slate-500">
                This item is not ready for approval yet.
              </p>
            ) : selected.summary.status === "waiting" &&
              selected.summary.notificationToken ? (
              <RespondForm
                key={selected.summary.notificationToken}
                token={selected.summary.notificationToken}
                type="customer_approval"
                productLabel={selected.productLabel}
                orderNumber={selected.summary.title}
                itemTitle={selected.summary.itemLabel}
                staffNote={selected.summary.staffNote}
                metaChips={selected.metaChips}
                tenantName={tenantName}
                onDecided={(decision) =>
                  onDecided(selected.summary.orderId, decision)
                }
                orderReview={selectedReview}
              />
            ) : (
              <div className="space-y-5">
                <div
                  className={
                    selected.summary.status === "approved"
                      ? "rounded-lg bg-emerald-50 p-4 text-center text-emerald-800"
                      : "rounded-lg bg-red-50 p-4 text-center text-red-800"
                  }
                >
                  <h2 className="text-lg font-semibold">
                    {selected.summary.status === "approved"
                      ? "Approved"
                      : "Not approved"}
                  </h2>
                  <p className="mt-1 text-sm opacity-90">
                    {selected.summary.status === "approved"
                      ? "Your approval has been recorded. Thank you!"
                      : "Your feedback was received. Our team will be in touch shortly."}
                  </p>
                  {selected.summary.customerNote ? (
                    <div className="mt-3 rounded-md bg-white/70 px-3 py-2 text-left">
                      <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
                        Your note
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm">
                        &ldquo;{selected.summary.customerNote}&rdquo;
                      </p>
                    </div>
                  ) : null}
                </div>
                {selectedReview}
              </div>
            )}
          </main>
        </div>

        <div className="border-t border-slate-100 px-6 py-4 text-center text-xs text-slate-400">
          {PORTAL_FOOTER}
        </div>
      </div>
    </div>
  );
}
