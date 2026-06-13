"use client";

import { AlertTriangle } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import type { MissingField } from "@/lib/orders/validate-ready-to-move";

interface MoveBlockedModalProps {
  missingFields: MissingField[];
  onOpenCard: () => void;
  onClose: () => void;
}

export function MoveBlockedModal({
  missingFields,
  onOpenCard,
  onClose,
}: MoveBlockedModalProps) {
  return (
    <Modal
      open
      onClose={onClose}
      className="max-w-md"
      title={
        <span className="flex items-center gap-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-50">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
          </span>
          <span>Complete required fields before moving</span>
        </span>
      }
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={onOpenCard}>
            Open card
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-slate-500">
        This card has missing information. Please open the card and fill in all
        required fields before moving it to the next stage.
      </p>
      <ul className="space-y-2">
        {missingFields.map((f) => (
          <li
            key={f.field}
            className="flex items-center gap-2 text-sm text-slate-700"
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
            {f.label}
          </li>
        ))}
      </ul>
    </Modal>
  );
}
