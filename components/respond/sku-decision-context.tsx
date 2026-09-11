"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { SkuApprovalDecision } from "@/lib/sku-approval";

export const RESPOND_SKU_ANCHOR_PREFIX = "respond-sku-";
export const RESPOND_REVIEW_FOOTER_ID = "respond-review-footer";
export const RESPOND_REVIEW_SUBMIT_ID = "respond-review-submit";

export function scrollAfterSkuChoice(skuId: string, skuIds: string[]) {
  const index = skuIds.indexOf(skuId);
  const nextId = index >= 0 ? skuIds[index + 1] : undefined;
  const targetId = nextId
    ? `${RESPOND_SKU_ANCHOR_PREFIX}${nextId}`
    : RESPOND_REVIEW_SUBMIT_ID;
  window.setTimeout(() => {
    const el =
      document.getElementById(targetId) ??
      document.getElementById(RESPOND_REVIEW_FOOTER_ID);
    if (!el) return;
    el.scrollIntoView({
      behavior: "smooth",
      block: nextId ? "start" : "center",
    });
  }, 80);
}

type SkuDecisionContextValue = {
  mode: "off" | "choose" | "result";
  /** Ordered SKU ids on this proof (for scrolling after a choice). */
  skuIds?: string[];
  /** Per-SKU decision (≤1 image, or derived roll-up for 2+ images). */
  byId: Record<string, SkuApprovalDecision | undefined>;
  onChange?: (skuId: string, decision: SkuApprovalDecision) => void;
  /** Per-image decision — key is `${skuId}::${assetId}`. */
  byImageKey?: Record<string, SkuApprovalDecision | undefined>;
  onImageChange?: (
    skuId: string,
    assetId: string,
    decision: SkuApprovalDecision
  ) => void;
  pdfPageCountBySku?: Record<string, number>;
  setPdfPageCount?: (skuId: string, count: number) => void;
};

const SkuDecisionContext = createContext<SkuDecisionContextValue>({
  mode: "off",
  byId: {},
  byImageKey: {},
  pdfPageCountBySku: {},
});

export function SkuDecisionProvider({
  mode,
  skuIds = [],
  byId,
  onChange,
  byImageKey = {},
  onImageChange,
  pdfPageCountBySku = {},
  setPdfPageCount,
  children,
}: SkuDecisionContextValue & { children: ReactNode }) {
  return (
    <SkuDecisionContext.Provider
      value={{
        mode,
        skuIds,
        byId,
        onChange,
        byImageKey: byImageKey ?? {},
        onImageChange,
        pdfPageCountBySku,
        setPdfPageCount,
      }}
    >
      {children}
    </SkuDecisionContext.Provider>
  );
}

export function useSkuDecision() {
  return useContext(SkuDecisionContext);
}
