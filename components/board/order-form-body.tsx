"use client";

import { useEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { CustomFieldInput } from "./custom-field-input";
import { SkuEditor, type SkuItem } from "./sku-editor";
import { OrderQtyField } from "./order-qty-field";
import { PRIORITY_OPTIONS } from "@/lib/constants";
import { normalizeCustomerContact } from "@/lib/customers";
import {
  isEmptyFieldValue,
  isValidCustomerContact,
  orderFormFieldLabel,
  resolveOrderFormFields,
  validateDueDate,
} from "@/lib/order-form";
import { cn, dateInputValue, localDateInputValue } from "@/lib/utils";
import type { Asset, Tag, CustomField, Designer, NoteEntry, OrderSkuImageWithUrl } from "@/lib/types";

export interface OrderOwner {
  id: string;
  name: string;
}

export interface OrderFormBodyProps {
  idPrefix: string;
  customFields: CustomField[];
  owners: OrderOwner[];
  designers: Designer[];
  title: string;
  onTitleChange: (value: string) => void;
  priority: string;
  onPriorityChange: (value: string) => void;
  ownerId: string;
  onOwnerIdChange: (value: string) => void;
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
  /** Parsed history of past note entries (edit mode only). */
  noteHistory?: NoteEntry[];
  internalNote: string;
  onInternalNoteChange: (value: string) => void;
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
  skuImagesBySkuId?: Record<string, OrderSkuImageWithUrl[]>;
  pendingSkuArtwork?: Record<string, File>;
  onPendingSkuArtworkChange?: (files: Record<string, File>) => void;
  deferSkuArtworkUpload?: boolean;
  removedSkuArtworkIds?: ReadonlySet<string>;
  onMarkSkuArtworkForRemoval?: (assetId: string) => void;
  onUnmarkSkuArtworkForRemoval?: (assetId: string) => void;
  /** Saves a newly added SKU row before gallery uploads can attach to it. */
  ensureSkuPersisted?: (skuId: string) => Promise<string | null>;
  readOnly?: boolean;
  /** When true, fields with no value are hidden (view mode). */
  hideEmpty?: boolean;
  /** Hide order number field (shown in modal title when editing existing orders). */
  hideOrderNumberField?: boolean;
  /** Hide priority and due date fields (rendered elsewhere in the modal). */
  hidePriorityAndDueDateFields?: boolean;
  /** Hide owner field (rendered in the modal header bar). */
  hideOwnerField?: boolean;
  /** Hide customer name/contact fields (shown in the modal header dropdown instead). */
  hideCustomerSection?: boolean;
  tags?: Tag[];
  tagId?: string;
  onTagIdChange?: (value: string) => void;
}

export function OrderFormBody({
  idPrefix,
  customFields,
  owners,
  designers,
  title,
  onTitleChange,
  priority,
  onPriorityChange,
  ownerId,
  onOwnerIdChange,
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
  noteHistory,
  internalNote,
  onInternalNoteChange,
  fieldValues,
  onFieldValueChange,
  skus,
  onSkusChange,
  dueDate,
  onDueDateChange,
  previousDueDate,
  orderId,
  skuAssets,
  skuImagesBySkuId,
  pendingSkuArtwork,
  onPendingSkuArtworkChange,
  deferSkuArtworkUpload,
  removedSkuArtworkIds,
  onMarkSkuArtworkForRemoval,
  onUnmarkSkuArtworkForRemoval,
  ensureSkuPersisted,
  readOnly = false,
  hideEmpty = false,
  hideOrderNumberField = false,
  hidePriorityAndDueDateFields = false,
  hideOwnerField = false,
  hideCustomerSection = false,
  tags = [],
  tagId = "",
  onTagIdChange,
}: OrderFormBodyProps) {
  const resolved = resolveOrderFormFields(customFields);
  const { artworkField, designerField, orderQtyField, printFields } = resolved;
  const [artworkCopied, setArtworkCopied] = useState(false);
  const [dueDateError, setDueDateError] = useState<string | null>(null);
  const [customerLookupHint, setCustomerLookupHint] = useState<string | null>(
    null
  );
  const nameEditedRef = useRef(false);
  const lookupSeqRef = useRef(0);
  const lastLookupKeyRef = useRef<string | null>(null);
  const normalizedDueDate = dateInputValue(dueDate);
  const minDueDate = localDateInputValue();
  const artworkValue = artworkField
    ? String(fieldValues[artworkField.id] ?? "").trim()
    : "";

  const visiblePrintFields = hideEmpty
    ? printFields.filter((f) => !isEmptyFieldValue(fieldValues[f.id]))
    : printFields;

  async function copyArtworkLink() {
    if (!artworkValue) return;
    try {
      await navigator.clipboard.writeText(artworkValue);
      setArtworkCopied(true);
      setTimeout(() => setArtworkCopied(false), 1500);
    } catch {
      // ignore clipboard failures
    }
  }

  useEffect(() => {
    if (readOnly) return;

    const normalized = normalizeCustomerContact(customerContact);
    const lookupKey = normalized
      ? `${normalized.kind}:${normalized.value}`
      : null;
    if (lookupKey !== lastLookupKeyRef.current) {
      nameEditedRef.current = false;
      lastLookupKeyRef.current = lookupKey;
      if (!lookupKey) setCustomerLookupHint(null);
    }
  }, [customerContact, readOnly]);

  useEffect(() => {
    if (readOnly) return;

    if (!isValidCustomerContact(customerContact)) {
      setCustomerLookupHint(null);
      return;
    }

    const seq = ++lookupSeqRef.current;
    const timer = window.setTimeout(async () => {
      try {
        const normalized = normalizeCustomerContact(customerContact);
        const params = new URLSearchParams();
        if (normalized?.kind === "email") {
          params.set("email", normalized.value);
        } else if (normalized?.kind === "phone") {
          params.set("phone", normalized.value);
        } else {
          params.set("contact", customerContact);
        }
        const res = await fetch(`/api/customers/lookup?${params}`);
        if (seq !== lookupSeqRef.current) return;
        if (!res.ok) {
          setCustomerLookupHint(null);
          return;
        }
        const json = (await res.json()) as {
          name?: string;
          email?: string | null;
          phone?: string | null;
        } | null;
        if (seq !== lookupSeqRef.current) return;
        if (!json) {
          setCustomerLookupHint(null);
          return;
        }
        if (!nameEditedRef.current && json.name) {
          onCustomerNameChange(json.name);
        }
        const extraContact =
          normalized?.kind === "phone" && json.email
            ? json.email
            : normalized?.kind === "email" && json.phone
              ? json.phone
              : null;
        setCustomerLookupHint(
          extraContact
            ? `Existing customer found — fields auto-filled (also on file: ${extraContact})`
            : "Existing customer found — fields auto-filled"
        );
      } catch {
        if (seq !== lookupSeqRef.current) return;
        setCustomerLookupHint(null);
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [customerContact, onCustomerNameChange, readOnly]);

  function handleCustomerNameChange(value: string) {
    nameEditedRef.current = true;
    onCustomerNameChange(value);
  }

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
      <div
        className={
          hideOrderNumberField
            ? "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
            : "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
        }
      >
        {!hideOrderNumberField ? (
          <div>
            <Label htmlFor={`${idPrefix}-title`}>
              Order Number<span className="ml-0.5 text-red-500">*</span>
            </Label>
            <Input
              id={`${idPrefix}-title`}
              required
              readOnly={readOnly}
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              placeholder="e.g. PO-10245"
              className={readOnly ? "bg-slate-50" : undefined}
            />
          </div>
        ) : null}
        {!hidePriorityAndDueDateFields ? (
        <div>
          <Label htmlFor={`${idPrefix}-priority`}>Priority</Label>
          <Select
            id={`${idPrefix}-priority`}
            value={priority}
            disabled={readOnly}
            onChange={(e) => onPriorityChange(e.target.value)}
          >
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
        ) : null}
        {!hideOwnerField ? (
        <div>
          <Label htmlFor={`${idPrefix}-owner`}>Owner</Label>
          <Select
            id={`${idPrefix}-owner`}
            value={ownerId}
            disabled={readOnly}
            onChange={(e) => onOwnerIdChange(e.target.value)}
          >
            <option value="">— Unassigned —</option>
            {owners.length === 0 ? (
              <option value="" disabled>
                No account managers
              </option>
            ) : null}
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </Select>
        </div>
        ) : null}
        {!hidePriorityAndDueDateFields ? (
        <div>
          <Label htmlFor={`${idPrefix}-due`}>Due date</Label>
          <Input
            id={`${idPrefix}-due`}
            type="date"
            min={readOnly ? undefined : minDueDate}
            readOnly={readOnly}
            value={normalizedDueDate}
            onChange={(e) => handleDueDateChange(e.target.value)}
            aria-invalid={dueDateError ? true : undefined}
            className={
              dueDateError
                ? "border-red-400 focus:border-red-500 focus:ring-red-500/30"
                : readOnly
                  ? "bg-slate-50"
                  : undefined
            }
          />
          {dueDateError ? (
            <p className="mt-1 text-xs text-red-600">{dueDateError}</p>
          ) : null}
        </div>
        ) : null}
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-4">
        {visiblePrintFields.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {visiblePrintFields.map((field) => (
              <CustomFieldInput
                key={field.id}
                field={{
                  ...field,
                  name: orderFormFieldLabel(field.name),
                }}
                value={fieldValues[field.id]}
                onChange={(v) => onFieldValueChange(field.id, v)}
                readOnly={readOnly}
              />
            ))}
          </div>
        ) : null}

        <SkuEditor
          value={skus}
          onChange={onSkusChange}
          orderId={orderId}
          assets={skuAssets}
          skuImagesBySkuId={skuImagesBySkuId}
          pendingArtwork={pendingSkuArtwork}
          onPendingArtworkChange={onPendingSkuArtworkChange}
          deferArtworkUpload={deferSkuArtworkUpload}
          removedArtworkIds={removedSkuArtworkIds}
          onMarkArtworkForRemoval={onMarkSkuArtworkForRemoval}
          onUnmarkArtworkForRemoval={onUnmarkSkuArtworkForRemoval}
          ensureSkuPersisted={ensureSkuPersisted}
          disabled={readOnly}
        />

        {orderQtyField ? (
          <OrderQtyField
            skus={skus}
            value={(fieldValues[orderQtyField.id] as number | null) ?? null}
            onChange={(v) => onFieldValueChange(orderQtyField.id, v)}
            readOnly={readOnly}
          />
        ) : null}

        {(!hideEmpty || description.trim()) ? (
        <div>
          <Label htmlFor={`${idPrefix}-desc`}>Order Description</Label>
          <Textarea
            id={`${idPrefix}-desc`}
            readOnly={readOnly}
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder="Notes, references, special instructions…"
            className={readOnly ? "bg-white" : "bg-white"}
          />
        </div>
        ) : null}
      </div>

      <div className="border-t border-slate-200" />

      {(!hideEmpty || designerId || designTask) ? (
      <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-400">
          Designer
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor={`${idPrefix}-designer`}>
              Assigned designer
              {designerField?.required ? (
                <span className="ml-0.5 text-red-500">*</span>
              ) : null}
            </Label>
            <Select
              id={`${idPrefix}-designer`}
              value={designerId}
              disabled={readOnly}
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
            <Label htmlFor={`${idPrefix}-design-task`}>
              {designTask && /^https?:\/\//i.test(designTask.trim()) ? (
                <a
                  href={designTask.trim()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--primary)] underline hover:opacity-80"
                >
                  Design files ↗
                </a>
              ) : (
                "Design files"
              )}
            </Label>
            <Input
              id={`${idPrefix}-design-task`}
              readOnly={readOnly}
              value={designTask}
              onChange={(e) => onDesignTaskChange(e.target.value)}
              placeholder="e.g. https://drive.google.com/..."
              className={readOnly ? "bg-slate-50" : undefined}
            />
          </div>
        </div>
      </div>
      ) : null}

      {artworkField && (!hideEmpty || artworkValue) ? (
        <div>
          <Label htmlFor={`${idPrefix}-artwork`}>
            {orderFormFieldLabel(artworkField.name)}
            {artworkField.required ? (
              <span className="ml-0.5 text-red-500">*</span>
            ) : null}
          </Label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={copyArtworkLink}
              disabled={!artworkValue}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              title="Copy Artwork GDrive link"
            >
              <Copy className="h-4 w-4" />
              {artworkCopied ? "Copied" : "Copy Link"}
            </button>
            <Input
              id={`${idPrefix}-artwork`}
              readOnly={readOnly}
              value={(fieldValues[artworkField.id] as string) ?? ""}
              onChange={(e) =>
                onFieldValueChange(artworkField.id, e.target.value)
              }
              placeholder="https://drive.google.com/…"
              className={cn(
                "min-w-0 flex-1",
                readOnly ? "bg-slate-50" : undefined
              )}
            />
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <hr className="flex-1 border-slate-200" />
        <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Notes (Internal)
        </span>
        <hr className="flex-1 border-slate-200" />
      </div>

      {noteHistory && noteHistory.length > 0 ? (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          {noteHistory.map((entry, i) => (
            <div key={i}>
              {i > 0 && <hr className="mb-2 border-slate-200" />}
              <p className="mb-1 text-[11px] font-semibold text-slate-400">
                {entry.author}
                <span className="mx-1 font-normal">/</span>
                {new Date(entry.date).toLocaleString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
              <p className="whitespace-pre-wrap text-sm text-slate-700">{entry.text}</p>
            </div>
          ))}
        </div>
      ) : null}

      {!readOnly ? (
        <div>
          <Label htmlFor={`${idPrefix}-internal-note`}>
            {noteHistory && noteHistory.length > 0 ? (
              <>
                Add new note{" "}
                <span className="text-[11px] font-normal text-slate-400">(Internal)</span>
              </>
            ) : (
              <>
                Note{" "}
                <span className="text-[11px] font-normal text-slate-400">(Internal)</span>
              </>
            )}
          </Label>
          <Textarea
            id={`${idPrefix}-internal-note`}
            value={internalNote}
            onChange={(e) => onInternalNoteChange(e.target.value)}
            placeholder="Internal notes visible only to the team…"
          />
        </div>
      ) : null}

      {!hideCustomerSection ? (
        <>
          <div className="border-t border-slate-200" />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor={`${idPrefix}-customer-name`}>
                Customer Name<span className="ml-0.5 text-red-500">*</span>
              </Label>
              <Input
                id={`${idPrefix}-customer-name`}
                required
                readOnly={readOnly}
                value={customerName}
                onChange={(e) => handleCustomerNameChange(e.target.value)}
                className={readOnly ? "bg-slate-50" : undefined}
              />
            </div>
            <div>
              <Label htmlFor={`${idPrefix}-customer-contact`}>
                Customer Contact<span className="ml-0.5 text-red-500">*</span>
              </Label>
              <Input
                id={`${idPrefix}-customer-contact`}
                required
                readOnly={readOnly}
                value={customerContact}
                onChange={(e) => onCustomerContactChange(e.target.value)}
                placeholder="Email or phone"
                className={readOnly ? "bg-slate-50" : undefined}
              />
              {customerLookupHint ? (
                <p className="mt-1 text-xs text-emerald-600">{customerLookupHint}</p>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
