"use client";

import { filterButtonsForColumn } from "@/lib/button-automations";
import type { ActionButtonResult } from "./action-button";
import { ActionButton } from "./action-button";
import type { ButtonAutomation } from "@/lib/types";

interface ButtonAutomationBarProps {
  buttons: ButtonAutomation[];
  columnId: string;
  orderId: string;
  orderNumber: string;
  appUrl: string;
  /** When >= 2, SMS buttons show a group confirmation dialog before sending. */
  groupSize?: number;
  /** How many of the group are in the same column as this order. */
  groupSameColumnCount?: number;
  /** Name of the current column (shown in the SMS confirmation dialog). */
  groupColumnName?: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  productLabel?: string | null;
  onComplete: (result: ActionButtonResult) => void;
  onError: (message: string) => void;
}

export function ButtonAutomationBar({
  buttons,
  columnId,
  orderId,
  orderNumber,
  appUrl,
  groupSize,
  groupSameColumnCount,
  groupColumnName,
  customerEmail,
  customerPhone,
  productLabel,
  onComplete,
  onError,
}: ButtonAutomationBarProps) {
  const activeButtons = filterButtonsForColumn(buttons, columnId);
  if (activeButtons.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/80 px-1 py-2">
      {activeButtons.map((button) => (
        <ActionButton
          key={button.id}
          button={button}
          orderId={orderId}
          orderNumber={orderNumber}
          appUrl={appUrl}
          groupSize={groupSize}
          groupSameColumnCount={groupSameColumnCount}
          groupColumnName={groupColumnName}
          customerEmail={customerEmail}
          customerPhone={customerPhone}
          productLabel={productLabel}
          onComplete={onComplete}
          onError={onError}
        />
      ))}
    </div>
  );
}
