"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { OrderFormBody, type OrderOwner } from "./order-form-body";
import { prepareSkusForSave, validateSkus, type SkuItem } from "./sku-editor";
import { createOrderAction } from "@/lib/actions/create-order";
import {
  buildCustomFieldPayload,
  resolveOrderFormFields,
  validateDueDate,
  validateOrderFormFields,
} from "@/lib/order-form";
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
  const [priority, setPriority] = useState("normal");
  const defaultOwnerId = useMemo(
    () => (owners.some((o) => o.id === currentUserId) ? currentUserId : ""),
    [owners, currentUserId]
  );
  const [ownerId, setOwnerId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerContact, setCustomerContact] = useState("");
  const [designerId, setDesignerId] = useState("");
  const [designTask, setDesignTask] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({});
  const [skus, setSkus] = useState<SkuItem[]>([]);
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
    setTitle("");
    setDescription("");
    setPriority("normal");
    setOwnerId(defaultOwnerId);
    setDueDate("");
    setCustomerName("");
    setCustomerContact("");
    setDesignerId("");
    setDesignTask("");
    setFieldValues({});
    setSkus([]);
    setError(null);
  }

  function setFieldValue(fieldId: string, value: unknown) {
    setFieldValues((prev) => ({ ...prev, [fieldId]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("Order Number is required");
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

    const dueDateError = validateDueDate(dueDate);
    if (dueDateError) {
      setError(dueDateError);
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
      dueDate: dueDate ? dueDate.slice(0, 10) : null,
      specs: {
        skus: prepareSkusForSave(skus, { pendingArtworkIds: [] }),
        designer_id: designerId || null,
        designer_name:
          designers.find((d) => d.id === designerId)?.name ?? null,
        design_task: designTask || null,
      },
      customFieldValues: buildCustomFieldPayload(
        resolved,
        fieldValues,
        skus,
        customerName,
        customerContact
      ),
    });
    setLoading(false);
    if (json.error) {
      setError(json.error);
      return;
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
          dueDate={dueDate}
          onDueDateChange={setDueDate}
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
