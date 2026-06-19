"use client";

import { filterButtonsForColumn } from "@/lib/button-automations";
import { ActionButton } from "./action-button";
import type { ButtonAutomation } from "@/lib/types";

interface ButtonAutomationBarProps {
  buttons: ButtonAutomation[];
  columnId: string;
  orderId: string;
  orderNumber: string;
  appUrl: string;
  onComplete: (message: string) => void;
  onError: (message: string) => void;
}

export function ButtonAutomationBar({
  buttons,
  columnId,
  orderId,
  orderNumber,
  appUrl,
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
          onComplete={onComplete}
          onError={onError}
        />
      ))}
    </div>
  );
}
