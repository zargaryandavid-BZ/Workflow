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
import type { SkuItem } from "@/lib/skus";
import {
  imagesBySkuId,
  type RespondOrderAsset,
  type RespondSkuImage,
} from "@/lib/respond-order";
import { cn } from "@/lib/utils";
import { Printer } from "lucide-react";
import {
  decisionsBySkuId,
  imageDecisionsByKey,
  parseSkuApprovalNote,
  skuApprovalDisplayLines,
} from "@/lib/sku-approval";
import { SkuDecisionProvider } from "@/components/respond/sku-decision-context";

export type ApprovalGroupItemPayload = {
  summary: ApprovalGroupItemSummary;
  metaChips: OrderMetaChip[];
  productLabel: string;
  approvalSkus: SkuItem[];
  approvalAssets?: RespondOrderAsset[];
  approvalSkuGallery?: Record<string, RespondSkuImage[]>;
};

function shortStatusLabel(status: ApprovalItemStatus): string {
  switch (status) {
    case "waiting":
      return "Waiting";
    case "pending":
      return "Pending";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
  }
}

const STATUS_SORT_ORDER: Record<ApprovalItemStatus, number> = {
  waiting: 0,
  rejected: 1,
  pending: 2,
  approved: 3,
};

function sortApprovalItems(
  list: ApprovalGroupItemPayload[]
): ApprovalGroupItemPayload[] {
  return [...list].sort((a, b) => {
    const byStatus =
      STATUS_SORT_ORDER[a.summary.status] - STATUS_SORT_ORDER[b.summary.status];
    if (byStatus !== 0) return byStatus;
    return a.summary.title.localeCompare(b.summary.title, undefined, {
      numeric: true,
    });
  });
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
  initialItem = null,
}: {
  groupLabel: string;
  tenantName: string;
  items: ApprovalGroupItemPayload[];
  /** Server-rendered OrderReview nodes keyed by order id. */
  reviews: Record<string, ReactNode>;
  /** Prefer selecting this order id or title from ?item=. */
  initialItem?: string | null;
}) {
  const [items, setItems] = useState(initialItems);

  const sortedItems = useMemo(() => sortApprovalItems(items), [items]);

  const waiting = useMemo(
    () => items.filter((i) => i.summary.status === "waiting").length,
    [items]
  );

  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const sorted = sortApprovalItems(initialItems);
    if (initialItem?.trim()) {
      const needle = initialItem.trim();
      const match = sorted.find(
        (i) =>
          i.summary.orderId === needle || i.summary.title === needle
      );
      if (match && match.summary.status !== "pending") {
        return match.summary.orderId;
      }
    }
    const firstWaiting = sorted.find((i) => i.summary.status === "waiting");
    if (firstWaiting) return firstWaiting.summary.orderId;
    const clickable = sorted.find((i) => i.summary.status !== "pending");
    return clickable?.summary.orderId ?? null;
  });

  const selected = items.find((i) => i.summary.orderId === selectedId) ?? null;
  const selectedReview = selectedId ? reviews[selectedId] ?? null : null;

  function syncItemQuery(orderId: string) {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("item", orderId);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  function selectItem(orderId: string, status: ApprovalItemStatus) {
    if (status === "pending") return;
    setSelectedId(orderId);
    syncItemQuery(orderId);
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
    syncItemQuery(orderId);
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] px-3 py-6 sm:px-4 sm:py-8">
      <div className="mx-auto w-full max-w-5xl rounded-xl border border-[#e2e8f0] bg-white shadow-sm">
        <div className="flex items-center justify-between rounded-t-xl bg-[#1d4ed8] px-4 py-3 text-white">
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

        <div className="flex flex-col md:flex-row md:items-stretch">
          <aside className="flex shrink-0 flex-col border-b border-slate-100 md:w-72 md:border-b-0 md:border-r md:border-slate-100 md:max-h-[min(70vh,640px)]">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 md:px-4 md:py-4 [scrollbar-gutter:stable]">
              <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Sub-items
              </p>
              <ul className="space-y-1.5 pb-1">
                {sortedItems.map((item) => {
                  const { summary } = item;
                  const selectedRow = summary.orderId === selectedId;
                  const disabled = summary.status === "pending";
                  return (
                    <li key={summary.orderId}>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() =>
                          selectItem(summary.orderId, summary.status)
                        }
                        className={cn(
                          "flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
                          statusClass(summary.status, selectedRow)
                        )}
                      >
                        <span
                          className={cn(
                            "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                            statusDot(summary.status)
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium leading-snug">
                            {summary.itemLabel}
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] font-medium leading-snug opacity-80">
                            {summary.title} ·{" "}
                            {shortStatusLabel(summary.status)}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
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
                approvalSkus={selected.approvalSkus}
                approvalAssets={selected.approvalAssets}
                approvalSkuGallery={selected.approvalSkuGallery}
                onDecided={(decision) =>
                  onDecided(selected.summary.orderId, decision)
                }
                orderReview={selectedReview}
              />
            ) : (
              <RespondedGroupItem
                status={selected.summary.status}
                customerNote={selected.summary.customerNote}
                skus={selected.approvalSkus}
                assets={selected.approvalAssets}
                skuGallery={selected.approvalSkuGallery}
                review={selectedReview}
              />
            )}
          </main>
        </div>

        <div className="rounded-b-xl border-t border-slate-100 px-6 py-4 text-center text-xs text-slate-400">
          {PORTAL_FOOTER}
        </div>
      </div>
    </div>
  );
}

function RespondedGroupItem({
  status,
  customerNote,
  skus,
  assets,
  skuGallery,
  review,
}: {
  status: ApprovalItemStatus;
  customerNote: string | null;
  skus: SkuItem[];
  assets?: RespondOrderAsset[];
  skuGallery?: Record<string, RespondSkuImage[]>;
  review: ReactNode;
}) {
  const parsed = parseSkuApprovalNote(customerNote);
  const displayLines = skuApprovalDisplayLines(parsed);
  const mixed =
    displayLines.some((e) => e.decision === "approved") &&
    displayLines.some((e) => e.decision === "rejected");
  const approved = status === "approved";
  const imageByKey = imageDecisionsByKey(
    skus,
    imagesBySkuId(skus, assets ?? [], skuGallery ?? {}),
    parsed.imageEntries
  );

  const reviewNode =
    displayLines.length > 0 ? (
      <SkuDecisionProvider
        mode="result"
        byId={decisionsBySkuId(skus, parsed.entries, parsed.imageEntries)}
        byImageKey={imageByKey}
      >
        {review}
      </SkuDecisionProvider>
    ) : (
      review
    );

  return (
    <div className="space-y-5">
      <div
        className={
          approved
            ? "rounded-lg bg-emerald-50 p-4 text-center text-emerald-800"
            : "rounded-lg bg-red-50 p-4 text-center text-red-800"
        }
      >
        <h2 className="text-lg font-semibold">
          {mixed ? "Partial approval" : approved ? "Approved" : "Not approved"}
        </h2>
        <p className="mt-1 text-sm opacity-90">
          {mixed
            ? "We recorded which SKUs were approved and which need changes. Our team will be in touch shortly."
            : approved
              ? "Your approval has been recorded. Thank you!"
              : "Your feedback was received. Our team will be in touch shortly."}
        </p>
        {displayLines.length > 0 ? (
          <ul className="mt-3 space-y-1.5 text-left">
            {displayLines.map((entry) => (
              <li
                key={entry.key}
                className="flex items-center justify-between gap-2 rounded-md bg-white/80 px-3 py-2 text-sm"
              >
                <span className="min-w-0 truncate font-medium">
                  {entry.label}
                </span>
                <span
                  className={`shrink-0 text-xs font-semibold uppercase tracking-wide ${
                    entry.decision === "approved"
                      ? "text-emerald-800"
                      : "text-red-800"
                  }`}
                >
                  {entry.decision === "approved" ? "Approved" : "Not approved"}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {parsed.comment ? (
          <div className="mt-3 rounded-md bg-white/70 px-3 py-2 text-left">
            <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
              Your note
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm">
              &ldquo;{parsed.comment}&rdquo;
            </p>
          </div>
        ) : null}
      </div>
      {reviewNode}
    </div>
  );
}
