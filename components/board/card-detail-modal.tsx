"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Copy,
  Loader2,
  Trash2,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ApprovalTab } from "./approval-tab";
import { MissingInfoTab } from "./missing-info-tab";
import { ButtonAutomationBar } from "./button-automation-bar";
import { FastActionButtonBar } from "./fast-action-button-bar";
import { OrderFormBody, type OrderOwner } from "./order-form-body";
import { mergeSkusWithAssets, normalizeSkus, prepareSkusForSave, validateSkus, type SkuItem } from "./sku-editor";
import {
  deleteAssetsById,
  uploadPendingSkuArtwork,
} from "@/lib/sku-assets";
import { PRIORITY_STYLES } from "@/lib/constants";
import { describeActivity, type ActivityLogEntry } from "@/lib/activity";
import { customerContactFromOrder } from "@/lib/notification-messages";
import { groupSkuImagesBySkuId } from "@/lib/sku-images";
import {
  buildCustomFieldPayload,
  resolveOrderFormFields,
  validateDueDate,
  validateOrderFormFields,
} from "@/lib/order-form";
import { getMissingFields } from "@/lib/orders/validate-ready-to-move";
import { cn, dateInputValue, formatDateTime } from "@/lib/utils";
import { ORDER_TAG_STYLES, orderTagsFromSpecs } from "@/lib/order-tags";
import type {
  Approval,
  ApprovalNote,
  Asset,
  BoardColumn,
  Category,
  CustomField,
  CustomFieldValue,
  Designer,
  FastActionButton,
  MissingInfoNote,
  OrderSkuImageWithUrl,
  OrderWithRelations,
  ButtonAutomation,
  Role,
} from "@/lib/types";

interface CardDetailModalProps {
  orderId: string | null;
  open: boolean;
  onClose: () => void;
  customFields: CustomField[];
  owners: OrderOwner[];
  columns: BoardColumn[];
  designers: Designer[];
  role: Role;
  userId?: string;
  onChanged: () => void;
  /** When "view", all fields are read-only and save/upload actions are hidden. */
  mode?: "edit" | "view";
  onLinkCopied?: (message: string) => void;
  buttonAutomations?: ButtonAutomation[];
  fastActionButtons?: FastActionButton[];
  appUrl?: string;
  categories?: Category[];
}

function addToSet(prev: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(prev);
  next.add(id);
  return next;
}

function removeFromSet(prev: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(prev);
  next.delete(id);
  return next;
}

interface DetailResponse {
  order: OrderWithRelations;
  assets: Asset[];
  skuImages: OrderSkuImageWithUrl[];
  values: CustomFieldValue[];
  customFields?: CustomField[];
  activity: ActivityLogEntry[];
  approvals: Approval[];
  missingInfo: MissingInfoNote[];
  approvalNotes: ApprovalNote[];
}

export function CardDetailModal({
  orderId,
  open,
  onClose,
  customFields,
  owners,
  columns,
  designers,
  role,
  userId,
  onChanged,
  mode = "edit",
  onLinkCopied,
  buttonAutomations = [],
  fastActionButtons = [],
  appUrl = "",
  categories = [],
}: CardDetailModalProps) {
  const isViewOnly = mode === "view";
  const [modalCustomFields, setModalCustomFields] =
    useState<CustomField[]>(customFields);
  const resolved = useMemo(
    () => resolveOrderFormFields(modalCustomFields),
    [modalCustomFields]
  );
  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("normal");
  const [ownerId, setOwnerId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerContact, setCustomerContact] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({});
  const [skus, setSkus] = useState<SkuItem[]>([]);
  const [designerId, setDesignerId] = useState("");
  const [designTask, setDesignTask] = useState("");
  const [tab, setTab] = useState<"details" | "missing-info" | "approval">(
    "details"
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingSkuArtwork, setPendingSkuArtwork] = useState<
    Record<string, File>
  >({});
  const [removedSkuArtworkIds, setRemovedSkuArtworkIds] = useState<
    Set<string>
  >(new Set());
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [orderNumberCopied, setOrderNumberCopied] = useState(false);
  const [persistedSkuIds, setPersistedSkuIds] = useState<Set<string>>(
    () => new Set()
  );
  const isAdmin = role === "admin";

  function resetPendingFiles() {
    setPendingSkuArtwork({});
    setRemovedSkuArtworkIds(new Set());
  }

  const hasPendingFileChanges =
    Object.keys(pendingSkuArtwork).length > 0 ||
    removedSkuArtworkIds.size > 0;

  const customFieldsRef = useRef(customFields);
  customFieldsRef.current = customFields;

  const applyDetail = useCallback((json: DetailResponse) => {
    const fields = json.customFields ?? customFieldsRef.current;
    setModalCustomFields(fields);
    const validFieldIds = new Set(fields.map((f) => f.id));
    const formFields = resolveOrderFormFields(fields);
    setData(json);
    setTitle(json.order.title);
    setDescription(json.order.description ?? "");
    setPriority(json.order.priority);
    setOwnerId(json.order.created_by ?? "");
    setDueDate(dateInputValue(json.order.due_date));
    setCategoryId(json.order.category_id ?? "");
    setSkus(
      mergeSkusWithAssets(normalizeSkus(json.order.specs?.skus), json.assets)
    );
    setDesignerId((json.order.specs?.designer_id as string) ?? "");
    setDesignTask((json.order.specs?.design_task as string) ?? "");
    const map: Record<string, unknown> = {};
    for (const v of json.values) {
      if (validFieldIds.has(v.custom_field_id)) {
        map[v.custom_field_id] = v.value;
      }
    }

    let name = "";
    let contact = "";
    if (formFields.customerNameField) {
      name = String(map[formFields.customerNameField.id] ?? "").trim();
    }
    if (formFields.customerContactField) {
      contact = String(map[formFields.customerContactField.id] ?? "").trim();
    }
    if (json.order.customer) {
      if (!name) name = json.order.customer.name;
      if (!contact) {
        contact =
          json.order.customer.email ?? json.order.customer.phone ?? "";
      }
    }
    setCustomerName(name);
    setCustomerContact(contact);
    setFieldValues(map);
    setPersistedSkuIds(
      new Set(normalizeSkus(json.order.specs?.skus).map((s) => s.id))
    );
  }, []);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!orderId) return;
    if (!options?.silent) setLoading(true);
    try {
      const res = await fetch(`/api/orders/${orderId}`);
      const json: DetailResponse = await res.json();
      if (!res.ok) return;
      applyDetail(json);
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, [orderId, applyDetail]);

  useEffect(() => {
    if (open && orderId) {
      setActivityOpen(false);
      resetPendingFiles();
      setModalCustomFields(customFieldsRef.current);
      load();
    }
    if (!open) {
      setData(null);
      setTab("details");
      setActivityOpen(false);
      resetPendingFiles();
      setPersistedSkuIds(new Set());
    }
  }, [open, orderId, load]);

  async function save() {
    if (!orderId) return;

    if (!title.trim()) {
      setSaveError("Order Number is required");
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
      setSaveError(validationError);
      return;
    }

    const dueDateError = validateDueDate(dueDate, data?.order.due_date);
    if (dueDateError) {
      setSaveError(dueDateError);
      return;
    }

    if (ownerId && !owners.some((o) => o.id === ownerId)) {
      setSaveError("Owner must be an account manager");
      return;
    }

    const skuError = validateSkus(skus, Object.keys(pendingSkuArtwork));
    if (skuError) {
      setSaveError(skuError);
      return;
    }

    setSaveError(null);
    setSaving(true);
    const res = await fetch(`/api/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        description,
        priority,
        ownerId: ownerId || null,
        dueDate: dateInputValue(dueDate) || null,
        categoryId: categoryId || null,
        specs: {
          ...(data?.order.specs ?? {}),
          skus: prepareSkusForSave(skus, {
            pendingArtworkIds: Object.keys(pendingSkuArtwork),
          }),
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
      }),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      setSaveError(json.error ?? "Failed to save order");
      setSaving(false);
      return;
    }

    const skuKeysWithPendingUpload = new Set(Object.keys(pendingSkuArtwork));
    const skuAssetIdsToDelete = [...removedSkuArtworkIds].filter((assetId) => {
      const asset = data?.assets.find((a) => a.id === assetId);
      return !(
        asset?.sku_key && skuKeysWithPendingUpload.has(asset.sku_key)
      );
    });
    if (skuAssetIdsToDelete.length > 0) {
      await deleteAssetsById(skuAssetIdsToDelete);
    }
    if (Object.keys(pendingSkuArtwork).length > 0) {
      await uploadPendingSkuArtwork(orderId, pendingSkuArtwork);
    }

    setSaving(false);
    resetPendingFiles();
    onChanged();
    onClose();
  }

  async function removeOrder() {
    if (!orderId) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}`, { method: "DELETE" });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setRemoveError(json.error ?? "Failed to remove order");
        return;
      }
      setConfirmRemove(false);
      onChanged();
      onClose();
    } finally {
      setRemoving(false);
    }
  }

  function setFieldValue(fieldId: string, value: unknown) {
    setFieldValues((prev) => ({ ...prev, [fieldId]: value }));
  }

  function markSkuArtworkForRemoval(assetId: string) {
    setRemovedSkuArtworkIds((prev) => addToSet(prev, assetId));
  }

  function unmarkSkuArtworkForRemoval(assetId: string) {
    setRemovedSkuArtworkIds((prev) => removeFromSet(prev, assetId));
  }

  const ensureSkuPersisted = useCallback(
    async (skuId: string): Promise<string | null> => {
      if (!orderId || persistedSkuIds.has(skuId)) return null;

      const sku = skus.find((s) => s.id === skuId);
      if (!sku) return "SKU not found.";
      if (!sku.name.trim()) {
        return "Enter SKU name before uploading images.";
      }
      if (
        sku.qty == null ||
        typeof sku.qty !== "number" ||
        Number.isNaN(sku.qty) ||
        sku.qty < 1
      ) {
        return "Enter SKU quantity before uploading images.";
      }

      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          specs: {
            ...(data?.order.specs ?? {}),
            skus: prepareSkusForSave(skus, {
              pendingArtworkIds: Object.keys(pendingSkuArtwork),
            }),
          },
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        return json.error ?? "Failed to save SKU";
      }

      const savedSkus = prepareSkusForSave(skus, {
        pendingArtworkIds: Object.keys(pendingSkuArtwork),
      });
      setPersistedSkuIds((prev) => new Set([...prev, skuId]));
      setData((prev) =>
        prev
          ? {
              ...prev,
              order: {
                ...prev.order,
                specs: { ...prev.order.specs, skus: savedSkus },
              },
            }
          : prev
      );
      return null;
    },
    [orderId, persistedSkuIds, skus, data?.order.specs, pendingSkuArtwork]
  );

  const skuImagesBySkuId = useMemo(
    () => groupSkuImagesBySkuId(data?.skuImages ?? []),
    [data?.skuImages]
  );

  const ownersForForm = useMemo(() => {
    if (!ownerId || owners.some((o) => o.id === ownerId)) return owners;
    return [
      ...owners,
      { id: ownerId, name: "Previous owner (not account manager)" },
    ];
  }, [owners, ownerId]);

  const pendingApproval = data?.approvals.find((a) => a.status === "pending");
  const orderColumn = data
    ? columns.find((c) => c.id === data.order.column_id)
    : undefined;
  const isInExceptionColumn = orderColumn?.kind === "exception";
  const hasMissingInfoNotes = (data?.missingInfo.length ?? 0) > 0;
  const showMissingInfoTab = hasMissingInfoNotes || Boolean(isInExceptionColumn);
  const missingFieldsOnOrder =
    data && !isViewOnly
      ? getMissingFields(data.order, fieldValues, modalCustomFields)
      : [];
  const hasApproval = (data?.approvalNotes.length ?? 0) > 0;
  const hasExtraTabs = !isViewOnly && (showMissingInfoTab || hasApproval);
  const orderContact = data
    ? customerContactFromOrder(data.order, fieldValues, modalCustomFields)
    : { email: null, phone: null };
  const orderTags = data ? orderTagsFromSpecs(data.order.specs) : [];

  function handleClose() {
    if (
      hasPendingFileChanges &&
      !window.confirm(
        "You have unsaved file changes. Close without saving?"
      )
    ) {
      return;
    }
    onClose();
  }

  const displayOrderNumber = (data?.order.title ?? title).trim();

  async function copyOrderNumber() {
    if (!displayOrderNumber) return;
    try {
      await navigator.clipboard.writeText(displayOrderNumber);
      setOrderNumberCopied(true);
      setTimeout(() => setOrderNumberCopied(false), 1500);
    } catch {
      // ignore clipboard failures
    }
  }

  const modalTitle = (
    <span className="flex min-w-0 items-center gap-2">
      <span className="truncate">
        {isViewOnly ? "View order" : "Order Details"}
        {displayOrderNumber ? `: ${displayOrderNumber}` : loading ? ": …" : ""}
      </span>
      {displayOrderNumber ? (
        <button
          type="button"
          onClick={copyOrderNumber}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-normal transition-colors",
            orderNumberCopied
              ? "text-emerald-600"
              : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          )}
          title="Copy order number"
          aria-label="Copy order number"
        >
          {orderNumberCopied ? (
            "Copied"
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden />
          )}
        </button>
      ) : null}
    </span>
  );

  return (
    <>
    <Modal
      open={open}
      onClose={handleClose}
      title={modalTitle}
      className="max-w-3xl"
      headerAction={
        !isViewOnly && isAdmin ? (
          <button
            type="button"
            onClick={() => {
              setRemoveError(null);
              setConfirmRemove(true);
            }}
            disabled={loading || saving || removing}
            className="flex items-center gap-2 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
            title="Remove order"
          >
            <Trash2 className="h-4 w-4" />
            Remove order
          </button>
        ) : undefined
      }
      footer={
        isViewOnly ? (
          <Button variant="ghost" onClick={handleClose} type="button">
            Close
          </Button>
        ) : tab === "details" ? (
          <>
            {hasPendingFileChanges ? (
              <span className="mr-auto text-xs text-amber-600">
                Unsaved file changes
              </span>
            ) : null}
            <Button variant="ghost" onClick={handleClose} type="button">
              Close
            </Button>
            <Button onClick={save} disabled={saving || loading || removing}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={handleClose} type="button">
            Close
          </Button>
        )
      }
    >
      {loading || !data ? (
        <div className="flex h-40 items-center justify-center text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <>
          {hasExtraTabs ? (
            <div className="mb-4 flex gap-1 border-b border-slate-200">
              <button
                type="button"
                onClick={() => setTab("details")}
                className={cn(
                  "border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  tab === "details"
                    ? "border-[var(--primary)] text-[var(--primary)]"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                )}
              >
                Order Details
              </button>
              {showMissingInfoTab ? (
                <button
                  type="button"
                  onClick={() => setTab("missing-info")}
                  className={cn(
                    "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                    tab === "missing-info"
                      ? "border-[var(--primary)] text-[var(--primary)]"
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  )}
                >
                  Missing Info
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      hasMissingInfoNotes ? "bg-amber-500" : "bg-slate-300"
                    )}
                  />
                </button>
              ) : null}
              {hasApproval ? (
                <button
                  type="button"
                  onClick={() => setTab("approval")}
                  className={cn(
                    "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                    tab === "approval"
                      ? "border-[var(--primary)] text-[var(--primary)]"
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  )}
                >
                  Approval
                  <span className="h-2 w-2 rounded-full bg-violet-500" />
                </button>
              ) : null}
            </div>
          ) : null}

          {tab === "details" && data ? (
            <ButtonAutomationBar
              buttons={buttonAutomations}
              columnId={data.order.column_id}
              orderId={data.order.id}
              orderNumber={data.order.title}
              appUrl={appUrl}
              onComplete={({ message, refreshOrder }) => {
                setSaveError(null);
                onLinkCopied?.(message);
                if (refreshOrder) {
                  void load({ silent: true });
                  onChanged();
                }
              }}
              onError={(msg) => setSaveError(msg)}
            />
          ) : null}

          {tab === "missing-info" && showMissingInfoTab ? (
            <MissingInfoTab
              notes={data.missingInfo}
              customer={data.order.customer}
              orderId={data.order.id}
              sourceColumnId={data.order.column_id}
              columns={columns}
              columnName={orderColumn?.name}
              missingFields={missingFieldsOnOrder}
              contactEmail={orderContact.email}
              contactPhone={orderContact.phone}
              role={role}
              onSent={() => {
                load();
                onChanged();
              }}
            />
          ) : tab === "approval" && hasApproval ? (
            <ApprovalTab
              notes={data.approvalNotes}
              customer={data.order.customer}
              orderId={data.order.id}
              sourceColumnId={data.order.column_id}
              columns={columns}
              contactEmail={orderContact.email}
              contactPhone={orderContact.phone}
              onChanged={() => {
                load();
                onChanged();
              }}
            />
          ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="space-y-4 md:col-span-2 pt-2">
            <OrderFormBody
              idPrefix="edit"
              customFields={modalCustomFields}
              owners={ownersForForm}
              designers={designers}
              title={title}
              onTitleChange={setTitle}
              hideOrderNumberField
              priority={priority}
              onPriorityChange={setPriority}
              ownerId={ownerId}
              onOwnerIdChange={setOwnerId}
              description={description}
              onDescriptionChange={setDescription}
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
              onDueDateChange={(value) => {
                setDueDate(value);
                setSaveError(null);
              }}
              previousDueDate={data.order.due_date}
              orderId={orderId ?? undefined}
              skuAssets={data.assets}
              skuImagesBySkuId={skuImagesBySkuId}
              deferSkuArtworkUpload
              pendingSkuArtwork={pendingSkuArtwork}
              onPendingSkuArtworkChange={setPendingSkuArtwork}
              removedSkuArtworkIds={removedSkuArtworkIds}
              onMarkSkuArtworkForRemoval={markSkuArtworkForRemoval}
              onUnmarkSkuArtworkForRemoval={unmarkSkuArtworkForRemoval}
              ensureSkuPersisted={ensureSkuPersisted}
              readOnly={isViewOnly}
              categories={categories}
              categoryId={categoryId}
              onCategoryIdChange={isViewOnly ? undefined : setCategoryId}
            />

            {saveError ? (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
                {saveError}
              </p>
            ) : null}
          </div>

          <div className="space-y-4">
            {categories.length > 0 ? (
              <div className="rounded-lg border border-slate-200 p-3 mt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Category
                </p>
                <select
                  value={categoryId}
                  disabled={isViewOnly}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300 disabled:opacity-60"
                >
                  <option value="">— None —</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {orderTags.length > 0 ? (
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="mb-2 text-sm font-semibold text-slate-700">Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {orderTags.map((tag) => (
                    <span
                      key={tag}
                      className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                        ORDER_TAG_STYLES[tag] ??
                          "border-slate-200 bg-slate-100 text-slate-600"
                      )}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="mb-2 text-sm font-semibold text-slate-700">
                Approval
              </p>
              {data.approvals.length === 0 ? (
                <p className="text-sm text-slate-400">
                  Move this job to Customer Approval to request sign-off.
                </p>
              ) : (
                <div className="space-y-2">
                  {data.approvals.map((a) => (
                    <div key={a.id} className="text-sm">
                      <Badge
                        className={cn(
                          a.status === "approved" &&
                            "bg-emerald-100 text-emerald-700",
                          a.status === "rejected" && "bg-red-100 text-red-700",
                          a.status === "pending" &&
                            "bg-amber-100 text-amber-700"
                        )}
                      >
                        {a.status}
                      </Badge>
                      {a.comment ? (
                        <p className="mt-1 text-slate-500">“{a.comment}”</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
              {pendingApproval ? (
                <a
                  href={`/approve/${pendingApproval.token}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 block break-all text-xs text-[var(--primary)] hover:underline"
                >
                  Open approval link
                </a>
              ) : null}
            </div>

            {data ? (
              <FastActionButtonBar
                buttons={fastActionButtons}
                currentColumnId={data.order.column_id}
                orderId={data.order.id}
                role={role}
                userId={userId}
                onSuccess={(destinationName) => {
                  onLinkCopied?.(`Moved to ${destinationName}`);
                  void load({ silent: true });
                  onChanged();
                }}
                onError={(msg) => setSaveError(msg)}
              />
            ) : null}

            <div className="rounded-lg border border-slate-200">
              <button
                type="button"
                onClick={() => setActivityOpen((o) => !o)}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
                aria-expanded={activityOpen}
              >
                {activityOpen ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                )}
                <Activity className="h-4 w-4 shrink-0" />
                <span>Activity</span>
                {!activityOpen && data.activity.length > 0 ? (
                  <span className="ml-auto text-xs font-normal text-slate-400">
                    {data.activity.length}{" "}
                    {data.activity.length === 1 ? "entry" : "entries"}
                  </span>
                ) : null}
              </button>
              {activityOpen ? (
                <ul className="space-y-2 border-t border-slate-100 px-3 py-2">
                  {data.activity.map((log) => (
                    <li key={log.id} className="text-xs text-slate-500">
                      <span className="font-medium text-slate-700">
                        {describeActivity(log)}
                      </span>
                      <span className="block text-slate-400">
                        {formatDateTime(log.created_at)}
                        {log.actor_name ? ` · ${log.actor_name}` : ""}
                      </span>
                    </li>
                  ))}
                  {data.activity.length === 0 ? (
                    <li className="text-xs text-slate-400">No activity yet.</li>
                  ) : null}
                </ul>
              ) : null}
            </div>
          </div>
        </div>
          )}
        </>
      )}
    </Modal>

    {confirmRemove ? (
      <Modal
        open
        onClose={() => {
          if (!removing) setConfirmRemove(false);
        }}
        title="Remove order"
        footer={
          <>
            <Button
              variant="ghost"
              type="button"
              onClick={() => setConfirmRemove(false)}
              disabled={removing}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={removeOrder}
              disabled={removing}
            >
              {removing ? "Removing…" : "Remove order"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          Remove <strong>{title || data?.order.title}</strong> from the board?
          Other employees will no longer see this order. You can restore it from
          Settings → Removed Orders.
        </p>
        {removeError ? (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
            {removeError}
          </p>
        ) : null}
      </Modal>
    ) : null}
  </>
  );
}
