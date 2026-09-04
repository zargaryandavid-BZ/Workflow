"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Archive,
  ArchiveRestore,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Lock,
  Loader2,
  MessageSquare,
  Pencil,
  Trash2,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { CardWorkingPrompt } from "@/components/board/card-working-prompt";
import { CardSwitchTimerPrompt } from "@/components/board/card-switch-timer-prompt";
import { OrderTimerButton } from "@/components/board/order-timer-button";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ApprovalTab } from "./approval-tab";
import { HistoryTab } from "./history-tab";
import { MissingInfoTab } from "./missing-info-tab";
import { ShippingTab } from "./shipping-tab";
import { ButtonAutomationBar } from "./button-automation-bar";
import { FastActionButtonBar } from "./fast-action-button-bar";
import { OrderFormBody, type OrderOwner } from "./order-form-body";
import { ConnectedSpecsSection } from "./connected-specs-section";
import { DesignReferenceBlock, SourceChannelChip } from "./design-reference";
import { isConnectedOrder } from "@/lib/connected-specs";
import { NudgeButton } from "./nudge-button";
import { ComboStockControl } from "./combo-stock-control";
import { isComboOrder, getComboStock } from "@/lib/combo-stock";
import { normalizeSkus, prepareSkusForSave, validateSkus, type SkuItem } from "./sku-editor";
import { PRIORITY_OPTIONS, PRIORITY_STYLES } from "@/lib/constants";
import { Input, Label, Select } from "@/components/ui/input";
import { describeActivity, formatStayDuration, isColumnMoveActivity, sentMessagesFromActivity, type ActivityLogEntry } from "@/lib/activity";
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
import { DueDateFields } from "./due-date-fields";
import { ApplicationFields } from "./application-fields";
import {
  buildStaffDueSpecs,
  DEFAULT_PROCESSING_DAYS,
  formatOrderDueDisplay,
  isPendingAfterApprovalDue,
  mergeDueSpecsIntoOrderSpecs,
  readOrderDueSpecs,
  type DueDateMode,
} from "@/lib/due-date";
import {
  applicationDaysFromSpecs,
  DEFAULT_APPLICATION_DAYS,
  isApplicationCustomFieldOn,
  mergeApplicationIntoOrderSpecs,
} from "@/lib/order-application";
import { preserveDesignTaskUrl } from "@/lib/design-task";
import { ORDER_TAG_STYLES, orderTagsFromSpecs } from "@/lib/order-tags";
import { type NotifyColumnConfig } from "@/lib/board-notify";
import { type WebhookSourceStyles } from "@/lib/webhook-source-styles";
import { partCardTitle } from "@/lib/group-orders";
import {
  canEditManualOrders,
  canEditOrderDetails,
  canEditOrderDesigner,
  canEditOrderDueDate,
  canEditOrderTitle,
} from "@/lib/permissions";
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
  JobNotification,
} from "@/lib/types";
import {
  appendNoteEntry,
  parseNoteHistory,
  serializeNoteHistory,
} from "@/lib/note-history";

/** "Acme Acme" / "Safe Care Packaging Safe Care Packaging" → one copy. */
function collapseDuplicatedLabel(value: string): string {
  const t = value.replace(/\s+/g, " ").trim();
  const words = t.split(" ");
  if (words.length >= 2 && words.length % 2 === 0) {
    const half = words.length / 2;
    const a = words.slice(0, half).join(" ");
    const b = words.slice(half).join(" ");
    if (a.toLowerCase() === b.toLowerCase()) return a;
  }
  return t;
}

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
  notifications?: JobNotification[];
  shippingRequest?: ShippingRequest | null;
  /** True until /timeline finishes filling activity + notification tabs. */
  timelinePending?: boolean;
  tabHints?: { hasMissingInfo?: boolean; hasApproval?: boolean };
}

type TimelineResponse = {
  activity: ActivityLogEntry[];
  approvals: Approval[];
  missingInfo: MissingInfoNote[];
  approvalNotes: ApprovalNote[];
  notifications: JobNotification[];
  notes: OrderNote[];
  timelinePending?: boolean;
  tabHints?: { hasMissingInfo?: boolean; hasApproval?: boolean };
};

/**
 * On silent reload, keep already-fetched timeline/tab data so the UI
 * doesn't flash empty while the lightweight order payload returns.
 */
function mergeSilentDetail(
  core: DetailResponse,
  prev: DetailResponse | null,
  orderId: string,
  silent: boolean | undefined
): DetailResponse {
  if (!silent || !prev || prev.order.id !== orderId) {
    return core;
  }
  return {
    ...core,
    activity: prev.activity.length ? prev.activity : core.activity,
    approvals: prev.approvals.length ? prev.approvals : core.approvals,
    missingInfo: prev.missingInfo.length
      ? prev.missingInfo
      : core.missingInfo,
    approvalNotes: prev.approvalNotes.length
      ? prev.approvalNotes
      : core.approvalNotes,
    notifications: prev.notifications?.length
      ? prev.notifications
      : core.notifications,
    notes: prev.notes.length ? prev.notes : core.notes,
    timelinePending: false,
    tabHints: {
      hasMissingInfo:
        Boolean(core.tabHints?.hasMissingInfo) ||
        prev.missingInfo.length > 0 ||
        Boolean(prev.tabHints?.hasMissingInfo),
      hasApproval:
        Boolean(core.tabHints?.hasApproval) ||
        prev.approvalNotes.length > 0 ||
        Boolean(prev.tabHints?.hasApproval),
    },
  };
}

/** Treat empty-ish values as equal so open ticket isn't falsely dirty. */
function fieldValuesEqual(
  current: unknown,
  saved: unknown,
  fieldType: string
): boolean {
  if (fieldType === "checkbox") {
    const asBool = (v: unknown) =>
      v === true || v === 1 || v === "1" || v === "true" || v === "yes";
    return asBool(current) === asBool(saved);
  }
  if (fieldType === "number") {
    const a =
      current === "" || current === undefined || current === null
        ? null
        : Number(current);
    const b =
      saved === "" || saved === undefined || saved === null
        ? null
        : Number(saved);
    if (
      (a === null || (typeof a === "number" && Number.isNaN(a))) &&
      (b === null || (typeof b === "number" && Number.isNaN(b)))
    ) {
      return true;
    }
    if (a === null || b === null) return false;
    return a === b;
  }
  const a =
    current === undefined || current === null ? "" : String(current).trim();
  const b = saved === undefined || saved === null ? "" : String(saved).trim();
  return a === b;
}

type TicketEditBaseline = {
  title: string;
  newNote: string;
  productionNotes: string;
  designerNote: string;
  customerFacingNote: string;
  priority: string;
  applicationDays: number;
  ownerId: string;
  dueDate: string;
  dueDateMode: DueDateMode;
  dueProcessingDays: number;
  tagId: string;
  designerId: string;
  designTask: string;
  customerName: string;
  customerContact: string;
  fieldValues: Record<string, unknown>;
  skus: ReturnType<typeof prepareSkusForSave>;
};

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
  onNotifyColumn,
  groupSize,
  groupSameColumnCount,
  groupColumnName,
}: CardDetailModalProps) {
  const [modalCustomFields, setModalCustomFields] =
    useState<CustomField[]>(customFields);
  const resolved = useMemo(
    () => resolveOrderFormFields(modalCustomFields),
    [modalCustomFields]
  );
  const [data, setData] = useState<DetailResponse | null>(null);
  const dataRef = useRef<DetailResponse | null>(null);
  dataRef.current = data;
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activityOpen, setActivityOpen] = useState(true);
  const [activityFilter, setActivityFilter] = useState<"all" | "moves">("all");

  /** Full form: Admin / Sales / Pre-prod (Manual + CRM). Order # locked for CRM. */
  const isViewOnly =
    mode === "view" ||
    !canEditManualOrders(role) ||
    (data?.order != null && !canEditOrderDetails(role, data.order));
  /** Due date stays editable when the viewer cannot edit the full form. */
  const canEditDueDate = canEditOrderDueDate(mode);
  const dueDateReadOnly = !canEditDueDate;
  /** Assigned designer stays editable under the same rule as due date. */
  const canEditDesigner = canEditOrderDesigner(mode);
  const designerReadOnly = !canEditDesigner;
  const editLockedReason =
    mode === "view"
      ? null
      : !canEditManualOrders(role)
        ? "Only Admin, Sales (Account Manager), Pre-prod, and Designer can edit order details. Due date and designer can still be changed."
        : null;

  const [title, setTitle] = useState("");
  const [itemName, setItemName] = useState("");
  const [editingItemName, setEditingItemName] = useState(false);
  const itemNameInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [noteHistory, setNoteHistory] = useState<NoteEntry[]>([]);
  const [newNote, setNewNote] = useState("");
  const [productionNoteHistory, setProductionNoteHistory] = useState<
    NoteEntry[]
  >([]);
  const [productionNotes, setProductionNotes] = useState("");
  const [customerFacingNote, setCustomerFacingNote] = useState("");
  const [designerNoteHistory, setDesignerNoteHistory] = useState<NoteEntry[]>(
    []
  );
  /** Draft text for a new designer note (append-only). */
  const [designerNote, setDesignerNote] = useState("");
  const [priority, setPriority] = useState("normal");
  const [applicationDays, setApplicationDays] = useState(DEFAULT_APPLICATION_DAYS);
  const [ownerId, setOwnerId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueDateMode, setDueDateMode] = useState<DueDateMode>("fixed");
  const [dueProcessingDays, setDueProcessingDays] = useState(
    DEFAULT_PROCESSING_DAYS
  );
  const [tagId, setTagId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerContact, setCustomerContact] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({});
  const [skus, setSkus] = useState<SkuItem[]>([]);
  const [designerId, setDesignerId] = useState("");
  const [designTask, setDesignTask] = useState("");
  const [tab, setTab] = useState<"details" | "missing-info" | "approval" | "shipping" | "history">(
    "details"
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmUnsaved, setConfirmUnsaved] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [downloadingArchive, setDownloadingArchive] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveMessage, setArchiveMessage] = useState<string | null>(null);
  const [orderNumberCopied, setOrderNumberCopied] = useState(false);
  const [persistedSkuIds, setPersistedSkuIds] = useState<Set<string>>(
    () => new Set()
  );
  /** SKUs snapshot from last load — used for dirty check without re-minting ids. */
  const baselineSkusRef = useRef<ReturnType<typeof normalizeSkus>>([]);
  const ticketBaselineRef = useRef<TicketEditBaseline | null>(null);
  /** True only after the user edits the form — not after load/auto-fill. */
  const userTouchedRef = useRef(false);
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

  // ── Order lock ──────────────────────────────────────────────────────────────
  const lockedBy = data?.order?.locked_by ?? null;
  const lockedByName = data?.order?.locked_by_name ?? null;
  const lockReason = data?.order?.lock_reason ?? null;
  const isLocked = Boolean(lockedBy);
  const isLockedByOther = isLocked && lockedBy !== userId;
  const canUnlock = isLocked && (isAdmin || lockedBy === userId);
  const isLockedOut = isLockedByOther && !isAdmin;
  const [lockBusy, setLockBusy] = useState(false);

  async function lockOrder() {
    if (!orderId) return;
    const reason = window.prompt("Why are you locking this order? Everyone will see this reason.");
    if (reason == null) return;
    if (!reason.trim()) { setSaveError("A reason is required to lock the order."); return; }
    setLockBusy(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/lock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setSaveError(j.error ?? "Failed to lock the order.");
        return;
      }
      await load({ silent: true });
    } finally {
      setLockBusy(false);
    }
  }

  async function unlockOrder() {
    if (!orderId) return;
    setLockBusy(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/lock`, { method: "DELETE" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setSaveError(j.error ?? "Failed to unlock the order.");
        return;
      }
      await load({ silent: true });
    } finally {
      setLockBusy(false);
    }
  }

  const customFieldsRef = useRef(customFields);
  customFieldsRef.current = customFields;

  const applyDetail = useCallback((json: DetailResponse) => {
    userTouchedRef.current = false;
    const fields = json.customFields ?? customFieldsRef.current;
    setModalCustomFields(fields);
    const validFieldIds = new Set(fields.map((f) => f.id));
    const formFields = resolveOrderFormFields(fields);
    setData(json);
    setTitle(json.order.title);
    // Same string as the board card title (item title, else order title for
    // single-item webhooks that only stamped webhook_order_title).
    setItemName(partCardTitle(json.order) ?? "");
    setEditingItemName(false);
    const rawNote = json.order.internal_note ?? "";
    setNoteHistory(parseNoteHistory(rawNote));
    setNewNote("");
    const rawProduction =
      typeof json.order.specs?.production_notes === "string"
        ? json.order.specs.production_notes
        : "";
    setProductionNoteHistory(parseNoteHistory(rawProduction));
    setProductionNotes("");
    setCustomerFacingNote(
      typeof json.order.specs?.customer_facing_note === "string"
        ? json.order.specs.customer_facing_note
        : ""
    );
    const rawDesigner =
      typeof json.order.specs?.designer_notes === "string"
        ? json.order.specs.designer_notes
        : "";
    setDesignerNoteHistory(parseNoteHistory(rawDesigner));
    setDesignerNote("");
    setPriority(json.order.priority);
    setApplicationDays(
      applicationDaysFromSpecs(json.order.specs) ?? DEFAULT_APPLICATION_DAYS
    );
    setOwnerId(json.order.created_by ?? "");
    setDueDate(dateInputValue(json.order.due_date));
    {
      const dueSpecs = readOrderDueSpecs(json.order.specs);
      setDueDateMode(
        dueSpecs.due_date_mode === "after_approval"
          ? "after_approval"
          : "fixed"
      );
      setDueProcessingDays(
        dueSpecs.due_processing_days ?? DEFAULT_PROCESSING_DAYS
      );
    }
    setTagId(json.order.tag_id ?? "");
    const normalizedSkus = normalizeSkus(json.order.specs?.skus);
    setSkus(normalizedSkus);
    baselineSkusRef.current = normalizedSkus;
    const nextDesignerId = (json.order.specs?.designer_id as string) ?? "";
    const nextDesignTask = (json.order.specs?.design_task as string) ?? "";
    setDesignerId(nextDesignerId);
    setDesignTask(nextDesignTask);
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

    const dueSpecs = readOrderDueSpecs(json.order.specs);
    ticketBaselineRef.current = {
      title: json.order.title,
      newNote: "",
      productionNotes: "",
      designerNote: "",
      customerFacingNote:
        typeof json.order.specs?.customer_facing_note === "string"
          ? json.order.specs.customer_facing_note
          : "",
      priority: json.order.priority,
      applicationDays:
        applicationDaysFromSpecs(json.order.specs) ?? DEFAULT_APPLICATION_DAYS,
      ownerId: json.order.created_by ?? "",
      dueDate: dateInputValue(json.order.due_date),
      dueDateMode:
        dueSpecs.due_date_mode === "after_approval"
          ? "after_approval"
          : "fixed",
      dueProcessingDays:
        dueSpecs.due_processing_days ?? DEFAULT_PROCESSING_DAYS,
      tagId: json.order.tag_id ?? "",
      designerId: nextDesignerId,
      designTask: nextDesignTask,
      customerName: name,
      customerContact: contact,
      fieldValues: { ...map },
      skus: prepareSkusForSave(normalizedSkus, { pendingArtworkIds: [] }),
    };
  }, []);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!orderId) return;
    if (!options?.silent) setLoading(true);
    try {
      const res = await fetch(`/api/orders/${orderId}`);
      const text = await res.text();
      if (!text) {
        if (!res.ok) setSaveError("Failed to load order");
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        setSaveError("Failed to load order");
        return;
      }
      if (!res.ok) {
        const err =
          parsed &&
          typeof parsed === "object" &&
          "error" in parsed &&
          typeof (parsed as { error: unknown }).error === "string"
            ? (parsed as { error: string }).error
            : "Failed to load order";
        setSaveError(err);
        return;
      }
      const core = parsed as DetailResponse;
      const merged = mergeSilentDetail(
        core,
        dataRef.current,
        orderId,
        options?.silent
      );
      applyDetail(merged);
      if (!options?.silent) setLoading(false);

      if (!options?.silent && core.timelinePending !== false) {
        void fetch(`/api/orders/${orderId}/timeline`)
          .then(async (timelineRes) => {
            if (!timelineRes.ok) return;
            const side = (await timelineRes.json()) as TimelineResponse;
            setData((current) => {
              if (!current || current.order.id !== orderId) return current;
              return {
                ...current,
                activity: side.activity ?? [],
                approvals: side.approvals ?? [],
                missingInfo: side.missingInfo ?? [],
                approvalNotes: side.approvalNotes ?? [],
                notifications: side.notifications ?? [],
                notes: side.notes ?? [],
                timelinePending: false,
                tabHints: side.tabHints ?? current.tabHints,
              };
            });
          })
          .catch(() => {
            setData((current) => {
              if (!current || current.order.id !== orderId) return current;
              return { ...current, timelinePending: false };
            });
          });
      }
    } catch {
      setSaveError("Failed to load order");
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, [orderId, applyDetail]);

  useEffect(() => {
    if (open && orderId) {
      setSaveError(null);
      setActivityFilter("all");
      setModalCustomFields(customFieldsRef.current);
      load();
    }
    if (!open) {
      setSaveError(null);
      setConfirmUnsaved(false);
      setData(null);
      setTitle("");
      setCustomerName("");
      setPriority("normal");
      setTab("details");
      setActivityOpen(true);
      setActivityFilter("all");
      setPersistedSkuIds(new Set());
      baselineSkusRef.current = [];
      ticketBaselineRef.current = null;
      userTouchedRef.current = false;
    }
  }, [open, orderId, load]);

  // Wait cursor while the save request is in flight.
  useEffect(() => {
    if (!saving) return;
    const prev = document.body.style.cursor;
    document.body.style.cursor = "wait";
    return () => {
      document.body.style.cursor = prev;
    };
  }, [saving]);

  function isDueDateDirty(): boolean {
    if (!userTouchedRef.current) return false;
    const b = ticketBaselineRef.current;
    if (!data || !b) return false;
    if (dateInputValue(dueDate) !== dateInputValue(b.dueDate)) return true;
    if (dueDateMode !== b.dueDateMode) return true;
    if (
      dueDateMode === "after_approval" &&
      dueProcessingDays !== b.dueProcessingDays
    ) {
      return true;
    }
    return false;
  }

  /** CRM / view-only tickets: persist due date without a full form save. */
  async function saveDueDateOnly(): Promise<boolean> {
    if (!orderId || !data || saving || !canEditDueDate) return false;

    if (dueDateMode === "fixed") {
      const dueDateError = validateDueDate(dueDate, data.order.due_date);
      if (dueDateError) {
        setSaveError(dueDateError);
        return false;
      }
    } else if (!Number.isFinite(dueProcessingDays) || dueProcessingDays < 1) {
      setSaveError("Working days after approval must be at least 1.");
      return false;
    }

    setSaveError(null);
    setSaving(true);

    const staffDue = buildStaffDueSpecs({
      mode: dueDateMode,
      dueDate: dateInputValue(dueDate) || null,
      processingDays:
        dueDateMode === "after_approval" ? dueProcessingDays : null,
      previousSpecs: data.order.specs,
    });
    const nextDue = staffDue.dueDate;
    const nextSpecs = mergeDueSpecsIntoOrderSpecs(
      data.order.specs,
      staffDue.specs
    );
    const rollback = {
      due_date: data.order.due_date,
      specs: data.order.specs ?? {},
    };

    setDueDate(nextDue ?? "");
    setData((prev) =>
      prev
        ? {
            ...prev,
            order: {
              ...prev.order,
              due_date: nextDue,
              specs: nextSpecs,
            },
          }
        : prev
    );
    onChanged({ due_date: nextDue, specs: nextSpecs });

    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dueDate: nextDue,
          dueDateMode,
          dueProcessingDays:
            dueDateMode === "after_approval" ? dueProcessingDays : null,
        }),
      });
      const savedJson = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        setSaveError(savedJson.error ?? "Failed to update due date");
        onChanged(rollback);
        setData((prev) =>
          prev
            ? {
                ...prev,
                order: {
                  ...prev.order,
                  due_date: rollback.due_date,
                  specs: rollback.specs,
                },
              }
            : prev
        );
        setDueDate(dateInputValue(rollback.due_date));
        return false;
      }
      if (ticketBaselineRef.current) {
        ticketBaselineRef.current = {
          ...ticketBaselineRef.current,
          dueDate: nextDue ?? "",
          dueDateMode,
          dueProcessingDays,
        };
      }
      onChanged();
      return true;
    } finally {
      setSaving(false);
    }
  }

  async function save(options?: { reload?: boolean }): Promise<boolean> {
    if (!orderId || saving) return false;

    // CRM / role-locked tickets: only due date may change.
    if (isViewOnly) {
      return saveDueDateOnly();
    }

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

    if (dueDateMode === "fixed") {
      const dueDateError = validateDueDate(dueDate, data?.order.due_date);
      if (dueDateError) {
        setSaveError(dueDateError);
        return false;
      }
    } else if (!Number.isFinite(dueProcessingDays) || dueProcessingDays < 1) {
      setSaveError("Working days after approval must be at least 1.");
      return false;
    }

    if (ownerId && !owners.some((o) => o.id === ownerId)) {
      setSaveError("Owner must be an account manager or admin");
      return false;
    }

    const skuError = validateSkus(skus, []);
    if (skuError) {
      setSaveError(skuError);
      return false;
    }

    setSaveError(null);
    setSaving(true);
    const updatedHistory = appendNoteEntry(
      noteHistory,
      newNote,
      currentUserName
    );
    const internalNoteJson = serializeNoteHistory(updatedHistory);
    const updatedProductionHistory = appendNoteEntry(
      productionNoteHistory,
      productionNotes,
      currentUserName
    );
    const nextProductionNotesJson = serializeNoteHistory(
      updatedProductionHistory
    );
    const updatedDesignerHistory = appendNoteEntry(
      designerNoteHistory,
      designerNote,
      currentUserName
    );
    const nextDesignerNotesJson = serializeNoteHistory(updatedDesignerHistory);
    const savedSkus = prepareSkusForSave(skus, { pendingArtworkIds: [] });
    const applicationOn = isApplicationCustomFieldOn(
      customFields,
      fieldValues
    );
    const nextDesignTask = designTask || "";
    const nextDueInput = dateInputValue(dueDate) || null;
    const staffDue = buildStaffDueSpecs({
      mode: dueDateMode,
      dueDate: nextDueInput,
      processingDays:
        dueDateMode === "after_approval" ? dueProcessingDays : null,
      previousSpecs: data?.order.specs,
    });
    const nextDue = staffDue.dueDate;
    const nextSpecs = preserveDesignTaskUrl(
      (data?.order.specs ?? {}) as Record<string, unknown>,
      mergeDueSpecsIntoOrderSpecs(
        mergeApplicationIntoOrderSpecs(
          {
            ...(data?.order.specs ?? {}),
            skus: savedSkus,
            designer_id: designerId || null,
            designer_name:
              designers.find((d) => d.id === designerId)?.name ?? null,
            design_task: nextDesignTask || null,
            production_notes: nextProductionNotesJson,
            customer_facing_note: customerFacingNote.trim() || null,
            designer_notes: nextDesignerNotesJson,
          },
          applicationOn,
          applicationDays
        ),
        staffDue.specs
      )
    );
    const customFieldValues = buildCustomFieldPayload(
      resolved,
      fieldValues,
      skus,
      customerName,
      customerContact
    );

    const selectedTag = tagId
      ? (tags.find((t) => t.id === tagId) ?? null)
      : null;
    // CRM / webhook order numbers are immutable — keep the stored title.
    const nextTitle =
      data?.order && canEditOrderTitle(role, data.order)
        ? title.trim()
        : (data?.order.title ?? title).trim();
    const nextPriority = priority as "low" | "normal" | "high" | "urgent";
    const nextCustomerName = customerName.trim();
    const nextCustomerContact = customerContact.trim();
    const boardPatch = {
      tag_id: tagId || null,
      tag: selectedTag,
      title: nextTitle,
      priority: nextPriority,
      due_date: nextDue,
      created_by: ownerId || null,
      specs: nextSpecs,
    };
    const rollbackPatch = data
      ? {
          tag_id: data.order.tag_id,
          tag: data.order.tag ?? null,
          title: data.order.title,
          description: data.order.description,
          priority: data.order.priority,
          due_date: data.order.due_date,
          created_by: data.order.created_by,
          specs: data.order.specs ?? {},
        }
      : null;

    // Optimistic UI — board + modal update before the network round-trip.
    // Keep form state + dirty baselines in sync so Save/Cancel hide after save.
    setNoteHistory(updatedHistory);
    setNewNote("");
    setProductionNoteHistory(updatedProductionHistory);
    setProductionNotes("");
    setTitle(nextTitle);
    setCustomerFacingNote(customerFacingNote.trim());
    setDesignerNoteHistory(updatedDesignerHistory);
    setDesignerNote("");
    setDesignTask(nextDesignTask);
    setDueDate(nextDue ?? "");
    setCustomerName(nextCustomerName);
    setCustomerContact(nextCustomerContact);
    setSkus(savedSkus);
    baselineSkusRef.current = savedSkus;
    setData((prev) => {
      if (!prev) return prev;
      const valueById = new Map(
        customFieldValues.map((row) => [row.customFieldId, row.value])
      );
      return {
        ...prev,
        order: {
          ...prev.order,
          title: nextTitle,
          internal_note: internalNoteJson,
          priority: nextPriority,
          due_date: nextDue,
          created_by: ownerId || null,
          tag_id: tagId || null,
          tag: selectedTag,
          specs: nextSpecs,
        },
        values: prev.values
          .map((row) =>
            valueById.has(row.custom_field_id)
              ? { ...row, value: valueById.get(row.custom_field_id) }
              : row
          )
          .concat(
            customFieldValues
              .filter(
                (row) =>
                  !prev.values.some(
                    (v) => v.custom_field_id === row.customFieldId
                  )
              )
              .map((row) => ({
                id: `local-${row.customFieldId}`,
                order_id: prev.order.id,
                custom_field_id: row.customFieldId,
                value: row.value,
              }))
          ),
      };
    });
    setFieldValues((prev) => {
      const next = { ...prev };
      for (const row of customFieldValues) {
        next[row.customFieldId] = row.value;
      }
      return next;
    });
    ticketBaselineRef.current = {
      title: nextTitle,
      newNote: "",
      productionNotes: "",
      designerNote: "",
      customerFacingNote: customerFacingNote.trim(),
      priority: nextPriority,
      applicationDays,
      ownerId: ownerId || "",
      dueDate: nextDue ?? "",
      dueDateMode,
      dueProcessingDays,
      tagId: tagId || "",
      designerId: designerId || "",
      designTask: nextDesignTask,
      customerName: nextCustomerName,
      customerContact: nextCustomerContact,
      fieldValues: (() => {
        const next = { ...fieldValues };
        for (const row of customFieldValues) {
          next[row.customFieldId] = row.value;
        }
        return next;
      })(),
      skus: savedSkus,
    };
    userTouchedRef.current = false;
    onChanged(boardPatch);

    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: nextTitle,
          internal_note: internalNoteJson,
          priority: nextPriority,
          ownerId: ownerId || null,
          dueDate: nextDue,
          dueDateMode,
          dueProcessingDays:
            dueDateMode === "after_approval" ? dueProcessingDays : null,
          tagId: tagId || null,
          specs: nextSpecs,
          customFieldValues,
        }),
      });
      const savedJson = (await res.json().catch(() => ({}))) as {
        error?: string;
        tagNotifyWarning?: string;
      };
      if (!res.ok) {
        setSaveError(savedJson.error ?? "Failed to save order");
        if (rollbackPatch) onChanged(rollbackPatch);
        await load({ silent: true });
        return false;
      }

      if (savedJson.tagNotifyWarning) {
        onLinkCopied?.(savedJson.tagNotifyWarning);
      }

      // Soft-refresh column only after the PATCH lands so due date / title
      // on the board card aren't overwritten by a stale fetch.
      onChanged();

      // Local state already mirrors the save — skip a second full GET (~1–2s).
      if (options?.reload === true) {
        await load({ silent: true });
      }
      // Save button uses mousedown preventDefault so inputs keep focus for
      // the click — blur after success so the cursor leaves the field.
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
      return true;
    } finally {
      setSaving(false);
    }
  }

  function isDirty(): boolean {
    if (!userTouchedRef.current) return false;
    const b = ticketBaselineRef.current;
    if (!data || !b) return false;
    if (title !== b.title) return true;
    if (newNote.trim()) return true;
    if (productionNotes.trim()) return true;
    if (designerNote.trim()) return true;
    if (priority !== b.priority) return true;
    if (
      isApplicationCustomFieldOn(customFields, fieldValues) &&
      applicationDays !== b.applicationDays
    ) {
      return true;
    }
    if ((ownerId || "") !== (b.ownerId || "")) return true;
    if (isDueDateDirty()) return true;
    if ((tagId || "") !== (b.tagId || "")) return true;
    if ((designerId || "") !== (b.designerId || "")) return true;
    if ((designTask || "") !== (b.designTask || "")) return true;
    if (
      customerFacingNote.trim() !== String(b.customerFacingNote ?? "").trim()
    ) {
      return true;
    }
    if (customerName.trim() !== b.customerName.trim()) return true;
    if (customerContact.trim() !== b.customerContact.trim()) return true;

    const currentSkus = prepareSkusForSave(skus, { pendingArtworkIds: [] });
    if (JSON.stringify(currentSkus) !== JSON.stringify(b.skus)) return true;

    const formFields = resolved;
    for (const field of [
      ...formFields.printFields,
      ...(formFields.orderQtyField ? [formFields.orderQtyField] : []),
      ...(formFields.artworkField ? [formFields.artworkField] : []),
    ]) {
      if (
        !fieldValuesEqual(
          fieldValues[field.id],
          b.fieldValues[field.id],
          field.field_type
        )
      ) {
        return true;
      }
    }
    return false;
  }

  function revert() {
    if (data) applyDetail(data);
    setSaveError(null);
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

  async function archiveToSupabase() {
    if (!orderId) return;
    setArchiving(true);
    setArchiveError(null);
    setArchiveMessage(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/archive`, {
        method: "POST",
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        failureCount?: number;
      };
      if (!res.ok) {
        setArchiveError(json.error ?? "Failed to archive order");
        return;
      }
      setConfirmArchive(false);
      const parts = ["Saved to Settings → Archive → Stored archives."];
      if (json.failureCount) {
        parts.push(`${json.failureCount} file(s) could not be included.`);
      }
      setArchiveMessage(parts.join(" "));
    } catch {
      setArchiveError("Failed to archive order");
    } finally {
      setArchiving(false);
    }
  }

  async function downloadArchive() {
    if (!orderId) return;
    setDownloadingArchive(true);
    setArchiveError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/archive`);
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setArchiveError(json.error ?? "Failed to build archive");
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const fileName = match?.[1] ?? `${title || orderId}-archive.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setArchiveError("Failed to download archive");
    } finally {
      setDownloadingArchive(false);
    }
  }

  function markTicketTouched() {
    userTouchedRef.current = true;
  }

  function setFieldValue(fieldId: string, value: unknown) {
    markTicketTouched();
    setFieldValues((prev) => ({ ...prev, [fieldId]: value }));
  }

  /**
   * Persist designer immediately so the board updates when the ticket is closed
   * — without requiring a separate "Save changes" click.
   * Allowed on view-only tickets when {@link canEditDesigner} (same as due date).
   */
  async function assignDesigner(nextDesignerId: string) {
    if (!orderId || !data || !canEditDesigner) return;
    const prevId = designerId;
    const name =
      designers.find((d) => d.id === nextDesignerId)?.name ?? null;
    setDesignerId(nextDesignerId);
    setSaveError(null);

    // Keep patch operational-only when the full form is locked so CRM /
    // role-locked tickets don't trip form-edit permission checks via skus.
    const nextSpecs = isViewOnly
      ? {
          ...(data.order.specs ?? {}),
          designer_id: nextDesignerId || null,
          designer_name: name,
        }
      : {
          ...(data.order.specs ?? {}),
          skus: prepareSkusForSave(skus, { pendingArtworkIds: [] }),
          designer_id: nextDesignerId || null,
          designer_name: name,
        };

    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ specs: nextSpecs }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setDesignerId(prevId);
        setSaveError(json.error ?? "Failed to assign designer");
        return;
      }
      setData((prev) =>
        prev
          ? { ...prev, order: { ...prev.order, specs: nextSpecs } }
          : prev
      );
      if (ticketBaselineRef.current) {
        ticketBaselineRef.current = {
          ...ticketBaselineRef.current,
          designerId: nextDesignerId,
        };
      }
      onChanged({ specs: nextSpecs });
    } catch {
      setDesignerId(prevId);
      setSaveError("Failed to assign designer");
    }
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
        return "Enter SKU quantity (at least 1) before uploading images.";
      }

      // Upsert only this SKU — full-order PATCH validates every row and blocks
      // uploads when a sibling CRM SKU has a name but no quantity yet.
      const res = await fetch(`/api/orders/${orderId}/skus`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: sku.id,
          name: sku.name.trim(),
          qty: sku.qty,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        skus?: ReturnType<typeof prepareSkusForSave>;
      };
      if (!res.ok) {
        return json.error ?? "Failed to save SKU";
      }

      const savedSkus =
        json.skus ??
        prepareSkusForSave(
          [
            ...normalizeSkus(data?.order.specs?.skus).filter(
              (s) => s.id !== skuId
            ),
            { id: sku.id, name: sku.name.trim(), qty: sku.qty },
          ],
          { pendingArtworkIds: [] }
        );
      setPersistedSkuIds((prev) => new Set([...prev, skuId]));
      setSkus((prev) =>
        prev.map((s) =>
          s.id === skuId
            ? { id: sku.id, name: sku.name.trim(), qty: sku.qty }
            : s
        )
      );
      if (ticketBaselineRef.current) {
        ticketBaselineRef.current = {
          ...ticketBaselineRef.current,
          skus: savedSkus,
        };
      }
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

  const dueDateHint = useMemo(() => {
    if (!data?.order) return null;
    if (!isPendingAfterApprovalDue(data.order.due_date, data.order.specs)) {
      return null;
    }
    const label = formatOrderDueDisplay(null, data.order.specs, formatDate);
    return label === "—" ? null : label;
  }, [data?.order]);

  const ownersForForm = useMemo(() => {
    if (!ownerId || owners.some((o) => o.id === ownerId)) return owners;
    return [
      ...owners,
      { id: ownerId, name: "Previous owner (not account manager or admin)" },
    ];
  }, [owners, ownerId]);

  const pendingApproval = data?.approvals.find((a) => a.status === "pending");
  const orderColumn = data
    ? columns.find((c) => c.id === data.order.column_id)
    : undefined;
  const isInExceptionColumn = orderColumn?.kind === "exception";
  const hasMissingInfoNotes =
    (data?.missingInfo.length ?? 0) > 0 ||
    Boolean(data?.tabHints?.hasMissingInfo);
  const showMissingInfoTab = hasMissingInfoNotes || Boolean(isInExceptionColumn);
  const missingFieldsOnOrder =
    data && !isViewOnly
      ? getMissingFields(data.order, fieldValues, modalCustomFields)
      : [];
  const hasApproval =
    (data?.approvalNotes.length ?? 0) > 0 ||
    Boolean(data?.tabHints?.hasApproval);
  const hasShipping = Boolean(data?.shippingRequest);
  const sentMessageCount = data
    ? sentMessagesFromActivity(data.activity).length
    : 0;
  const orderContact = data
    ? customerContactFromOrder(data.order, fieldValues, modalCustomFields)
    : { email: null, phone: null };
  const orderTags = data ? orderTagsFromSpecs(data.order.specs) : [];

  function hasUnsavedTicketEdits(): boolean {
    if (!data) return false;
    if (!isViewOnly) return isDirty();
    return canEditDueDate && isDueDateDirty();
  }

  function handleClose() {
    if (saving || removing || archiving) return;
    if (confirmUnsaved || confirmRemove || confirmArchive) return;
    if (hasUnsavedTicketEdits()) {
      setConfirmUnsaved(true);
      return;
    }
    onClose();
  }

  async function saveAndClose() {
    const ok = await save();
    if (!ok) return;
    setConfirmUnsaved(false);
    onClose();
  }

  function discardAndClose() {
    revert();
    setConfirmUnsaved(false);
    onClose();
  }

  const displayOrderNumber = title.trim() || (data?.order.title ?? "").trim();
  /** Order number/title editable only on Manual tickets (CRM numbers stay fixed). */
  const showEditableManualTitle =
    Boolean(data?.order) &&
    canEditOrderTitle(role, data!.order) &&
    !isViewOnly;
  const itemNameDuplicatesTitle =
    itemName.trim().length > 0 &&
    itemName.trim().toLowerCase() === title.trim().toLowerCase();
  const showItemNameHeading =
    Boolean(data?.order) &&
    itemName.trim().length > 0 &&
    !(showEditableManualTitle && itemNameDuplicatesTitle);
  const customerLabel = customerName
    ? collapseDuplicatedLabel(customerName)
    : "";

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
      if (
        customerDropdownRef.current &&
        !customerDropdownRef.current.contains(e.target as Node)
      ) {
        setCustomerDropdownOpen(false);
      }
    }
    // Capture phase: Modal stops mousedown bubbling on the panel, so bubble
    // listeners on document never see clicks inside the ticket.
    document.addEventListener("mousedown", handleClickOutside, true);
    return () =>
      document.removeEventListener("mousedown", handleClickOutside, true);
  }, [customerDropdownOpen]);

  useEffect(() => {
    if (!smsOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (smsRef.current && !smsRef.current.contains(e.target as Node)) {
        setSmsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside, true);
    return () =>
      document.removeEventListener("mousedown", handleClickOutside, true);
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

  async function saveItemName() {
    if (!data?.order) return;
    const current = partCardTitle(data.order) ?? "";
    const next = itemName.trim();
    if (next === current.trim()) return;
    const nextSpecs: Record<string, unknown> = {
      ...(data.order.specs ?? {}),
      webhook_item_title: next || null,
    };
    // Single-item cards also show webhook_order_title — keep both in sync.
    if (typeof data.order.specs?.webhook_item_index !== "number") {
      nextSpecs.webhook_order_title = next || null;
    }
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ specs: nextSpecs }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setSaveError(json.error ?? "Failed to save item name");
        return;
      }
      setData((prev) =>
        prev ? { ...prev, order: { ...prev.order, specs: nextSpecs } } : prev
      );
      onChanged({ specs: nextSpecs });
    } catch {
      setSaveError("Failed to save item name");
    }
  }

  useEffect(() => {
    if (!editingItemName) return;
    const el = itemNameInputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editingItemName]);

  const [archivingBoard, setArchivingBoard] = useState(false);
  const isBoardArchived = data?.order.specs?.archived === true;

  /**
   * Archive a finished order OFF the active board (or restore it). Sets
   * specs.archived — the board hides archived orders from Kanban/List/Table and
   * from Late/Emergency counts, but keeps them searchable via the Archived
   * filter. Distinct from "Archive to Supabase" (a ZIP backup that leaves the
   * card on the board) and from "Delete Order" (removal).
   */
  async function toggleBoardArchive() {
    if (!data?.order || archivingBoard) return;
    const next = !isBoardArchived;
    const nextSpecs = {
      ...(data.order.specs ?? {}),
      archived: next || null,
      archived_at: next ? new Date().toISOString() : null,
    };
    setArchivingBoard(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ specs: nextSpecs }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setSaveError(json.error ?? "Failed to archive order");
        return;
      }
      setData((prev) =>
        prev ? { ...prev, order: { ...prev.order, specs: nextSpecs } } : prev
      );
      onChanged({ specs: nextSpecs });
    } catch {
      setSaveError("Failed to archive order");
    } finally {
      setArchivingBoard(false);
    }
  }

  const modalTitle = (
    <span className="flex min-w-0 flex-col items-start gap-0.5">
      {isViewOnly && showItemNameHeading ? (
        <span className="w-full min-w-0 whitespace-normal break-words text-[13px] font-semibold leading-snug text-slate-800">
          {itemName}
        </span>
      ) : null}
      {!isViewOnly && showItemNameHeading ? (
        editingItemName ? (
          <textarea
            ref={itemNameInputRef}
            value={itemName}
            onChange={(e) => setItemName(e.target.value)}
            onBlur={() => {
              void saveItemName();
              setEditingItemName(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.currentTarget as HTMLTextAreaElement).blur();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setItemName(
                  data?.order ? (partCardTitle(data.order) ?? "") : ""
                );
                setEditingItemName(false);
              }
            }}
            placeholder="Line item name"
            aria-label="Line item name"
            rows={1}
            className="max-w-full min-w-[8rem] resize-none rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[13px] font-semibold leading-snug text-slate-800 [field-sizing:content] [overflow-wrap:anywhere] focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300"
          />
        ) : (
          <span className="flex min-w-0 max-w-full items-start gap-1">
            <span
              className={cn(
                "min-w-0 whitespace-normal break-words text-[13px] font-semibold leading-snug",
                itemName.trim() ? "text-slate-800" : "text-slate-400"
              )}
            >
              {itemName.trim() || "Line item name"}
            </span>
            <button
              type="button"
              onClick={() => setEditingItemName(true)}
              className="mt-0.5 shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              title="Edit line item name"
              aria-label="Edit line item name"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </span>
        )
      ) : null}
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {/* Order number + copy — Manual titles are editable inline */}
        {showEditableManualTitle ? (
          <input
            type="text"
            value={title}
            onChange={(e) => {
              markTicketTouched();
              setTitle(e.target.value);
            }}
            placeholder="Order title"
            aria-label="Order title"
            className="w-full min-w-0 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-sm font-semibold leading-snug text-slate-800 [overflow-wrap:anywhere] focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300"
          />
        ) : (
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
        )}
        {showEditableManualTitle && displayOrderNumber ? (
          <button
            type="button"
            onClick={copyOrderNumber}
            className={cn(
              "inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs font-normal transition-colors",
              orderNumberCopied
                ? "text-emerald-600"
                : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            )}
            title="Copy title"
            aria-label="Copy title"
          >
            {orderNumberCopied ? "Copied" : <Copy className="h-3 w-3" aria-hidden />}
          </button>
        ) : null}
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
        {data?.order ? (
          <SourceChannelChip specs={data.order.specs} className="ml-1" />
        ) : null}
        {/* Customer name — dropdown with copy */}
        {customerLabel ? (
          <>
            <span className="text-slate-300">|</span>
            <div className="relative flex min-w-0 max-w-full items-center" ref={customerDropdownRef}>
              <button
                type="button"
                onClick={() => setCustomerDropdownOpen((v) => !v)}
                className="flex min-w-0 max-w-full items-center gap-1 rounded px-1 py-0.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-800"
              >
                <span className="min-w-0 truncate">{customerLabel}</span>
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
                        onClick={() => copyCustomerField(customerLabel, "name")}
                        className="group/copy flex min-w-0 items-center gap-1 text-right text-xs font-medium text-slate-700 hover:text-[var(--primary)]"
                      >
                        <span className="truncate">
                          {copiedCustomerField === "name" ? "Copied!" : customerLabel}
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
        {priority === "high" || priority === "urgent" ? (
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
    </span>
  );

  if (isLockedOut && data?.order) {
    return (
      <Modal open={open} onClose={handleClose} title="🔒 Locked order">
        <div className="space-y-3 p-4">
          <p className="text-sm text-slate-700">
            This order is locked{lockedByName ? ` by ${lockedByName}` : ""}. You can&apos;t open or
            edit it until the lock is removed.
          </p>
          {lockReason ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <span className="font-semibold">Reason: </span>
              {lockReason}
            </div>
          ) : null}
          <p className="text-xs text-slate-500">
            Only {lockedByName ?? "the person who locked it"} or an admin can remove this lock.
          </p>
        </div>
      </Modal>
    );
  }

  return (
    <>
    <CardWorkingPrompt orderId={orderId} open={open} />
    <CardSwitchTimerPrompt orderId={orderId} open={open} />
    <Modal
      open={open}
      onClose={handleClose}
      title={modalTitle}
      className={cn("max-w-3xl", saving && "cursor-wait")}
      overlayClassName={saving ? "cursor-wait" : undefined}
      headerAction={
        <div className="flex items-center gap-2">
          <OrderTimerButton
            orderId={orderId}
            role={role}
            columnKind={orderColumn?.kind}
            columnName={orderColumn?.name}
          />
          {!isViewOnly ? (
            <select
              value={ownerId}
              onChange={(e) => {
                markTicketTouched();
                setOwnerId(e.target.value);
              }}
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
          ) : null}
        </div>
      }
      footer={
        <>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {isAdmin && mode !== "view" ? (
              <button
                type="button"
                onClick={() => {
                  setRemoveError(null);
                  setConfirmRemove(true);
                }}
                disabled={
                  loading || saving || removing || archiving || downloadingArchive
                }
                className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-red-200 px-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                title="Remove order"
              >
                <Trash2 className="h-3.5 w-3.5 shrink-0" />
                Delete
              </button>
            ) : null}
            {orderId && data && mode !== "view" ? (
              <NudgeButton orderId={orderId} />
            ) : null}
            {orderId && data ? (
              isLocked ? (
                canUnlock ? (
                  <button
                    type="button"
                    onClick={() => void unlockOrder()}
                    disabled={lockBusy || loading || saving}
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-amber-300 bg-amber-50 px-2.5 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-40"
                    title={lockReason ? `Locked: ${lockReason}` : "Unlock this order"}
                  >
                    <Lock className="h-3.5 w-3.5 shrink-0" />
                    {lockBusy ? "Unlocking…" : "Unlock"}
                  </button>
                ) : (
                  <span className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-amber-200 bg-amber-50 px-2.5 text-sm font-medium text-amber-700" title={lockReason ?? undefined}>
                    <Lock className="h-3.5 w-3.5 shrink-0" />
                    Locked{lockedByName ? ` by ${lockedByName}` : ""}
                  </span>
                )
              ) : (
                <button
                  type="button"
                  onClick={() => void lockOrder()}
                  disabled={lockBusy || loading || saving}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 px-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  title="Lock this order so nobody works it by mistake"
                >
                  <Lock className="h-3.5 w-3.5 shrink-0" />
                  {lockBusy ? "Locking…" : "Lock"}
                </button>
              )
            ) : null}
            {orderId && data && isAdmin ? (
              <button
                type="button"
                onClick={() => {
                  setArchiveError(null);
                  setConfirmArchive(true);
                }}
                disabled={
                  loading || saving || removing || archiving || downloadingArchive
                }
                className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 px-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                title="Save ZIP to Supabase (Settings → Archive)"
              >
                {archiving ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                ) : (
                  <Archive className="h-3.5 w-3.5 shrink-0" />
                )}
                {archiving ? "Archiving…" : "Archive"}
              </button>
            ) : null}
            {orderId && data && mode !== "view" ? (
              <button
                type="button"
                onClick={() => void toggleBoardArchive()}
                disabled={
                  loading || saving || removing || archiving || archivingBoard
                }
                className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 px-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                title={
                  isBoardArchived
                    ? "Restore this order to the active board"
                    : "Hide this finished order from the active board (still searchable via the Archived filter)"
                }
              >
                {archivingBoard ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                ) : isBoardArchived ? (
                  <ArchiveRestore className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <Archive className="h-3.5 w-3.5 shrink-0" />
                )}
                {archivingBoard
                  ? "Saving…"
                  : isBoardArchived
                    ? "Restore"
                    : "Off board"}
              </button>
            ) : null}
            {orderId && data ? (
              <button
                type="button"
                onClick={() => void downloadArchive()}
                disabled={
                  loading || saving || removing || archiving || downloadingArchive
                }
                className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 px-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                title="Download ZIP with order data, history, and files"
              >
                {downloadingArchive ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5 shrink-0" />
                )}
                {downloadingArchive ? "Preparing…" : "Download"}
              </button>
            ) : null}
          </div>
          <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            {!isViewOnly && (isDirty() || saving) ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={revert}
                  type="button"
                  disabled={saving || removing || archiving || downloadingArchive}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void save()}
                  disabled={
                    saving ||
                    loading ||
                    removing ||
                    archiving ||
                    downloadingArchive
                  }
                  className={saving ? "cursor-wait" : undefined}
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    "Save changes"
                  )}
                </Button>
              </>
            ) : isViewOnly && canEditDueDate && (isDueDateDirty() || saving) ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={revert}
                  type="button"
                  disabled={saving || removing || archiving || downloadingArchive}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void save()}
                  disabled={
                    saving ||
                    loading ||
                    removing ||
                    archiving ||
                    downloadingArchive
                  }
                  className={saving ? "cursor-wait" : undefined}
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    "Save due date"
                  )}
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={handleClose}
                type="button"
                disabled={saving || removing || archiving || downloadingArchive}
              >
                Close
              </Button>
            )}
          </div>
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
              <button
                type="button"
                onClick={() => setTab("history")}
                className={cn(
                  "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  tab === "history"
                    ? "border-[var(--primary)] text-[var(--primary)]"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                )}
              >
                Com. History
                {sentMessageCount > 0 ? (
                  <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                    {sentMessageCount}
                  </span>
                ) : (
                  <span className="h-2 w-2 rounded-full bg-slate-300" />
                )}
              </button>
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
              onRequestApproval={
                onNotifyColumn
                  ? () => {
                      onNotifyColumn(
                        data.order,
                        {
                          column_id: data.order.column_id,
                          notify_type: "customer_approval",
                          automation_enabled: true,
                        },
                        orderColumn?.name ?? "Approval"
                      );
                    }
                  : undefined
              }
              onComplete={({ message, refreshOrder }) => {
                setSaveError(null);
                onLinkCopied?.(message);
                if (refreshOrder) {
                  void load({ silent: true }).then(() => {
                    if (
                      /shipment link|link sent/i.test(message)
                    ) {
                      setTab("shipping");
                    } else if (
                      /email sent|sms sent|texted|review/i.test(message)
                    ) {
                      setTab("history");
                    }
                  });
                  onChanged();
                }
              }}
              onError={(msg) => setSaveError(msg)}
            />
          ) : null}

          {tab === "details" && data ? (
            <div className="mb-3">
              <DesignReferenceBlock specs={data.order.specs} />
            </div>
          ) : null}

          {tab === "missing-info" && showMissingInfoTab ? (
            data.timelinePending && data.missingInfo.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
            ) : (
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
              onMoved={(columnId) => {
                setData((prev) =>
                  prev
                    ? {
                        ...prev,
                        order: { ...prev.order, column_id: columnId },
                      }
                    : prev
                );
                onChanged({ column_id: columnId });
              }}
            />
            )
          ) : tab === "approval" && hasApproval ? (
            data.timelinePending && data.approvalNotes.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
            ) : (
            <ApprovalTab
              notes={data.approvalNotes}
              customer={data.order.customer}
              orderId={data.order.id}
              sourceColumnId={data.order.column_id}
              columns={columns}
              contactEmail={orderContact.email}
              contactPhone={orderContact.phone}
              onChanged={(patch) => {
                if (patch?.column_id) {
                  setData((prev) =>
                    prev
                      ? {
                          ...prev,
                          order: {
                            ...prev.order,
                            column_id: patch.column_id!,
                          },
                        }
                      : prev
                  );
                  onChanged({ column_id: patch.column_id });
                  return;
                }
                load();
                onChanged();
              }}
            />
            )
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
              onShippingRequestUpdated={(next) => {
                setData((prev) =>
                  prev
                    ? {
                        ...prev,
                        shippingRequest: next,
                      }
                    : prev
                );
              }}
            />
          ) : tab === "history" ? (
            data.timelinePending && data.activity.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
            ) : (
            <HistoryTab
              orderId={data.order.id}
              activity={data.activity}
              orderNumber={data.order.title}
              customerName={
                customerName.trim() || data.order.customer?.name || null
              }
              productLabel={productFromOrder(fieldValues, modalCustomFields)}
              contactEmail={orderContact.email}
              contactPhone={orderContact.phone}
              appUrl={appUrl}
              notifications={data.notifications ?? [
                ...data.approvalNotes,
                ...data.missingInfo,
              ]}
              shippingRequest={data.shippingRequest}
            />
            )
          ) : (
        <div className="mt-4 grid min-w-0 grid-cols-1 gap-6 md:grid-cols-3">
          <div className="min-w-0 space-y-4 md:col-span-2">
            {editLockedReason ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {editLockedReason}
              </p>
            ) : null}
            {data?.order &&
            isComboOrder(data.order, fieldValues, modalCustomFields) ? (
              <ComboStockControl
                orderId={data.order.id}
                stock={getComboStock(data.order)}
                canManage={role === "admin" || role === "account_manager"}
                onChanged={(stock) => {
                  setData((prev) =>
                    prev
                      ? {
                          ...prev,
                          order: {
                            ...prev.order,
                            specs: {
                              ...(prev.order.specs ?? {}),
                              combo_stock: stock,
                            },
                          },
                        }
                      : prev
                  );
                  onChanged({
                    specs: {
                      ...(data.order.specs ?? {}),
                      combo_stock: stock,
                    },
                  });
                }}
              />
            ) : null}
            {data.order && isConnectedOrder(data.order) ? (
              <ConnectedSpecsSection
                order={data.order}
                onOrderPatch={(patch) => {
                  setData((prev) =>
                    prev
                      ? {
                          ...prev,
                          order: { ...prev.order, ...patch },
                        }
                      : prev
                  );
                  onChanged(patch);
                }}
              />
            ) : null}
            <OrderFormBody
              idPrefix="edit"
              hidePrintCustomFields={isConnectedOrder(data.order)}
              hideEmpty={
                data.order.webhook_source != null &&
                data.order.webhook_source !== ""
              }
              autoInferCategory={false}
              productSpecs={data.order.specs ?? null}
              onProductSpecChange={(key, value) => {
                markTicketTouched();
                setData((prev) =>
                  prev
                    ? {
                        ...prev,
                        order: {
                          ...prev.order,
                          specs: {
                            ...(prev.order.specs ?? {}),
                            spec_selections: {
                              ...((prev.order.specs?.spec_selections as Record<string, unknown>) ?? {}),
                              [key]: value,
                            },
                          },
                        },
                      }
                    : prev,
                );
              }}
              onProductToggleChange={(label, checked) => {
                markTicketTouched();
                setData((prev) => {
                  if (!prev) return prev;
                  const cur = Array.isArray(prev.order.specs?.product_options)
                    ? (prev.order.specs!.product_options as unknown[]).map(String)
                    : [];
                  const next = checked
                    ? cur.some((o) => o.toLowerCase() === label.toLowerCase())
                      ? cur
                      : [...cur, label]
                    : cur.filter((o) => o.toLowerCase() !== label.toLowerCase());
                  return {
                    ...prev,
                    order: {
                      ...prev.order,
                      specs: { ...(prev.order.specs ?? {}), product_options: next },
                    },
                  };
                });
              }}
              customFields={modalCustomFields}
              owners={ownersForForm}
              designers={designers}
              title={title}
              onTitleChange={(v) => {
                markTicketTouched();
                setTitle(v);
              }}
              hideOrderNumberField
              hidePriorityAndDueDateFields
              hideOwnerField
              hideCustomerSection
              priority={priority}
              onPriorityChange={(v) => {
                markTicketTouched();
                setPriority(v);
              }}
              ownerId={ownerId}
              onOwnerIdChange={(v) => {
                markTicketTouched();
                setOwnerId(v);
              }}
              noteHistory={noteHistory}
              internalNote={newNote}
              onInternalNoteChange={(v) => {
                markTicketTouched();
                setNewNote(v);
              }}
              productionNoteHistory={productionNoteHistory}
              productionNotes={productionNotes}
              onProductionNotesChange={(v) => {
                markTicketTouched();
                setProductionNotes(v);
              }}
              customerFacingNote={customerFacingNote}
              onCustomerFacingNoteChange={(v) => {
                markTicketTouched();
                setCustomerFacingNote(v);
              }}
              designerNoteHistory={designerNoteHistory}
              designerNote={designerNote}
              onDesignerNoteChange={(v) => {
                markTicketTouched();
                setDesignerNote(v);
              }}
              showAudienceNotes={role !== "member"}
              customerName={customerName}
              onCustomerNameChange={(v) => {
                markTicketTouched();
                setCustomerName(v);
              }}
              customerContact={customerContact}
              onCustomerContactChange={(v) => {
                markTicketTouched();
                setCustomerContact(v);
              }}
              designerId={designerId}
              onDesignerIdChange={(id) => void assignDesigner(id)}
              designTask={designTask}
              onDesignTaskChange={(v) => {
                markTicketTouched();
                setDesignTask(v);
              }}
              fieldValues={fieldValues}
              onFieldValueChange={setFieldValue}
              skus={skus}
              onSkusChange={(next) => {
                markTicketTouched();
                setSkus(next);
              }}
              dueDate={dueDate}
              onDueDateChange={(value) => {
                markTicketTouched();
                setDueDate(value);
                setSaveError(null);
              }}
              dueDateMode={dueDateMode}
              onDueDateModeChange={(mode) => {
                markTicketTouched();
                setDueDateMode(mode);
                if (mode === "after_approval") setDueDate("");
                setSaveError(null);
              }}
              dueProcessingDays={dueProcessingDays}
              onDueProcessingDaysChange={(days) => {
                markTicketTouched();
                setDueProcessingDays(days);
                setSaveError(null);
              }}
              previousDueDate={data.order.due_date}
              dueDateHint={dueDateHint}
              orderId={orderId ?? undefined}
              skuImagesBySkuId={skuImagesBySkuId}
              ensureSkuPersisted={ensureSkuPersisted}
              readOnly={isViewOnly}
              designerReadOnly={designerReadOnly}
              tags={tags}
              tagId={tagId}
              onTagIdChange={
                isViewOnly
                  ? undefined
                  : (v) => {
                      markTicketTouched();
                      setTagId(v);
                    }
              }
            />

            {saveError ? (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
                {saveError}
              </p>
            ) : null}
            {archiveError ? (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
                {archiveError}
              </p>
            ) : null}
            {archiveMessage ? (
              <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                {archiveMessage}
              </p>
            ) : null}
          </div>

          <div className="min-w-0 space-y-4">
            {(!isViewOnly && (isDirty() || saving)) ||
            (isViewOnly && canEditDueDate && (isDueDateDirty() || saving)) ? (
              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void save()}
                  disabled={saving || loading}
                  className={saving ? "cursor-wait" : undefined}
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving…
                    </>
                  ) : isViewOnly ? (
                    "Save due date"
                  ) : (
                    "Save changes"
                  )}
                </Button>
                <Button
                  variant="ghost"
                  onClick={revert}
                  type="button"
                  disabled={saving}
                >
                  Cancel
                </Button>
              </div>
            ) : null}
            <div className="min-w-0 overflow-hidden rounded-lg border border-slate-200 p-3">
              <Label htmlFor="sidebar-priority">Priority</Label>
              <Select
                id="sidebar-priority"
                value={priority}
                disabled={isViewOnly}
                onChange={(e) => {
                  markTicketTouched();
                  setPriority(e.target.value);
                }}
              >
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
            {isApplicationCustomFieldOn(customFields, fieldValues) ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Application
                </p>
                <ApplicationFields
                  idPrefix="sidebar"
                  applicationDays={applicationDays}
                  onApplicationDaysChange={(days) => {
                    markTicketTouched();
                    setApplicationDays(days);
                    setSaveError(null);
                  }}
                  dueDate={dateInputValue(dueDate)}
                  readOnly={isViewOnly}
                />
              </div>
            ) : null}
            <div className="min-w-0 overflow-hidden rounded-lg border border-slate-200 p-3">
              <DueDateFields
                idPrefix="sidebar"
                mode={dueDateMode}
                onModeChange={(mode) => {
                  markTicketTouched();
                  setDueDateMode(mode);
                  if (mode === "after_approval") setDueDate("");
                  setSaveError(null);
                }}
                dueDate={dateInputValue(dueDate)}
                onDueDateChange={(value) => {
                  markTicketTouched();
                  setDueDate(value);
                  setSaveError(null);
                }}
                processingDays={dueProcessingDays}
                onProcessingDaysChange={(days) => {
                  markTicketTouched();
                  setDueProcessingDays(days);
                  setSaveError(null);
                }}
                materializedDueDate={
                  dueDateMode === "after_approval"
                    ? dateInputValue(dueDate) || null
                    : null
                }
                minDueDate={localDateInputValue()}
                readOnly={dueDateReadOnly}
                hint={
                  dueDateHint &&
                  dueDateMode === "after_approval" &&
                  !dateInputValue(dueDate)
                    ? dueDateHint
                    : null
                }
              />
            </div>
            {tags.length > 0 ? (
              <div className="min-w-0 overflow-hidden rounded-lg border border-slate-200 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Tag
                </p>
                {!isViewOnly ? (
                  <select
                    value={tagId}
                    onChange={(e) => {
                      markTicketTouched();
                      setTagId(e.target.value);
                    }}
                    className="w-full min-w-0 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300"
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
                  if (destinationColumnId) {
                    setData((prev) =>
                      prev
                        ? {
                            ...prev,
                            order: {
                              ...prev.order,
                              column_id: destinationColumnId,
                            },
                          }
                        : prev
                    );
                    onChanged({ column_id: destinationColumnId });
                  } else {
                    void load({ silent: true });
                    onChanged();
                  }
                  if (data && onNotifyColumn && destinationColumnId) {
                    const notifyCol = notifyColumns.find(
                      (c) =>
                        c.column_id === destinationColumnId &&
                        c.automation_enabled
                    );
                    if (notifyCol) {
                      const destColumn = columns.find(
                        (c) => c.id === destinationColumnId
                      );
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

            <div className="min-w-0 overflow-hidden rounded-lg border border-slate-200">
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
                        <li key={log.id} className="min-w-0 break-words text-xs text-slate-500">
                          <span className="font-medium text-slate-700">
                            {describeActivity(log)}
                          </span>
                          <span className="block text-slate-400">
                            {formatDateTime(log.created_at)}
                            {` · ${log.actor_name}`}
                          </span>
                        </li>
                      ))}
                      {data.activity.length === 0 ? (
                        <li className="text-xs text-slate-400">No activity yet.</li>
                      ) : null}
                    </ul>
                  ) : (() => {
                    const moveEvents = data.activity
                      .filter((l) => isColumnMoveActivity(l))
                      .slice()
                      .reverse();
                    const createdAt = data.order.created_at;
                    const lastMove = moveEvents[moveEvents.length - 1];
                    const lastTo =
                      lastMove &&
                      (((lastMove.metadata ?? {}).toName as string | undefined) ||
                        ((lastMove.metadata ?? {}).to as string | undefined));
                    const currentStayMs = lastMove
                      ? Date.now() - new Date(lastMove.created_at).getTime()
                      : Date.now() - new Date(createdAt).getTime();
                    return (
                      <ul className="space-y-0 border-t border-slate-100 px-3 py-2">
                        {moveEvents.length === 0 ? (
                          <li className="text-xs text-slate-400">No column moves yet.</li>
                        ) : (
                          <>
                          {moveEvents.map((log, idx) => {
                            const prevTime = idx === 0
                              ? new Date(createdAt).getTime()
                              : new Date(moveEvents[idx - 1].created_at).getTime();
                            const duration = new Date(log.created_at).getTime() - prevTime;
                            const meta = log.metadata ?? {};
                            const from = (meta.fromName as string | undefined) ?? "—";
                            const to = (meta.toName as string | undefined) ?? "—";
                            return (
                              <li key={log.id} className="flex gap-2 pb-3 last:pb-0">
                                {/* Timeline spine */}
                                <div className="flex flex-col items-center">
                                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-slate-400" />
                                  <span className="mt-0.5 w-px flex-1 bg-slate-200" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-medium text-slate-700">
                                    {from}
                                    <span className="mx-1 text-slate-400">→</span>
                                    {to}
                                  </p>
                                  <p className="text-[11px] text-slate-400">
                                    {formatDateTime(log.created_at)}
                                    {` · ${log.actor_name}`}
                                  </p>
                                  <p className="text-[11px] text-slate-500">
                                    Stayed{" "}
                                    <span className="font-medium text-slate-700">
                                      {formatStayDuration(duration)}
                                    </span>{" "}
                                    in <span className="font-medium">{from}</span>
                                  </p>
                                </div>
                              </li>
                            );
                          })}
                          {lastTo ? (
                            <li className="flex gap-2 pb-0">
                              <div className="flex flex-col items-center">
                                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-medium text-slate-700">
                                  Now in {lastTo}
                                </p>
                                <p className="text-[11px] text-slate-500">
                                  Stayed{" "}
                                  <span className="font-medium text-slate-700">
                                    {formatStayDuration(currentStayMs)}
                                  </span>{" "}
                                  so far
                                </p>
                              </div>
                            </li>
                          ) : null}
                          </>
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

    {confirmUnsaved ? (
      <Modal
        open
        onClose={() => {
          if (!saving) setConfirmUnsaved(false);
        }}
        overlayClassName="z-[110]"
        title="Save changes?"
        footer={
          <>
            <Button
              variant="ghost"
              type="button"
              onClick={discardAndClose}
              disabled={saving}
            >
              Don&apos;t save
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                type="button"
                onClick={() => setConfirmUnsaved(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void saveAndClose()}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          This ticket has unsaved edits. Save them before closing, or discard
          them?
        </p>
        {saveError ? (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
            {saveError}
          </p>
        ) : null}
      </Modal>
    ) : null}

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

    {confirmArchive ? (
      <Modal
        open
        onClose={() => {
          if (!archiving) setConfirmArchive(false);
        }}
        title="Archive to Supabase"
        footer={
          <>
            <Button
              variant="ghost"
              type="button"
              onClick={() => setConfirmArchive(false)}
              disabled={archiving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void archiveToSupabase()}
              disabled={archiving}
            >
              {archiving ? "Archiving…" : "Archive order"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          Save a ZIP of <strong>{title || data?.order.title}</strong> (data,
          history, and files) to Supabase Storage? It will appear under Settings
          → Archive → Stored archives. The card stays on the board.
        </p>
        {archiveError ? (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
            {archiveError}
          </p>
        ) : null}
      </Modal>
    ) : null}
  </>
  );
}
