"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { SkuApprovalDecision } from "@/lib/sku-approval";

type SkuDecisionContextValue = {
  mode: "off" | "choose" | "result";
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
