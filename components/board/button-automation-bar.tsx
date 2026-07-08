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
          onComplete={onComplete}
          onError={onError}
        />
      ))}
    </div>
  );
}
