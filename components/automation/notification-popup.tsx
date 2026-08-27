"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
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
  groupOrderIds?: string[];
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
  groupOrderIds,
  onClose,
  onSaved,
}: Props) {
  const [dismissing, setDismissing] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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

  // Portal to body above CardDetailModal (z-[100]) — same pattern as shipping modal.
  if (!mounted) return null;

  const popup =
    type === "missing_info" ? (
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
    ) : type === "ready_to_ship" ? (
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
    ) : (
      <ApprovalPopup
        order={order}
        tenantName={tenantName}
        customFields={customFields}
        fieldValues={fieldValues}
        smsConfigured={smsConfigured}
        publicAppUrl={publicAppUrl}
        groupOrderIds={groupOrderIds}
        onClose={dismissAsManual}
        dismissing={dismissing}
        onSent={(toastMessage) => onSaved(toastMessage)}
      />
    );

  return createPortal(popup, document.body);
}
