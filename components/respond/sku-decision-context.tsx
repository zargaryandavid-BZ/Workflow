"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { SkuApprovalDecision } from "@/lib/sku-approval";

type SkuDecisionContextValue = {
  mode: "off" | "choose" | "result";
  byId: Record<string, SkuApprovalDecision | undefined>;
  onChange?: (skuId: string, decision: SkuApprovalDecision) => void;
};

const SkuDecisionContext = createContext<SkuDecisionContextValue>({
  mode: "off",
  byId: {},
});

export function SkuDecisionProvider({
  mode,
  byId,
  onChange,
  children,
}: SkuDecisionContextValue & { children: ReactNode }) {
  return (
    <SkuDecisionContext.Provider value={{ mode, byId, onChange }}>
      {children}
    </SkuDecisionContext.Provider>
  );
}

export function useSkuDecision() {
  return useContext(SkuDecisionContext);
}
