"use client";

import { useState } from "react";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { CustomFieldInput } from "./custom-field-input";
import { SkuEditor, type SkuItem } from "./sku-editor";
import { OrderQtyField } from "./order-qty-field";
import { PRIORITY_OPTIONS } from "@/lib/constants";
import {
  orderFormFieldLabel,
  resolveOrderFormFields,
  validateDueDate,
} from "@/lib/order-form";
import { dateInputValue, localDateInputValue } from "@/lib/utils";
import type { Asset, CustomField, Designer } from "@/lib/types";

export interface OrderFormBodyProps {
  idPrefix: string;
  customFields: CustomField[];
  designers: Designer[];
  title: string;
  onTitleChange: (value: string) => void;
  priority: string;
  onPriorityChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  customerName: string;
  onCustomerNameChange: (value: string) => void;
  customerContact: string;
  onCustomerContactChange: (value: string) => void;
  designerId: string;
  onDesignerIdChange: (value: string) => void;
  designTask: string;
  onDesignTaskChange: (value: string) => void;
  fieldValues: Record<string, unknown>;
  onFieldValueChange: (fieldId: string, value: unknown) => void;
  skus: SkuItem[];
  onSkusChange: (value: SkuItem[]) => void;
  dueDate: string;
  onDueDateChange: (value: string) => void;
  /** Original due date when editing — allows saving unchanged legacy past dates. */
  previousDueDate?: string | null;
  orderId?: string;
  skuAssets?: Asset[];
  pendingSkuArtwork?: Record<string, File>;
  onPendingSkuArtworkChange?: (files: Record<string, File>) => void;
  deferSkuArtworkUpload?: boolean;
  removedSkuArtworkIds?: ReadonlySet<string>;
  onMarkSkuArtworkForRemoval?: (assetId: string) => void;
  onUnmarkSkuArtworkForRemoval?: (assetId: string) => void;
}

export function OrderFormBody({
  idPrefix,
  customFields,
  designers,
  title,
  onTitleChange,
  priority,
  onPriorityChange,
  description,
  onDescriptionChange,
  customerName,
  onCustomerNameChange,
  customerContact,
  onCustomerContactChange,
  designerId,
  onDesignerIdChange,
  designTask,
  onDesignTaskChange,
  fieldValues,
  onFieldValueChange,
  skus,
  onSkusChange,
  dueDate,
  onDueDateChange,
  previousDueDate,
  orderId,
  skuAssets,
  pendingSkuArtwork,
  onPendingSkuArtworkChange,
  deferSkuArtworkUpload,
  removedSkuArtworkIds,
  onMarkSkuArtworkForRemoval,
  onUnmarkSkuArtworkForRemoval,
}: OrderFormBodyProps) {
  const resolved = resolveOrderFormFields(customFields);
  const { artworkField, orderQtyField, printFields } = resolved;
  const [dueDateError, setDueDateError] = useState<string | null>(null);
  const normalizedDueDate = dateInputValue(dueDate);
  const minDueDate = localDateInputValue();

  function handleDueDateChange(value: string) {
    if (!value) {
      setDueDateError(null);
      onDueDateChange("");
      return;
    }
    const normalized = dateInputValue(value);
    const error = validateDueDate(normalized, previousDueDate);
    if (error) {
      setDueDateError(error);
      return;
    }
    setDueDateError(null);
    onDueDateChange(normalized);
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor={`${idPrefix}-title`}>
            Order Number<span className="ml-0.5 text-red-500">*</span>
          </Label>
          <Input
            id={`${idPrefix}-title`}
            required
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="e.g. PO-10245"
          />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-priority`}>Priority</Label>
          <Select
            id={`${idPrefix}-priority`}
            value={priority}
            onChange={(e) => onPriorityChange(e.target.value)}
          >
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-due`}>Due date</Label>
          <Input
            id={`${idPrefix}-due`}
            type="date"
            min={minDueDate}
            value={normalizedDueDate}
            onChange={(e) => handleDueDateChange(e.target.value)}
            aria-invalid={dueDateError ? true : undefined}
            className={
              dueDateError
                ? "border-red-400 focus:border-red-500 focus:ring-red-500/30"
                : undefined
            }
          />
          {dueDateError ? (
            <p className="mt-1 text-xs text-red-600">{dueDateError}</p>
          ) : null}
        </div>
      </div>

      <div>
        <Label htmlFor={`${idPrefix}-desc`}>Order Description</Label>
        <Textarea
          id={`${idPrefix}-desc`}
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="Notes, references, special instructions…"
        />
      </div>

      {artworkField ? (
        <div>
          <Label htmlFor={`${idPrefix}-artwork`}>
            {orderFormFieldLabel(artworkField.name)}
          </Label>
          <Input
            id={`${idPrefix}-artwork`}
            value={(fieldValues[artworkField.id] as string) ?? ""}
            onChange={(e) =>
              onFieldValueChange(artworkField.id, e.target.value)
            }
            placeholder="https://drive.google.com/…"
          />
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${idPrefix}-customer-name`}>
            Customer Name<span className="ml-0.5 text-red-500">*</span>
          </Label>
          <Input
            id={`${idPrefix}-customer-name`}
            required
            value={customerName}
            onChange={(e) => onCustomerNameChange(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-customer-contact`}>
            Customer Contact<span className="ml-0.5 text-red-500">*</span>
          </Label>
          <Input
            id={`${idPrefix}-customer-contact`}
            required
            value={customerContact}
            onChange={(e) => onCustomerContactChange(e.target.value)}
            placeholder="Email or phone"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${idPrefix}-designer`}>Designer</Label>
          <Select
            id={`${idPrefix}-designer`}
            value={designerId}
            onChange={(e) => onDesignerIdChange(e.target.value)}
          >
            <option value="">
              {designers.length ? "Unassigned" : "No designers on team"}
            </option>
            {designers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-design-task`}>Design task</Label>
          <Input
            id={`${idPrefix}-design-task`}
            value={designTask}
            onChange={(e) => onDesignTaskChange(e.target.value)}
            placeholder="e.g. Prepare proof / prepress"
          />
        </div>
      </div>

      {printFields.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {printFields.map((field) => (
            <CustomFieldInput
              key={field.id}
              field={{
                ...field,
                name: orderFormFieldLabel(field.name),
              }}
              value={fieldValues[field.id]}
              onChange={(v) => onFieldValueChange(field.id, v)}
            />
          ))}
        </div>
      ) : null}

      <SkuEditor
        value={skus}
        onChange={onSkusChange}
        orderId={orderId}
        assets={skuAssets}
        pendingArtwork={pendingSkuArtwork}
        onPendingArtworkChange={onPendingSkuArtworkChange}
        deferArtworkUpload={deferSkuArtworkUpload}
        removedArtworkIds={removedSkuArtworkIds}
        onMarkArtworkForRemoval={onMarkSkuArtworkForRemoval}
        onUnmarkArtworkForRemoval={onUnmarkSkuArtworkForRemoval}
      />

      {orderQtyField ? (
        <OrderQtyField
          skus={skus}
          value={(fieldValues[orderQtyField.id] as number | null) ?? null}
          onChange={(v) => onFieldValueChange(orderQtyField.id, v)}
        />
      ) : null}
    </div>
  );
}
