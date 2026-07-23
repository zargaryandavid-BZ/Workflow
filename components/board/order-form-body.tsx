"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CircleHelp, Copy, Mail, Phone, User } from "lucide-react";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { CustomFieldInput } from "./custom-field-input";
import { ProductMaterialsFields } from "./product-materials-fields";
import { SkuEditor, type SkuItem } from "./sku-editor";
import { OrderQtyField, sumSkuQty } from "./order-qty-field";
import { PRIORITY_OPTIONS } from "@/lib/constants";
import { normalizeCustomerContact } from "@/lib/customers";
import {
  isEmptyFieldValue,
  isValidCustomerContact,
  orderFormFieldLabel,
  resolveOrderFormFields,
  validateDueDate,
} from "@/lib/order-form";
import {
  categoryForProductFromLinks,
  clearTargetsForSourceChange,
  getFilteredOptions,
  linkedTargetOptions,
  uniqueOptions,
} from "@/lib/field-links";
import {
  isMultiSelectField,
  parseMultiSelectValue,
} from "@/lib/multi-select-fields";
import { categoryForProduct, productsForCategory } from "@/lib/product-data";
import { cn, dateInputValue, localDateInputValue } from "@/lib/utils";
import { formatDesignerOptionLabel } from "@/lib/designer-load";
import type {
  Tag,
  CustomField,
  Designer,
  FieldLink,
  NoteEntry,
  OrderSkuImageWithUrl,
} from "@/lib/types";

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
  skuImagesBySkuId?: Record<string, OrderSkuImageWithUrl[]>;
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
  skuImagesBySkuId,
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
  const { artworkField, orderQtyField, printFields } = resolved;
  const [artworkCopied, setArtworkCopied] = useState(false);
  const [dueDateError, setDueDateError] = useState<string | null>(null);
  const [customerLookupHint, setCustomerLookupHint] = useState<string | null>(
    null
  );
  const nameEditedRef = useRef(false);
  const lookupSeqRef = useRef(0);
  const lastLookupKeyRef = useRef<string | null>(null);
  /** Avoid stale closure when deciding whether lookup may overwrite the name. */
  const customerNameRef = useRef(customerName);
  customerNameRef.current = customerName;

  interface CustomerSuggestion {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    company: string | null;
  }
  const [nameSuggestions, setNameSuggestions] = useState<CustomerSuggestion[]>([]);
  const [showNameDropdown, setShowNameDropdown] = useState(false);
  const nameSeqRef = useRef(0);
  const nameWrapperRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const [contactSuggestions, setContactSuggestions] = useState<CustomerSuggestion[]>([]);
  const [showContactDropdown, setShowContactDropdown] = useState(false);
  const contactSeqRef = useRef(0);
  const contactWrapperRef = useRef<HTMLDivElement>(null);
  const contactInputRef = useRef<HTMLInputElement>(null);
  const normalizedDueDate = dateInputValue(dueDate);
  const minDueDate = localDateInputValue();
  const artworkValue = artworkField
    ? String(fieldValues[artworkField.id] ?? "").trim()
    : "";

  const [fieldLinks, setFieldLinks] = useState<FieldLink[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/field-links");
        if (!res.ok) return;
        const json = (await res.json()) as FieldLink[];
        if (!cancelled) setFieldLinks(json ?? []);
      } catch {
        // Non-fatal: form works without link filtering.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleLinkedFieldChange(fieldId: string, value: unknown) {
    onFieldValueChange(fieldId, value);
    if (readOnly) return;
    for (const targetId of clearTargetsForSourceChange(fieldLinks, fieldId)) {
      if (!isEmptyFieldValue(fieldValues[targetId])) {
        onFieldValueChange(targetId, "");
      }
    }
  }

  function handleSkusChange(next: SkuItem[]) {
    onSkusChange(next);
    if (!orderQtyField || readOnly) return;
    onFieldValueChange(
      orderQtyField.id,
      next.length === 0 ? null : sumSkuQty(next)
    );
  }
  const categoryField =
    printFields.find((f) => f.name === "Category") ??
    printFields.find((f) => f.name.trim().toLowerCase() === "category");
  const productField =
    printFields.find((f) => f.name === "Product") ??
    printFields.find((f) => f.name.trim().toLowerCase() === "product");
  const materialsField =
    printFields.find((f) => f.name === "Materials") ??
    printFields.find((f) => f.name.trim().toLowerCase() === "materials");
  const useCascadingProductMaterials = Boolean(productField && materialsField);
  const cascadingFieldIds = useCascadingProductMaterials
    ? new Set(
        [categoryField?.id, productField!.id, materialsField!.id].filter(
          Boolean
        ) as string[]
      )
    : new Set<string>();

  const visiblePrintFields = (hideEmpty
    ? printFields.filter((f) => !isEmptyFieldValue(fieldValues[f.id]))
    : printFields
  ).filter((f) => !cascadingFieldIds.has(f.id));

  /** Prefer field_links for Category→Product when that link exists. */
  const productOptionsOverride = (() => {
    if (!categoryField || !productField) return null;
    const category = String(fieldValues[categoryField.id] ?? "").trim();
    const linked = linkedTargetOptions(
      fieldLinks,
      categoryField.id,
      productField,
      category
    );
    if (linked === null) return null;
    // Link exists but Category not chosen yet → no products (force pick Category).
    if (!category) return [];
    return linked;
  })();

  /** Prefer field_links for Product→Materials when that link exists. */
  const materialOptionsOverride = (() => {
    if (!productField || !materialsField) return null;
    const product = String(fieldValues[productField.id] ?? "").trim();
    const linked = linkedTargetOptions(
      fieldLinks,
      productField.id,
      materialsField,
      product
    );
    if (linked === null) return null;
    if (!product) return [];
    return linked;
  })();

  function handleCategoryLinkedChange(value: unknown) {
    if (!categoryField) return;
    // Stores the exact option string (including emoji prefixes).
    handleLinkedFieldChange(categoryField.id, value);
    if (readOnly || !productField) return;
    const cat = String(value ?? "").trim();
    if (!cat) return;
    const opts =
      linkedTargetOptions(fieldLinks, categoryField.id, productField, cat) ??
      productsForCategory(cat, productField.options);
    if (opts.length === 1) {
      handleLinkedFieldChange(productField.id, opts[0]);
    }
  }

  function handleProductLinkedChange(value: unknown) {
    if (!productField) return;
    handleLinkedFieldChange(productField.id, value);
  }

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
    // Card detail hides this section; do not reset/edit name via contact lookup.
    if (readOnly || hideCustomerSection) return;

    const normalized = normalizeCustomerContact(customerContact);
    const lookupKey = normalized
      ? `${normalized.kind}:${normalized.value}`
      : null;
    if (lookupKey !== lastLookupKeyRef.current) {
      nameEditedRef.current = false;
      lastLookupKeyRef.current = lookupKey;
      if (!lookupKey) setCustomerLookupHint(null);
    }
  }, [customerContact, readOnly, hideCustomerSection]);

  useEffect(() => {
    // Skip on card detail (customer UI is elsewhere) so opening a ticket does
    // not overwrite the saved name and falsely mark the form dirty.
    if (readOnly || hideCustomerSection) return;

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
        // Only fill an empty name — never replace a value already on the form.
        const filledName =
          !nameEditedRef.current &&
          json.name &&
          !customerNameRef.current.trim();
        if (filledName && json.name) {
          onCustomerNameChange(json.name);
        }
        const extraContact =
          normalized?.kind === "phone" && json.email
            ? json.email
            : normalized?.kind === "email" && json.phone
              ? json.phone
              : null;
        if (filledName || extraContact) {
          setCustomerLookupHint(
            extraContact
              ? filledName
                ? `Existing customer found — fields auto-filled (also on file: ${extraContact})`
                : `Existing customer on file (also: ${extraContact})`
              : "Existing customer found — fields auto-filled"
          );
        } else {
          setCustomerLookupHint("Existing customer found");
        }
      } catch {
        if (seq !== lookupSeqRef.current) return;
        setCustomerLookupHint(null);
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [customerContact, onCustomerNameChange, readOnly, hideCustomerSection]);

  // Name-based search: debounce and fetch matching customers (starts at 5 chars)
  useEffect(() => {
    if (readOnly || hideCustomerSection || customerName.trim().length < 5) {
      setNameSuggestions([]);
      setShowNameDropdown(false);
      return;
    }
    const seq = ++nameSeqRef.current;
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/customers/search?q=${encodeURIComponent(customerName.trim())}`
        );
        if (seq !== nameSeqRef.current) return;
        if (!res.ok) { setNameSuggestions([]); return; }
        const json = (await res.json()) as { customers: CustomerSuggestion[] };
        if (seq !== nameSeqRef.current) return;
        setNameSuggestions(json.customers ?? []);
        setShowNameDropdown((json.customers ?? []).length > 0);
      } catch {
        if (seq !== nameSeqRef.current) return;
        setNameSuggestions([]);
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [customerName, readOnly, hideCustomerSection]);

  // Close name dropdown on outside click
  useEffect(() => {
    if (!showNameDropdown) return;
    function handler(e: MouseEvent) {
      if (nameWrapperRef.current && !nameWrapperRef.current.contains(e.target as Node)) {
        setShowNameDropdown(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showNameDropdown]);

  // Contact field search (phone/email prefix, 5+ chars)
  useEffect(() => {
    if (readOnly || hideCustomerSection || customerContact.trim().length < 5) {
      setContactSuggestions([]);
      setShowContactDropdown(false);
      return;
    }
    const seq = ++contactSeqRef.current;
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/customers/search?contact=${encodeURIComponent(customerContact.trim())}`
        );
        if (seq !== contactSeqRef.current) return;
        if (!res.ok) { setContactSuggestions([]); return; }
        const json = (await res.json()) as { customers: CustomerSuggestion[] };
        if (seq !== contactSeqRef.current) return;
        setContactSuggestions(json.customers ?? []);
        setShowContactDropdown((json.customers ?? []).length > 0);
      } catch {
        if (seq !== contactSeqRef.current) return;
        setContactSuggestions([]);
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [customerContact, readOnly, hideCustomerSection]);

  // Close contact dropdown on outside click
  useEffect(() => {
    if (!showContactDropdown) return;
    function handler(e: MouseEvent) {
      if (contactWrapperRef.current && !contactWrapperRef.current.contains(e.target as Node)) {
        setShowContactDropdown(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showContactDropdown]);

  function pickContactFromSuggestion(s: CustomerSuggestion, typed: string): string {
    // Pick the contact type that matches what the user searched by.
    const looksLikePhone = /^[+\d]/.test(typed.trim());
    if (looksLikePhone && s.phone) return s.phone;
    if (!looksLikePhone && s.email) return s.email;
    return s.email ?? s.phone ?? "";
  }

  function applyContactSuggestion(s: CustomerSuggestion) {
    const contact = pickContactFromSuggestion(s, customerContact);
    if (contact) onCustomerContactChange(contact);
    if (!nameEditedRef.current && s.name) onCustomerNameChange(s.name);
    setShowContactDropdown(false);
    setContactSuggestions([]);
    setCustomerLookupHint(
      s.email && s.phone
        ? `Existing customer — also on file: ${contact === s.email ? s.phone : s.email}`
        : "Existing customer found — fields auto-filled"
    );
  }

  function applyNameSuggestion(s: CustomerSuggestion) {
    onCustomerNameChange(s.name);
    const contact = s.email ?? s.phone ?? "";
    if (contact) onCustomerContactChange(contact);
    setShowNameDropdown(false);
    setNameSuggestions([]);
    if (contact) {
      setCustomerLookupHint(
        s.email && s.phone
          ? `Existing customer — also on file: ${s.email === contact ? s.phone : s.email}`
          : "Existing customer found — fields auto-filled"
      );
    }
  }

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
      {!hideOrderNumberField ? (
        <div>
          <Label htmlFor={`${idPrefix}-title`}>
            Order Title<span className="ml-0.5 text-red-500">*</span>
          </Label>
          <Input
            id={`${idPrefix}-title`}
            required
            readOnly={readOnly}
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="e.g. Mixed Print Order — ACME Corp"
            className={readOnly ? "bg-slate-50" : undefined}
          />
        </div>
      ) : null}

      {(!hidePriorityAndDueDateFields || !hideOwnerField) ? (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-4">
        {useCascadingProductMaterials && productField && materialsField ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ProductMaterialsFields
              categoryField={categoryField}
              productField={productField}
              materialsField={materialsField}
              categoryValue={
                categoryField ? fieldValues[categoryField.id] : undefined
              }
              productValue={fieldValues[productField.id]}
              materialsValue={fieldValues[materialsField.id]}
              onCategoryChange={
                categoryField ? handleCategoryLinkedChange : undefined
              }
              onCategorySync={
                categoryField
                  ? (v) => onFieldValueChange(categoryField.id, v)
                  : undefined
              }
              inferCategoryFromProduct={
                categoryField && productField
                  ? (productName) =>
                      categoryForProductFromLinks(
                        fieldLinks,
                        categoryField,
                        productField,
                        productName
                      ) ?? categoryForProduct(productName)
                  : undefined
              }
              onProductChange={handleProductLinkedChange}
              onMaterialsChange={(v) =>
                handleLinkedFieldChange(materialsField.id, v)
              }
              productOptionsOverride={productOptionsOverride}
              materialOptionsOverride={materialOptionsOverride}
              readOnly={readOnly}
              hideEmpty={hideEmpty}
            />
          </div>
        ) : null}

        {visiblePrintFields.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {visiblePrintFields.map((field) => {
              const filteredOptions =
                field.field_type === "select"
                  ? getFilteredOptions(field, fieldValues, fieldLinks)
                  : uniqueOptions(field.options);
              const current = fieldValues[field.id];
              let optionsWithCurrent = filteredOptions;
              if (field.field_type === "select" && current != null && current !== "") {
                if (isMultiSelectField(field)) {
                  // Keep individual webhook parts visible — never inject "X, Y" as one option.
                  const parts = parseMultiSelectValue(current, filteredOptions);
                  const extras = parts.filter(
                    (p) => !filteredOptions.includes(p)
                  );
                  if (extras.length > 0) {
                    optionsWithCurrent = uniqueOptions([
                      ...filteredOptions,
                      ...extras,
                    ]);
                  }
                } else if (
                  typeof current === "string" &&
                  !filteredOptions.includes(current)
                ) {
                  optionsWithCurrent = uniqueOptions([
                    current,
                    ...filteredOptions,
                  ]);
                }
              }

              return (
                <CustomFieldInput
                  key={field.id}
                  field={{
                    ...field,
                    // Keep original name for multi-select detection; label is separate.
                    name: field.name,
                    options: optionsWithCurrent,
                  }}
                  label={orderFormFieldLabel(field.name)}
                  value={current}
                  onChange={(v) => handleLinkedFieldChange(field.id, v)}
                  readOnly={readOnly}
                />
              );
            })}
          </div>
        ) : null}

        {orderQtyField ? (
          <OrderQtyField
            skus={skus}
            value={(fieldValues[orderQtyField.id] as number | null) ?? null}
            onChange={(v) => onFieldValueChange(orderQtyField.id, v)}
            readOnly={readOnly}
            label={orderFormFieldLabel(orderQtyField.name)}
          />
        ) : null}

        <SkuEditor
          value={skus}
          onChange={handleSkusChange}
          orderId={orderId}
          skuImagesBySkuId={skuImagesBySkuId}
          ensureSkuPersisted={ensureSkuPersisted}
          disabled={readOnly}
        />

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
          For Designer
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor={`${idPrefix}-designer`}>
              Assigned designer
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
                  {formatDesignerOptionLabel(d.name, d.load)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor={`${idPrefix}-design-task`}>
              <span className="inline-flex items-center gap-1">
                {designTask && /^https?:\/\//i.test(designTask.trim()) ? (
                  <a
                    href={designTask.trim()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--primary)] underline hover:opacity-80"
                  >
                    Designer folder ↗
                  </a>
                ) : (
                  <span>Designer folder</span>
                )}
                <span
                  className="inline-flex cursor-help text-slate-400"
                  title="Project files to be used by the designer"
                >
                  <CircleHelp
                    className="h-3.5 w-3.5"
                    aria-hidden
                  />
                  <span className="sr-only">
                    Project files to be used by the designer
                  </span>
                </span>
              </span>
            </Label>
            <Input
              id={`${idPrefix}-design-task`}
              readOnly={readOnly}
              value={designTask}
              onChange={(e) => onDesignTaskChange(e.target.value)}
              placeholder="e.g. …/26-0098_Customer_1"
              className={readOnly ? "bg-slate-50" : undefined}
            />
          </div>
        </div>
      </div>
      ) : null}

      {artworkField && (!hideEmpty || artworkValue) ? (
        <div>
          <Label htmlFor={`${idPrefix}-artwork`}>
            {(() => {
              const url = String(fieldValues[artworkField.id] ?? "").trim();
              const label = orderFormFieldLabel(artworkField.name);
              return (
                <span className="inline-flex items-center gap-1">
                  {/^https?:\/\//i.test(url) ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--primary)] underline hover:opacity-80"
                    >
                      {label} ↗
                    </a>
                  ) : (
                    <span>
                      {label}
                      {artworkField.required ? (
                        <span className="ml-0.5 text-red-500">*</span>
                      ) : null}
                    </span>
                  )}
                  <span
                    className="inline-flex cursor-help text-slate-400"
                    title="Production-ready files"
                  >
                    <CircleHelp className="h-3.5 w-3.5" aria-hidden />
                    <span className="sr-only">Production-ready files</span>
                  </span>
                </span>
              );
            })()}
          </Label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={copyArtworkLink}
              disabled={!artworkValue}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              title="Copy Final production GDrive link"
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
              placeholder="e.g. …/26-0098_Final for Prod_1"
              className={cn(
                "min-w-0 flex-1",
                readOnly ? "bg-slate-50" : undefined
              )}
            />
          </div>
        </div>
      ) : null}

      {(!hideEmpty || (noteHistory && noteHistory.length > 0) || !readOnly) ? (
        <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
              Attention
            </p>
            <span className="text-[11px] font-normal text-amber-600/80">
              Internal notes
            </span>
          </div>

          {noteHistory && noteHistory.length > 0 ? (
            <div className="space-y-2">
              {noteHistory.map((entry, i) => (
                <div key={i}>
                  {i > 0 && <hr className="mb-2 border-amber-200/80" />}
                  <p className="mb-1 text-[11px] font-semibold text-amber-800/70">
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
                  <p className="whitespace-pre-wrap text-sm text-amber-950">
                    {entry.text}
                  </p>
                </div>
              ))}
            </div>
          ) : null}

          {!readOnly ? (
            <div>
              <Label htmlFor={`${idPrefix}-internal-note`}>
                {noteHistory && noteHistory.length > 0
                  ? "Add new note"
                  : "Note"}
              </Label>
              <Textarea
                id={`${idPrefix}-internal-note`}
                value={internalNote}
                onChange={(e) => onInternalNoteChange(e.target.value)}
                placeholder="Internal notes visible only to the team…"
                className="border-amber-200 bg-white focus-visible:ring-amber-400"
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {!hideCustomerSection ? (
        <>
          <div className="border-t border-slate-200" />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* ── Contact field with ghost-text autocomplete ── */}
            <div ref={contactWrapperRef} className="relative">
              <Label htmlFor={`${idPrefix}-customer-contact`}>
                Customer Contact<span className="ml-0.5 text-red-500">*</span>
              </Label>
              {(() => {
                const typed = customerContact;
                const ghost = contactSuggestions[0]
                  ? pickContactFromSuggestion(contactSuggestions[0], typed)
                  : "";
                const ghostSuffix =
                  ghost.toLowerCase().startsWith(typed.toLowerCase()) && typed.length > 0
                    ? ghost.slice(typed.length)
                    : "";
                return ghostSuffix ? (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute bottom-0 left-0 right-0 flex items-center overflow-hidden rounded-md border border-transparent px-3 text-sm"
                    style={{ top: "calc(1.5rem + 2px)", height: "2.5rem" }}
                  >
                    <span className="invisible whitespace-pre font-[inherit]">{typed}</span>
                    <span className="text-slate-300">{ghostSuffix}</span>
                  </div>
                ) : null;
              })()}
              {/* Type icon shown inside the input on the right */}
              {customerContact && !readOnly ? (
                <div className="pointer-events-none absolute right-2.5 flex items-center" style={{ top: "calc(1.5rem + 0.6rem)" }}>
                  {/^[+\d]/.test(customerContact.trim())
                    ? <Phone className="h-3.5 w-3.5 text-slate-300" />
                    : customerContact.includes("@")
                      ? <Mail className="h-3.5 w-3.5 text-slate-300" />
                      : null}
                </div>
              ) : null}
              <Input
                ref={contactInputRef}
                id={`${idPrefix}-customer-contact`}
                required
                readOnly={readOnly}
                value={customerContact}
                onChange={(e) => onCustomerContactChange(e.target.value)}
                onFocus={() => contactSuggestions.length > 0 && setShowContactDropdown(true)}
                onKeyDown={(e) => {
                  const ghost = contactSuggestions[0]
                    ? pickContactFromSuggestion(contactSuggestions[0], customerContact)
                    : "";
                  const ghostSuffix =
                    ghost.toLowerCase().startsWith(customerContact.toLowerCase()) && customerContact.length > 0
                      ? ghost.slice(customerContact.length)
                      : "";
                  if ((e.key === "Tab" || e.key === "ArrowRight") && ghostSuffix) {
                    e.preventDefault();
                    applyContactSuggestion(contactSuggestions[0]);
                  } else if (e.key === "Escape") {
                    setShowContactDropdown(false);
                    setContactSuggestions([]);
                  }
                }}
                placeholder="Email or phone"
                autoComplete="off"
                style={readOnly ? undefined : { background: "transparent" }}
                className={cn(readOnly ? "bg-slate-50" : undefined, customerContact && !readOnly ? "pr-8" : undefined)}
              />
              {customerLookupHint ? (
                <p className="mt-1 text-xs text-emerald-600">{customerLookupHint}</p>
              ) : null}
              {showContactDropdown && contactSuggestions.length > 1 ? (
                <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                  {contactSuggestions.map((s) => {
                    const contactToShow = pickContactFromSuggestion(s, customerContact);
                    const isPhone = contactToShow === s.phone;
                    return (
                      <li key={s.id}>
                        <button
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); applyContactSuggestion(s); }}
                          className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-slate-50"
                        >
                          {isPhone
                            ? <Phone className="h-4 w-4 shrink-0 text-slate-400" />
                            : <Mail className="h-4 w-4 shrink-0 text-slate-400" />}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-slate-800">{s.name}</p>
                            <p className="truncate text-xs text-slate-400">{contactToShow}</p>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>

            {/* ── Name field with ghost-text autocomplete ── */}
            <div ref={nameWrapperRef} className="relative">
              <Label htmlFor={`${idPrefix}-customer-name`}>
                Customer Name<span className="ml-0.5 text-red-500">*</span>
              </Label>
              {(() => {
                const typed = customerName;
                const ghost = nameSuggestions[0]?.name ?? "";
                const ghostSuffix =
                  ghost.toLowerCase().startsWith(typed.toLowerCase()) && typed.length > 0
                    ? ghost.slice(typed.length)
                    : "";
                return ghostSuffix ? (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute bottom-0 left-0 right-0 flex items-center overflow-hidden rounded-md border border-transparent px-3 text-sm"
                    style={{ top: "calc(1.5rem + 2px)", height: "2.5rem" }}
                  >
                    <span className="invisible whitespace-pre font-[inherit]">{typed}</span>
                    <span className="text-slate-300">{ghostSuffix}</span>
                  </div>
                ) : null;
              })()}
              <Input
                ref={nameInputRef}
                id={`${idPrefix}-customer-name`}
                required
                readOnly={readOnly}
                value={customerName}
                onChange={(e) => handleCustomerNameChange(e.target.value)}
                onFocus={() => nameSuggestions.length > 0 && setShowNameDropdown(true)}
                onKeyDown={(e) => {
                  const ghost = nameSuggestions[0]?.name ?? "";
                  const ghostSuffix =
                    ghost.toLowerCase().startsWith(customerName.toLowerCase()) && customerName.length > 0
                      ? ghost.slice(customerName.length)
                      : "";
                  if ((e.key === "Tab" || e.key === "ArrowRight") && ghostSuffix) {
                    e.preventDefault();
                    applyNameSuggestion(nameSuggestions[0]);
                  } else if (e.key === "Escape") {
                    setShowNameDropdown(false);
                    setNameSuggestions([]);
                  }
                }}
                autoComplete="off"
                style={readOnly ? undefined : { background: "transparent" }}
                className={readOnly ? "bg-slate-50" : undefined}
              />
              {showNameDropdown && nameSuggestions.length > 1 ? (
                <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                  {nameSuggestions.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); applyNameSuggestion(s); }}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-slate-50"
                      >
                        <User className="h-4 w-4 shrink-0 text-slate-400" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-800">{s.name}</p>
                          {(s.email ?? s.phone) ? (
                            <p className="truncate text-xs text-slate-400">{s.email ?? s.phone}</p>
                          ) : null}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
