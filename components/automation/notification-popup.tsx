"use client";

import { useState } from "react";
import { MissingInfoPopup } from "@/components/notify/MissingInfoPopup";
import { ApprovalPopup } from "@/components/notify/ApprovalPopup";
import { ReadyToShipPopup } from "@/components/notify/ReadyToShipPopup";
import { postJsonWithTimeout } from "@/lib/fetch-with-timeout";
import type { CustomField, NotificationType, OrderWithRelations } from "@/lib/types";

interface Props {
  order: OrderWithRelations;
  columnId: string;
  columnName: string;
  type: NotificationType;
  tenantName: string;
  customFields: CustomField[];
  fieldValues: Record<string, unknown>;
  smsConfigured: boolean;
  publicAppUrl: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function NotificationPopup({
  order,
  columnId,
  type,
  tenantName,
  customFields,
  fieldValues,
  smsConfigured,
  publicAppUrl,
  onClose,
  onSaved,
}: Props) {
  const [dismissing, setDismissing] = useState(false);

  async function dismissAsManual() {
    if (dismissing) return;
    setDismissing(true);
    try {
      const { ok } = await postJsonWithTimeout<{ error?: string }>(
        "/api/notifications/send",
        {
          orderId: order.id,
          type,
          channel: "manual",
        }
      );
      if (ok) {
        onSaved("Saved — manual follow-up");
        return;
      }
    } catch {
      // Fall through and close without persisting manual mode.
    }
    setDismissing(false);
    onClose();
  }

  if (type === "missing_info") {
    return (
      <MissingInfoPopup
        order={order}
        tenantName={tenantName}
        customFields={customFields}
        fieldValues={fieldValues}
        smsConfigured={smsConfigured}
        publicAppUrl={publicAppUrl}
        onClose={dismissAsManual}
        dismissing={dismissing}
        onSent={(toastMessage) => onSaved(toastMessage)}
      />
    );
  }

  if (type === "ready_to_ship") {
    return (
      <ReadyToShipPopup
        order={order}
        columnId={columnId}
        tenantName={tenantName}
        customFields={customFields}
        fieldValues={fieldValues}
        smsConfigured={smsConfigured}
        onClose={onClose}
        dismissing={dismissing}
        onSent={(toastMessage) => onSaved(toastMessage)}
      />
    );
  }

  return (
    <ApprovalPopup
      order={order}
      tenantName={tenantName}
      customFields={customFields}
      fieldValues={fieldValues}
      smsConfigured={smsConfigured}
      publicAppUrl={publicAppUrl}
      onClose={dismissAsManual}
      dismissing={dismissing}
      onSent={(toastMessage) => onSaved(toastMessage)}
    />
  );
}
