"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { OrderFormBody, type OrderOwner } from "./order-form-body";
import {
  prepareSkusForSave,
  validateSkus,
  type PendingSkuImage,
  type SkuItem,
} from "./sku-editor";
import { createOrderAction } from "@/lib/actions/create-order";
import {
  DEFAULT_PROCESSING_DAYS,
  type DueDateMode,
} from "@/lib/due-date";
import {
  buildCustomFieldPayload,
  resolveOrderFormFields,
  validateDueDate,
  validateOrderFormFields,
} from "@/lib/order-form";
import {
  DEFAULT_APPLICATION_DAYS,
  isApplicationCustomFieldOn,
} from "@/lib/order-application";
import type { BoardColumn, CustomField, Designer } from "@/lib/types";

interface CreateOrderModalProps {
  open: boolean;
  onClose: () => void;
  columnId: string | null;
  columns: BoardColumn[];
  owners: OrderOwner[];
  customFields: CustomField[];
  designers: Designer[];
  currentUserId: string;
  onCreated: () => void;
}

function revokeAllPending(
  pending: Record<string, PendingSkuImage[]>
) {
  for (const list of Object.values(pending)) {
    for (const img of list) URL.revokeObjectURL(img.previewUrl);
  }
}

async function uploadPendingSkuImages(
  orderId: string,
  pending: Record<string, PendingSkuImage[]>
): Promise<string | null> {
  for (const [skuId, images] of Object.entries(pending)) {
    for (const img of images) {
      const fd = new FormData();
      fd.append("file", img.file);
      const res = await fetch(`/api/orders/${orderId}/skus/${skuId}/images`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        return json.error ?? `Failed to upload image for SKU ${skuId}`;
      }
    }
  }
  return null;
}

export function CreateOrderModal({
  open,
  onClose,
  columnId,
  columns,
  owners,
  customFields,
  designers,
  currentUserId,
  onCreated,
}: CreateOrderModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [productionNotes, setProductionNotes] = useState("");
  const [applicationDays, setApplicationDays] = useState(DEFAULT_APPLICATION_DAYS);
  const [priority, setPriority] = useState("normal");
  const defaultOwnerId = useMemo(
    () => (owners.some((o) => o.id === currentUserId) ? currentUserId : ""),
    [owners, currentUserId]
  );
  const [ownerId, setOwnerId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueDateMode, setDueDateMode] = useState<DueDateMode>("fixed");
  const [dueProcessingDays, setDueProcessingDays] = useState(
    DEFAULT_PROCESSING_DAYS
  );
  const [customerName, setCustomerName] = useState("");
  const [customerContact, setCustomerContact] = useState("");
  const [designerId, setDesignerId] = useState("");
  const [designTask, setDesignTask] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({});
  const [skus, setSkus] = useState<SkuItem[]>([]);
  const [pendingImagesBySkuId, setPendingImagesBySkuId] = useState<
    Record<string, PendingSkuImage[]>
  >({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolved = useMemo(
    () => resolveOrderFormFields(customFields),
    [customFields]
  );

  useEffect(() => {
    if (open) setOwnerId(defaultOwnerId);
  }, [open, defaultOwnerId]);

  function reset() {
    revokeAllPending(pendingImagesBySkuId);
    setTitle("");
    setDescription("");
    setInternalNote("");
    setProductionNotes("");
    setApplicationDays(DEFAULT_APPLICATION_DAYS);
    setPriority("normal");
    setOwnerId(defaultOwnerId);
    setDueDate("");
    setDueDateMode("fixed");
    setDueProcessingDays(DEFAULT_PROCESSING_DAYS);
    setCustomerName("");
    setCustomerContact("");
    setDesignerId("");
    setDesignTask("");
    setFieldValues({});
    setSkus([]);
    setPendingImagesBySkuId({});
    setError(null);
  }

  function setFieldValue(fieldId: string, value: unknown) {
    setFieldValues((prev) => ({ ...prev, [fieldId]: value }));
  }

  function handlePendingImagesChange(skuId: string, next: PendingSkuImage[]) {
    setPendingImagesBySkuId((prev) => {
      const copy = { ...prev };
      if (next.length === 0) delete copy[skuId];
      else copy[skuId] = next;
      return copy;
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("Order Title is required");
      return;
    }

    const validationError = validateOrderFormFields(
      resolved,
      fieldValues,
      customerName,
      customerContact,
      skus,
      designerId
    );
    if (validationError) {
      setError(validationError);
      return;
    }

    if (dueDateMode === "fixed") {
      const dueDateError = validateDueDate(dueDate, null, { required: true });
      if (dueDateError) {
        setError(dueDateError);
        return;
      }
    } else if (!Number.isFinite(dueProcessingDays) || dueProcessingDays < 1) {
      setError("Working days after approval must be at least 1.");
      return;
    }

    const skuError = validateSkus(skus, []);
    if (skuError) {
      setError(skuError);
      return;
    }

    setLoading(true);
    const json = await createOrderAction({
      title,
      description,
      internalNote: internalNote || null,
      columnId,
      ownerId: ownerId || null,
      priority,
      dueDate:
        dueDateMode === "fixed" && dueDate ? dueDate.slice(0, 10) : null,
      dueDateMode,
      dueProcessingDays:
        dueDateMode === "after_approval" ? dueProcessingDays : null,
      specs: {
        skus: prepareSkusForSave(skus, { pendingArtworkIds: [] }),
        designer_id: designerId || null,
        designer_name:
          designers.find((d) => d.id === designerId)?.name ?? null,
        design_task: designTask || null,
        production_notes: productionNotes.trim() || null,
        ...(isApplicationCustomFieldOn(customFields, fieldValues)
          ? {
              application: true,
              application_days: Math.max(
                1,
                Math.floor(applicationDays) || DEFAULT_APPLICATION_DAYS
              ),
            }
          : {}),
      },
      customFieldValues: buildCustomFieldPayload(
        resolved,
        fieldValues,
        skus,
        customerName,
        customerContact
      ),
    });

    if (json.error) {
      setLoading(false);
      setError(json.error);
      return;
    }

    const orderId = json.order?.id as string | undefined;
    if (orderId && Object.keys(pendingImagesBySkuId).length > 0) {
      const uploadError = await uploadPendingSkuImages(
        orderId,
        pendingImagesBySkuId
      );
      if (uploadError) {
        setLoading(false);
        setError(
          `Order created, but some SKU images failed: ${uploadError}. Open the card to retry uploads.`
        );
        // Still close after a successful create — images can be re-added on the card.
        revokeAllPending(pendingImagesBySkuId);
        setPendingImagesBySkuId({});
        onCreated();
        return;
      }
    }

    setLoading(false);
    if (json.gdriveFolderUrl && json.gdriveOpenOnCreate) {
      window.open(json.gdriveFolderUrl, "_blank", "noopener,noreferrer");
    }
    reset();
    onCreated();
  }

  const columnName = columns.find((c) => c.id === columnId)?.name;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`New print job${columnName ? ` · ${columnName}` : ""}`}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" form="create-order-form" disabled={loading}>
            {loading ? "Creating…" : "Create Order"}
          </Button>
        </>
      }
    >
      <form id="create-order-form" onSubmit={onSubmit} className="space-y-4">
        <OrderFormBody
          idPrefix="create"
          customFields={customFields}
          owners={owners}
          designers={designers}
          title={title}
          onTitleChange={setTitle}
          priority={priority}
          onPriorityChange={setPriority}
          ownerId={ownerId}
          onOwnerIdChange={setOwnerId}
          description={description}
          onDescriptionChange={setDescription}
          internalNote={internalNote}
          onInternalNoteChange={setInternalNote}
          productionNotes={productionNotes}
          onProductionNotesChange={setProductionNotes}
          applicationEnabled={isApplicationCustomFieldOn(
            customFields,
            fieldValues
          )}
          applicationDays={applicationDays}
          onApplicationDaysChange={setApplicationDays}
          customerName={customerName}
          onCustomerNameChange={setCustomerName}
          customerContact={customerContact}
          onCustomerContactChange={setCustomerContact}
          designerId={designerId}
          onDesignerIdChange={setDesignerId}
          designTask={designTask}
          onDesignTaskChange={setDesignTask}
          fieldValues={fieldValues}
          onFieldValueChange={setFieldValue}
          skus={skus}
          onSkusChange={setSkus}
          pendingImagesBySkuId={pendingImagesBySkuId}
          onPendingImagesChange={handlePendingImagesChange}
          dueDate={dueDate}
          onDueDateChange={setDueDate}
          dueDateMode={dueDateMode}
          onDueDateModeChange={setDueDateMode}
          dueProcessingDays={dueProcessingDays}
          onDueProcessingDaysChange={setDueProcessingDays}
          dueDateRequired
          hideEmpty={false}
        />

        {error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
