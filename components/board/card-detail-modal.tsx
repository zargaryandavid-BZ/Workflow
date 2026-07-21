"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Copy,
  Loader2,
  MessageSquare,
  Trash2,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ApprovalTab } from "./approval-tab";
import { MissingInfoTab } from "./missing-info-tab";
import { ShippingTab } from "./shipping-tab";
import { ButtonAutomationBar } from "./button-automation-bar";
import { FastActionButtonBar } from "./fast-action-button-bar";
import { OrderFormBody, type OrderOwner } from "./order-form-body";
import { normalizeSkus, prepareSkusForSave, validateSkus, type SkuItem } from "./sku-editor";
import { PRIORITY_OPTIONS, PRIORITY_STYLES } from "@/lib/constants";
import { Input, Label, Select } from "@/components/ui/input";
import { describeActivity, type ActivityLogEntry } from "@/lib/activity";
import { customerContactFromOrder, productFromOrder } from "@/lib/notification-messages";
import { groupSkuImagesBySkuId } from "@/lib/sku-images";
import {
  buildCustomFieldPayload,
  resolveOrderFormFields,
  validateDueDate,
  validateOrderFormFields,
} from "@/lib/order-form";
import { getMissingFields } from "@/lib/orders/validate-ready-to-move";
import { cn, dateInputValue, daysAgo, formatDate, formatDateTime, localDateInputValue } from "@/lib/utils";
import { ORDER_TAG_STYLES, orderTagsFromSpecs } from "@/lib/order-tags";
import { type NotifyColumnConfig } from "@/lib/board-notify";
import type { WebhookSourceStyles } from "@/lib/webhook-source-styles";
import { WebhookSourceLabel } from "./webhook-source-label";
import { sharedOrderTitle } from "@/lib/group-orders";
import type {
  Approval,
  ApprovalNote,
  Asset,
  BoardColumn,
  Tag,
  CustomField,
  CustomFieldValue,
  Designer,
  FastActionButton,
  MissingInfoNote,
  NoteEntry,
  OrderNote,
  OrderSkuImageWithUrl,
  OrderWithRelations,
  ButtonAutomation,
  Role,
  ShippingRequest,
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
  currentUserName?: string;
  onChanged: (patch?: Partial<OrderWithRelations>) => void;
  /** When "view", all fields are read-only and save/upload actions are hidden. */
  mode?: "edit" | "view";
  onLinkCopied?: (message: string) => void;
  buttonAutomations?: ButtonAutomation[];
  fastActionButtons?: FastActionButton[];
  appUrl?: string;
  tags?: Tag[];
  /** Total number of items in the same order group (e.g. 3 for "160-2 (3)"). */
  groupSize?: number;
  /** How many of the group are in the same column as this order. */
  groupSameColumnCount?: number;
  /** Name of the column this order is currently in (for the SMS confirmation dialog). */
  groupColumnName?: string;
  /** Columns that trigger a notification popup when a card enters them. */
  notifyColumns?: NotifyColumnConfig[];
  webhookSourceStyles?: WebhookSourceStyles;
  /** Called when a Fast Action Button moves to a column that has an active automation. */
  onNotifyColumn?: (
    order: OrderWithRelations,
    notifyColumn: NotifyColumnConfig,
    columnName: string
  ) => void;
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
  notes: OrderNote[];
  shippingRequest?: ShippingRequest | null;
}

type ActivityChangeEntry = { field?: unknown; from?: unknown; to?: unknown };

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
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
  currentUserName = "Unknown",
  onChanged,
  mode = "edit",
  onLinkCopied,
  buttonAutomations = [],
  fastActionButtons = [],
  appUrl = "",
  tags = [],
  notifyColumns = [],
  webhookSourceStyles,
  onNotifyColumn,
  groupSize,
  groupSameColumnCount,
  groupColumnName,
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
  const [activityFilter, setActivityFilter] = useState<"all" | "moves">("all");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [noteHistory, setNoteHistory] = useState<NoteEntry[]>([]);
  const [newNote, setNewNote] = useState("");
  const [priority, setPriority] = useState("normal");
  const [ownerId, setOwnerId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [tagId, setTagId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerContact, setCustomerContact] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({});
  const [skus, setSkus] = useState<SkuItem[]>([]);
  const [designerId, setDesignerId] = useState("");
  const [designTask, setDesignTask] = useState("");
  const [tab, setTab] = useState<"details" | "missing-info" | "approval" | "shipping">(
    "details"
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [orderNumberCopied, setOrderNumberCopied] = useState(false);
  const [persistedSkuIds, setPersistedSkuIds] = useState<Set<string>>(
    () => new Set()
  );
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const [copiedCustomerField, setCopiedCustomerField] = useState<string | null>(null);
  const customerDropdownRef = useRef<HTMLDivElement>(null);
  const [smsOpen, setSmsOpen] = useState(false);
  const [smsPhone, setSmsPhone] = useState("");
  const [smsBody, setSmsBody] = useState("");
  const [smsSending, setSmsSending] = useState(false);
  const [smsError, setSmsError] = useState<string | null>(null);
  const smsRef = useRef<HTMLDivElement>(null);
  const isAdmin = role === "admin";

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
    const rawNote = json.order.internal_note ?? "";
    let parsedHistory: NoteEntry[] = [];
    if (rawNote) {
      try {
        const parsed = JSON.parse(rawNote);
        if (Array.isArray(parsed)) {
          parsedHistory = parsed as NoteEntry[];
        } else {
          parsedHistory = [{ author: "Unknown", date: new Date().toISOString(), text: rawNote }];
        }
      } catch {
        parsedHistory = [{ author: "Unknown", date: new Date().toISOString(), text: rawNote }];
      }
    }
    setNoteHistory(parsedHistory);
    setNewNote("");
    setPriority(json.order.priority);
    setOwnerId(json.order.created_by ?? "");
    setDueDate(dateInputValue(json.order.due_date));
    setTagId(json.order.tag_id ?? "");
    setSkus(normalizeSkus(json.order.specs?.skus));
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
      setSaveError(null);
      setActivityOpen(false);
      setModalCustomFields(customFieldsRef.current);
      load();
    }
    if (!open) {
      setSaveError(null);
      setData(null);
      setTitle("");
      setCustomerName("");
      setPriority("normal");
      setTab("details");
      setActivityOpen(false);
      setPersistedSkuIds(new Set());
    }
  }, [open, orderId, load]);

  async function save(options?: { reload?: boolean }): Promise<boolean> {
    if (!orderId) return false;

    if (!title.trim()) {
      setSaveError("Order Number is required");
      return false;
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
      return false;
    }

    const dueDateError = validateDueDate(dueDate, data?.order.due_date);
    if (dueDateError) {
      setSaveError(dueDateError);
      return false;
    }

    if (ownerId && !owners.some((o) => o.id === ownerId)) {
      setSaveError("Owner must be an account manager");
      return false;
    }

    const skuError = validateSkus(skus, []);
    if (skuError) {
      setSaveError(skuError);
      return false;
    }

    setSaveError(null);
    setSaving(true);
    const updatedHistory =
      newNote.trim()
        ? [
            ...noteHistory,
            {
              author: currentUserName,
              date: new Date().toISOString(),
              text: newNote.trim(),
            },
          ]
        : noteHistory;
    const internalNoteJson =
      updatedHistory.length > 0 ? JSON.stringify(updatedHistory) : null;
    const savedSkus = prepareSkusForSave(skus, { pendingArtworkIds: [] });
    const nextSpecs = {
      ...(data?.order.specs ?? {}),
      skus: savedSkus,
      designer_id: designerId || null,
      designer_name:
        designers.find((d) => d.id === designerId)?.name ?? null,
      design_task: designTask || null,
    };
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          internal_note: internalNoteJson,
          priority,
          ownerId: ownerId || null,
          dueDate: dateInputValue(dueDate) || null,
          tagId: tagId || null,
          specs: nextSpecs,
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
        return false;
      }

      setNoteHistory(updatedHistory);
      setNewNote("");
      const selectedTag = tagId
        ? (tags.find((t) => t.id === tagId) ?? null)
        : null;
      onChanged({
        tag_id: tagId || null,
        tag: selectedTag,
        title: title.trim(),
        description: description || null,
        priority: priority as "low" | "normal" | "high" | "urgent",
        due_date: dateInputValue(dueDate) || null,
        created_by: ownerId || null,
        specs: nextSpecs,
      });
      if (options?.reload !== false) {
        void load({ silent: true });
      }
      return true;
    } finally {
      setSaving(false);
    }
  }

  function isDirty(): boolean {
    if (!data) return false;
    const order = data.order;
    if (title !== order.title) return true;
    if ((description || "") !== (order.description ?? "")) return true;
    if (newNote.trim()) return true;
    if (priority !== order.priority) return true;
    if ((ownerId || "") !== (order.created_by ?? "")) return true;
    if (dateInputValue(dueDate) !== dateInputValue(order.due_date)) return true;
    if ((tagId || "") !== (order.tag_id ?? "")) return true;
    if ((designerId || "") !== String(order.specs?.designer_id ?? "")) return true;
    if ((designTask || "") !== String(order.specs?.design_task ?? "")) return true;

    const savedSkus = prepareSkusForSave(
      normalizeSkus(order.specs?.skus),
      { pendingArtworkIds: [] }
    );
    const currentSkus = prepareSkusForSave(skus, { pendingArtworkIds: [] });
    if (JSON.stringify(currentSkus) !== JSON.stringify(savedSkus)) return true;

    const formFields = resolved;
    const savedValues: Record<string, unknown> = {};
    for (const v of data.values) {
      savedValues[v.custom_field_id] = v.value;
    }
    if (formFields.customerNameField) {
      const id = formFields.customerNameField.id;
      const savedName = String(savedValues[id] ?? order.customer?.name ?? "").trim();
      if (customerName.trim() !== savedName) return true;
    }
    if (formFields.customerContactField) {
      const id = formFields.customerContactField.id;
      const savedContact = String(
        savedValues[id] ??
          order.customer?.email ??
          order.customer?.phone ??
          ""
      ).trim();
      if (customerContact.trim() !== savedContact) return true;
    }
    for (const field of [
      ...formFields.printFields,
      ...(formFields.orderQtyField ? [formFields.orderQtyField] : []),
    ]) {
      const current = fieldValues[field.id];
      const saved = savedValues[field.id];
      if (JSON.stringify(current ?? null) !== JSON.stringify(saved ?? null)) {
        return true;
      }
    }
    return false;
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
            skus: prepareSkusForSave(skus, { pendingArtworkIds: [] }),
          },
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        return json.error ?? "Failed to save SKU";
      }

      const savedSkus = prepareSkusForSave(skus, { pendingArtworkIds: [] });
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
    [orderId, persistedSkuIds, skus, data?.order.specs]
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
  const hasShipping = Boolean(data?.shippingRequest);
  const hasExtraTabs =
    !isViewOnly && (showMissingInfoTab || hasApproval || hasShipping);
  const orderContact = data
    ? customerContactFromOrder(data.order, fieldValues, modalCustomFields)
    : { email: null, phone: null };
  const orderTags = data ? orderTagsFromSpecs(data.order.specs) : [];
  const descriptionVersions = useMemo(() => {
    if (!data) return [];

    const versions: Array<{
      id: string;
      text: string;
      actorName: string | null;
      createdAt: string;
    }> = [];

    for (const log of data.activity) {
      if (log.action !== "updated") continue;
      const rawChanges = (log.metadata?.changes ?? []) as ActivityChangeEntry[];
      const change = rawChanges.find((entry) => entry.field === "Description updated");
      if (!change || change.to == null) continue;

      versions.push({
        id: log.id,
        text: typeof change.to === "string" ? change.to : String(change.to),
        actorName: log.actor_name,
        createdAt: log.created_at,
      });
    }

    if (versions.length === 0 && (data.order.description ?? "").trim()) {
      versions.push({
        id: "current-description",
        text: data.order.description ?? "",
        actorName: null,
        createdAt: data.order.updated_at,
      });
    }

    return versions;
  }, [data]);

  async function handleClose() {
    if (saving || removing) return;
    if (isViewOnly || !data || !orderId) {
      onClose();
      return;
    }
    if (!isDirty()) {
      onClose();
      return;
    }
    const ok = await save({ reload: false });
    if (ok) {
      onClose();
      return;
    }
    setTab("details");
  }

  const displayOrderNumber = title.trim() || (data?.order.title ?? "").trim();

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

  async function copyCustomerField(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCustomerField(key);
      setTimeout(() => setCopiedCustomerField(null), 1500);
    } catch {
      // ignore clipboard failures
    }
  }

  useEffect(() => {
    if (!customerDropdownOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (customerDropdownRef.current && !customerDropdownRef.current.contains(e.target as Node)) {
        setCustomerDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [customerDropdownOpen]);

  useEffect(() => {
    if (!smsOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (smsRef.current && !smsRef.current.contains(e.target as Node)) {
        setSmsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [smsOpen]);

  async function sendQuickSms() {
    setSmsSending(true);
    setSmsError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/actions/quick-sms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: smsPhone, body: smsBody }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSmsError((json as { error?: string }).error ?? "Failed to send SMS");
        return;
      }
      setSmsOpen(false);
      setSmsBody("");
      void load({ silent: true });
    } catch {
      setSmsError("Failed to send SMS");
    } finally {
      setSmsSending(false);
    }
  }

  const ownerName = ownerId ? (owners.find((o) => o.id === ownerId)?.name ?? null) : null;

  const modalTitle = (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {/* Order number + copy */}
      <span className="flex shrink-0 items-center gap-1 font-semibold text-slate-800">
        {displayOrderNumber
          ? <>
              {displayOrderNumber.replace(/^ORD-\d{4}-/, "").replace(/^0+(\d)/, "$1")}
              {groupSize != null && groupSize >= 2 && (
                <span className="font-normal text-slate-400"> ({groupSize})</span>
              )}
            </>
          : loading ? "…" : "Order Details"}
        {displayOrderNumber ? (
          <button
            type="button"
            onClick={copyOrderNumber}
            className={cn(
              "inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs font-normal transition-colors",
              orderNumberCopied
                ? "text-emerald-600"
                : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            )}
            title="Copy order number"
            aria-label="Copy order number"
          >
            {orderNumberCopied ? "Copied" : <Copy className="h-3 w-3" aria-hidden />}
          </button>
        ) : null}
      </span>
      {/* Creation date — non-editable */}
      {data?.order.created_at ? (
        <>
          <span className="text-slate-300">|</span>
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-slate-400">
            <CalendarClock className="h-3 w-3" aria-hidden />
            {formatDate(data.order.created_at)}
            <span className="text-slate-300">·</span>
            {daysAgo(data.order.created_at)}
          </span>
        </>
      ) : null}
      {/* Customer name — dropdown with copy */}
      {customerName ? (
        <>
          <span className="text-slate-300">|</span>
          <div className="relative flex flex-col items-start" ref={customerDropdownRef}>
            <WebhookSourceLabel
              webhookSource={data?.order.webhook_source}
              sourceStyles={webhookSourceStyles}
              orderTitle={data?.order ? sharedOrderTitle(data.order) : null}
              className="mb-0 flex min-w-0 max-w-[14rem] items-baseline gap-1 text-[10px] font-semibold leading-tight tracking-wide"
            />
            <button
              type="button"
              onClick={() => setCustomerDropdownOpen((v) => !v)}
              className="flex items-center gap-1 rounded px-1 py-0.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-800"
            >
              <span className="truncate">{customerName}</span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform",
                  customerDropdownOpen && "rotate-180"
                )}
              />
            </button>
            {customerDropdownOpen ? (
              <div className="absolute left-0 top-full z-50 mt-1 min-w-[230px] rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
                <div className="space-y-2.5">
                  {/* Name */}
                  <div className="flex items-center justify-between gap-3">
                    <span className="shrink-0 text-[11px] text-slate-400">Name</span>
                    <button
                      type="button"
                      onClick={() => copyCustomerField(customerName, "name")}
                      className="group/copy flex min-w-0 items-center gap-1 text-right text-xs font-medium text-slate-700 hover:text-[var(--primary)]"
                    >
                      <span className="truncate">
                        {copiedCustomerField === "name" ? "Copied!" : customerName}
                      </span>
                      {copiedCustomerField === "name" ? null : (
                        <Copy className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover/copy:opacity-100" />
                      )}
                    </button>
                  </div>
                  {/* Email */}
                  {orderContact.email ? (
                    <div className="flex items-center justify-between gap-3">
                      <span className="shrink-0 text-[11px] text-slate-400">Email</span>
                      <button
                        type="button"
                        onClick={() => copyCustomerField(orderContact.email!, "email")}
                        className="group/copy flex min-w-0 items-center gap-1 text-right text-xs font-medium text-slate-700 hover:text-[var(--primary)]"
                      >
                        <span className="truncate">
                          {copiedCustomerField === "email" ? "Copied!" : orderContact.email}
                        </span>
                        {copiedCustomerField === "email" ? null : (
                          <Copy className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover/copy:opacity-100" />
                        )}
                      </button>
                    </div>
                  ) : null}
                  {/* Phone */}
                  {orderContact.phone ? (
                    <div className="flex items-center justify-between gap-3">
                      <span className="shrink-0 text-[11px] text-slate-400">Phone</span>
                      <button
                        type="button"
                        onClick={() => copyCustomerField(orderContact.phone!, "phone")}
                        className="group/copy flex min-w-0 items-center gap-1 text-right text-xs font-medium text-slate-700 hover:text-[var(--primary)]"
                      >
                        <span className="truncate">
                          {copiedCustomerField === "phone" ? "Copied!" : orderContact.phone}
                        </span>
                        {copiedCustomerField === "phone" ? null : (
                          <Copy className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover/copy:opacity-100" />
                        )}
                      </button>
                    </div>
                  ) : null}
                  {!orderContact.email && !orderContact.phone ? (
                    <p className="text-[11px] text-slate-400">No contact info on file.</p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          {/* Quick SMS icon */}
          <div className="relative" ref={smsRef}>
            <button
              type="button"
              title="Send quick SMS"
              onClick={() => {
                setSmsPhone(orderContact.phone ?? "");
                setSmsError(null);
                setSmsOpen((v) => !v);
              }}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <MessageSquare className="h-3.5 w-3.5" />
            </button>

            {smsOpen ? (
              <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
                <p className="mb-2 text-xs font-semibold text-slate-700">Quick SMS</p>
                {smsError ? (
                  <p className="mb-2 rounded bg-red-50 px-2 py-1 text-xs text-red-600">{smsError}</p>
                ) : null}
                <label className="mb-1 block text-[11px] text-slate-500">Phone number</label>
                <input
                  type="tel"
                  value={smsPhone}
                  onChange={(e) => setSmsPhone(e.target.value)}
                  placeholder="+1 818 555 1234"
                  className="mb-2 w-full rounded-md border border-slate-200 px-2 py-1 text-sm outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]"
                />
                <label className="mb-1 block text-[11px] text-slate-500">Message</label>
                <textarea
                  value={smsBody}
                  onChange={(e) => setSmsBody(e.target.value)}
                  rows={3}
                  placeholder="Type your message…"
                  className="mb-3 w-full resize-none rounded-md border border-slate-200 px-2 py-1 text-sm outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setSmsOpen(false)}
                    className="rounded-md border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={sendQuickSms}
                    disabled={smsSending || !smsPhone.trim() || !smsBody.trim()}
                    className="inline-flex items-center gap-1 rounded-md bg-[var(--primary)] px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {smsSending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    {smsSending ? "Sending…" : "Send"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
      {/* Priority */}
      {priority && priority !== "normal" ? (
        <>
          <span className="text-slate-300">|</span>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize",
              PRIORITY_STYLES[priority] ?? "bg-slate-100 text-slate-600"
            )}
          >
            {priority}
          </span>
        </>
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
        !isViewOnly ? (
          <select
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300"
            title="Owner"
          >
            <option value="">— Owner —</option>
            {ownersForForm.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        ) : ownerName ? (
          <span className="text-sm text-slate-500">{ownerName}</span>
        ) : undefined
      }
      footer={
        <>
          {isAdmin && !isViewOnly ? (
            <button
              type="button"
              onClick={() => {
                setRemoveError(null);
                setConfirmRemove(true);
              }}
              disabled={loading || saving || removing}
              className="mr-auto flex items-center gap-2 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
              title="Remove order"
            >
              <Trash2 className="h-4 w-4" />
              Delete Order
            </button>
          ) : null}
          <Button
            variant="outline"
            onClick={handleClose}
            type="button"
            disabled={saving || removing}
          >
            {saving ? "Saving…" : "Close"}
          </Button>
        </>
      }
    >
      {loading || !data ? (
        <div className="flex h-40 items-center justify-center text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <>
          {!isViewOnly ? (
            <div className="mb-4 flex items-center gap-1 border-b border-slate-200">
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
              {hasShipping ? (
                <button
                  type="button"
                  onClick={() => setTab("shipping")}
                  className={cn(
                    "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                    tab === "shipping"
                      ? "border-[var(--primary)] text-[var(--primary)]"
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  )}
                >
                  Shipping
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      data?.shippingRequest?.status === "client_responded"
                        ? "bg-emerald-500"
                        : "bg-amber-500"
                    )}
                  />
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
              groupSize={groupSize}
              groupSameColumnCount={groupSameColumnCount}
              groupColumnName={groupColumnName}
              customerEmail={orderContact.email}
              customerPhone={orderContact.phone}
              productLabel={productFromOrder(fieldValues, modalCustomFields)}
              onComplete={({ message, refreshOrder }) => {
                setSaveError(null);
                onLinkCopied?.(message);
                if (refreshOrder) {
                  void load({ silent: true }).then(() => {
                    if (
                      /shipment link|link sent/i.test(message)
                    ) {
                      setTab("shipping");
                    }
                  });
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
          ) : tab === "shipping" && data.shippingRequest ? (
            <ShippingTab
              shippingRequest={data.shippingRequest}
              orderId={data.order.id}
              appUrl={appUrl}
              onStaffNotesSaved={(notes) => {
                setData((prev) =>
                  prev?.shippingRequest
                    ? {
                        ...prev,
                        shippingRequest: {
                          ...prev.shippingRequest,
                          staff_notes: notes,
                        },
                      }
                    : prev
                );
              }}
            />
          ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="space-y-4 md:col-span-2">
            <OrderFormBody
              idPrefix="edit"
              customFields={modalCustomFields}
              owners={ownersForForm}
              designers={designers}
              title={title}
              onTitleChange={setTitle}
              hideOrderNumberField
              hidePriorityAndDueDateFields
              hideOwnerField
              hideCustomerSection
              priority={priority}
              onPriorityChange={setPriority}
              ownerId={ownerId}
              onOwnerIdChange={setOwnerId}
              description={description}
              onDescriptionChange={setDescription}
              noteHistory={noteHistory}
              internalNote={newNote}
              onInternalNoteChange={setNewNote}
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
              skuImagesBySkuId={skuImagesBySkuId}
              ensureSkuPersisted={ensureSkuPersisted}
              readOnly={isViewOnly}
              hideEmpty={false}
              tags={tags}
              tagId={tagId}
              onTagIdChange={isViewOnly ? undefined : setTagId}
            />

            {saveError ? (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
                {saveError}
              </p>
            ) : null}
          </div>

          <div className="space-y-4">
            {/* Priority + Due Date box */}
            <div className="mt-4 rounded-lg border border-slate-200 p-3 space-y-3">
              <div>
                <Label htmlFor="sidebar-priority">Priority</Label>
                <Select
                  id="sidebar-priority"
                  value={priority}
                  disabled={isViewOnly}
                  onChange={(e) => setPriority(e.target.value)}
                >
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="sidebar-due">Due date</Label>
                <Input
                  id="sidebar-due"
                  type="date"
                  min={isViewOnly ? undefined : localDateInputValue()}
                  readOnly={isViewOnly}
                  value={dateInputValue(dueDate)}
                  onChange={(e) => {
                    setDueDate(e.target.value);
                    setSaveError(null);
                  }}
                  className={isViewOnly ? "bg-slate-50" : undefined}
                />
              </div>
            </div>
            {tags.length > 0 ? (
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Tag
                </p>
                {!isViewOnly ? (
                  <select
                    value={tagId}
                    onChange={(e) => setTagId(e.target.value)}
                    className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300"
                  >
                    <option value="">— None —</option>
                    {tags.map((tag) => (
                      <option key={tag.id} value={tag.id}>
                        {tag.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-sm text-slate-700">
                    {tags.find((t) => t.id === tagId)?.name ?? "—"}
                  </span>
                )}
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
            {data ? (
              <FastActionButtonBar
                buttons={fastActionButtons}
                currentColumnId={data.order.column_id}
                orderId={data.order.id}
                role={role}
                userId={userId}
                onSuccess={({ destinationColumnId, destinationName }) => {
                  onLinkCopied?.(`Moved to ${destinationName}`);
                  void load({ silent: true });
                  onChanged();
                  if (data && onNotifyColumn) {
                    const notifyCol = notifyColumns.find(
                      (c) => c.column_id === destinationColumnId && c.automation_enabled
                    );
                    if (notifyCol) {
                      const destColumn = columns.find((c) => c.id === destinationColumnId);
                      onNotifyColumn(
                        { ...data.order, column_id: destinationColumnId },
                        notifyCol,
                        destColumn?.name ?? destinationName
                      );
                    }
                  }
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
                <>
                  {/* Filter toggle */}
                  <div className="flex gap-1 border-t border-slate-100 px-3 pt-2 pb-1">
                    <button
                      type="button"
                      onClick={() => setActivityFilter("all")}
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
                        activityFilter === "all"
                          ? "bg-slate-800 text-white"
                          : "text-slate-500 hover:bg-slate-100"
                      )}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => setActivityFilter("moves")}
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
                        activityFilter === "moves"
                          ? "bg-slate-800 text-white"
                          : "text-slate-500 hover:bg-slate-100"
                      )}
                    >
                      Card moves
                    </button>
                  </div>

                  {activityFilter === "all" ? (
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
                  ) : (() => {
                    const moveEvents = data.activity
                      .filter((l) => l.action === "moved")
                      .slice()
                      .reverse();
                    const createdAt = data.order.created_at;
                    return (
                      <ul className="space-y-0 border-t border-slate-100 px-3 py-2">
                        {moveEvents.length === 0 ? (
                          <li className="text-xs text-slate-400">No column moves yet.</li>
                        ) : (
                          moveEvents.map((log, idx) => {
                            const prevTime = idx === 0
                              ? new Date(createdAt).getTime()
                              : new Date(moveEvents[idx - 1].created_at).getTime();
                            const duration = new Date(log.created_at).getTime() - prevTime;
                            const meta = log.metadata ?? {};
                            const from = (meta.fromName as string | undefined) ?? "—";
                            const to = (meta.toName as string | undefined) ?? "—";
                            const isLast = idx === moveEvents.length - 1;
                            return (
                              <li key={log.id} className="flex gap-2 pb-3 last:pb-0">
                                {/* Timeline spine */}
                                <div className="flex flex-col items-center">
                                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-slate-400" />
                                  {!isLast ? (
                                    <span className="mt-0.5 w-px flex-1 bg-slate-200" />
                                  ) : null}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-medium text-slate-700">
                                    {from}
                                    <span className="mx-1 text-slate-400">→</span>
                                    {to}
                                  </p>
                                  <p className="text-[11px] text-slate-400">
                                    {formatDateTime(log.created_at)}
                                    {log.actor_name ? ` · ${log.actor_name}` : ""}
                                  </p>
                                  <p className="text-[11px] text-slate-500">
                                    Stayed{" "}
                                    <span className="font-medium text-slate-700">
                                      {formatDuration(duration)}
                                    </span>{" "}
                                    in <span className="font-medium">{from}</span>
                                  </p>
                                </div>
                              </li>
                            );
                          })
                        )}
                      </ul>
                    );
                  })()}
                </>
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
