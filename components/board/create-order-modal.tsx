"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { OrderFormBody, type OrderOwner } from "./order-form-body";
import { ConnectedCreateSpecs } from "./connected-create-specs";
import {
  prepareSkusForSave,
  validateSkus,
  type PendingSkuImage,
  type SkuItem,
} from "./sku-editor";
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
import { buildCrmSnapshot, findCatalogProduct } from "@/lib/crm-catalog-v2";
import { useCatalogCache } from "@/lib/use-catalog-cache";
import type { SpecEditValue } from "./connected-spec-inputs";
import type { BoardColumn, CustomField, Designer, IntegrationMode } from "@/lib/types";

interface CreateOrderModalProps {
  open: boolean;
  onClose: () => void;
  columnId: string | null;
  columns: BoardColumn[];
  owners: OrderOwner[];
  customFields: CustomField[];
  tenantIntegrationMode?: IntegrationMode;
  designers: Designer[];
  currentUserId: string;
  onCreated: (order?: { id?: string; column_id?: string }) => void;
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
  tenantIntegrationMode = "local",
  designers,
  currentUserId,
  onCreated,
}: CreateOrderModalProps) {
  const connected = tenantIntegrationMode === "connected";
  const catalog = useCatalogCache();
  const [title, setTitle] = useState("");
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
  const [connectedProductId, setConnectedProductId] = useState("");
  const [connectedSpecValues, setConnectedSpecValues] = useState<
    Record<string, SpecEditValue>
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
    setConnectedProductId("");
    setConnectedSpecValues({});
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

    const validationFields = connected
      ? { ...resolved, printFields: [] }
      : resolved;
    const validationError = validateOrderFormFields(
      validationFields,
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

    const product = connected
      ? findCatalogProduct(catalog, connectedProductId, null)
      : null;
    if (connected && !product) {
      setError("Select a product from the CRM catalog.");
      return;
    }

    const productField = resolved.printFields.find(
      (f) => f.name.trim().toLowerCase() === "product"
    );
    const connectedResolved = connected
      ? {
          ...resolved,
          printFields: productField ? [productField] : [],
        }
      : resolved;
    const connectedFieldValues = { ...fieldValues };
    if (connected && product && productField) {
      connectedFieldValues[productField.id] = product.name;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
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
            connectedResolved,
            connectedFieldValues,
            skus,
            customerName,
            customerContact
          ),
          ...(connected && product
            ? {
                integrationMode: "connected" as const,
                crmSnapshot: buildCrmSnapshot(product, connectedSpecValues),
              }
            : {}),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        order?: { id?: string; column_id?: string };
        gdriveFolderUrl?: string;
        gdriveOpenOnCreate?: boolean;
      };
      if (!res.ok || json.error) {
        setError(json.error ?? "Failed to create order");
        return;
      }

      const orderId = json.order?.id;
      if (orderId && Object.keys(pendingImagesBySkuId).length > 0) {
        const uploadError = await uploadPendingSkuImages(
          orderId,
          pendingImagesBySkuId
        );
        if (uploadError) {
          setError(
            `Order created, but some SKU images failed: ${uploadError}. Open the card to retry uploads.`
          );
          revokeAllPending(pendingImagesBySkuId);
          setPendingImagesBySkuId({});
          onCreated(json.order);
          return;
        }
      }

      if (json.gdriveFolderUrl && json.gdriveOpenOnCreate) {
        window.open(json.gdriveFolderUrl, "_blank", "noopener,noreferrer");
      }
      reset();
      onCreated(json.order);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create order");
    } finally {
      setLoading(false);
    }
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
          hidePrintCustomFields={connected}
          printFieldsSlot={
            connected ? (
              <ConnectedCreateSpecs
                catalog={catalog}
                productId={connectedProductId}
                onProductIdChange={(id) => {
                  setConnectedProductId(id);
                  setConnectedSpecValues({});
                }}
                values={connectedSpecValues}
                onValuesChange={setConnectedSpecValues}
              />
            ) : null
          }
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
