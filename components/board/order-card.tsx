"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Image from "next/image";
import {
  ChevronDown,
  ChevronUp,
  Clock,
  CreditCard,
  Car,
  CalendarClock,
  Flag,
  Boxes,
  Lock,
  MapPin,
  MoveRight,
  RefreshCw,
  Star,
  Tag,
  Truck,
  User,
  AlertTriangle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { fetchWithAuth } from "@/lib/fetch-with-auth";
import {
  preferCardImage,
  type BoardThumbnail,
} from "@/lib/card-image";
import {
  CARD_BADGE_LABELS,
  CARD_BADGE_STYLES,
  type CardNotificationBadge,
} from "@/lib/card-badges";
import { DIE_ALERT_CLASS, DIE_BOARD_STATUS_CLASS, type DieAlert, type DieBoardStatus } from "@/lib/die-request";
import {
  UNASSIGNED_DESIGNER_CARD_CLASS,
  ARTWORK_FIELD_NAME,
  PRIORITY_STYLES,
} from "@/lib/constants";
import type { ColumnKind } from "@/lib/types";
import {
  cardOrderQty,
  cardSkuCount,
  findOrderFormField,
} from "@/lib/order-form";
import {
  customerContactFromOrder,
  customerNameFromOrder,
} from "@/lib/notification-messages";
import {
  cn,
  dateInputValue,
  formatDateShort,
  localDateInputValue,
} from "@/lib/utils";
import { getComboStock, COMBO_STOCK_LABELS } from "@/lib/combo-stock";
import { dueDateStatus } from "@/lib/board-due-date";
import { ORDER_TAG_STYLES, orderTagsFromSpecs } from "@/lib/order-tags";
import { useGdriveFolderHasFiles } from "@/lib/use-gdrive-folder-has-files";
import {
  DEFAULT_PROCESSING_DAYS,
  type DueDateMode,
} from "@/lib/due-date";
import {
  formatShortOrderNumber,
} from "./order-number-label";
import { PriorityScoreBadge } from "./priority-score-badge";
import { QueueRankBadge } from "./queue-rank-badge";
import { DesignFlagChip } from "./design-reference";
import { isDesignerQueueColumnName } from "@/lib/designer-queue-columns";
import { useActiveTimer } from "@/components/time/active-timer-context";
import { CardTimerControl } from "./card-timer-control";
import { formatDuration } from "@/lib/time-tracking";
import { BoardWorkerChip } from "./board-worker-chip";
import {
  getActiveWarning,
  CARD_WARNING_BORDER_COLORS,
} from "@/lib/card-warning-rules";
import {
  EMERGENCY_SEVERITY_BORDER,
  EMERGENCY_SEVERITY_LABEL,
  type EmergencySeverity,
} from "@/lib/emergency-view";
import type {
  ButtonAutomation,
  CardWarningRule,
  CustomField,
  Designer,
  OrderTagSummary,
  OrderWithRelations,
  Role,
  Tag as BoardTag,
} from "@/lib/types";
import {
  PRIORITY_SCORES,
  priorityScoreFromSpecs,
  type PriorityScore,
} from "@/lib/order-priority-score";
import type { BoardShippingSign } from "@/lib/board-shipping";
import {
  shippingCardBorderColor,
  shippingTagClass,
} from "@/lib/board-shipping";
import type { WebhookSourceStyles } from "@/lib/webhook-source-styles";
import {
  effectiveWebhookSource,
  webhookSourceCardBackground,
} from "@/lib/webhook-source-styles";
import { MoveMenuSections } from "./move-menu-sections";
import { partCardTitle, sharedOrderTitle } from "@/lib/group-orders";
import { WebhookSourceLabel } from "./webhook-source-label";
import { OrderBillingGlobe } from "./order-billing-globe";
import { billingFromSpecs, hasBillingInfo } from "@/lib/order-billing";
import { ActionButton, type ActionButtonResult } from "./action-button";
import { OrderCardTimeChips } from "./order-card-time-chips";
import { ApplicationIcon } from "./application-icon";
import { isApplicationEnabled } from "@/lib/order-application";
import { isRushOrder } from "@/lib/order-rush";
import type { TimeChip } from "@/lib/time-chips";
import { formatDesignerLoadSuffix } from "@/lib/designer-load";

interface ColumnOption {
  id: string;
  name: string;
  color: string | null;
}

interface OrderCardProps {
  order: OrderWithRelations;
  /** When false the card can be opened but not dragged. */
  canDrag?: boolean;
  customFields?: CustomField[];
  fieldValues?: Record<string, unknown>;
  /** Signed URLs of all image assets — shown as a gallery in compact mode. */
  thumbnails?: BoardThumbnail[];
  /** Persist which gallery picture is shown on this card. */
  onCardThumbnailsChange?: (
    orderId: string,
    thumbnails: BoardThumbnail[]
  ) => void;
  /** Resolved designer display name (from specs or team list). */
  designerName?: string;
  /** Designers with live load counts — enables admin right-click assign. */
  designers?: Designer[];
  /** Persist designer assignment immediately (admin / account manager). */
  onAssignDesigner?: (designer: {
    id: string | null;
    name: string | null;
  }) => void;
  /** Board tags for right-click Tag menu (admin / pre-prod). */
  tags?: BoardTag[];
  /** Persist board tag from right-click menu. */
  onSetTag?: (tag: OrderTagSummary | null) => void;
  /** Persist priority score 1–5 (or null to clear) from right-click menu. */
  onSetPriorityScore?: (score: PriorityScore | null) => void;
  /** Toggle the Reprint mark on this order (right-click menu). */
  onSetReprint?: (on: boolean) => void;
  /** Toggle the Lock on this order (locked cards can't be moved). */
  onSetLocked?: (on: boolean) => void;
  /** Persist due date from right-click on the due chip. */
  onSetDueDate?: (update: {
    mode: DueDateMode;
    dueDate?: string | null;
    processingDays?: number | null;
  }) => void;
  /** Briefly emphasize this card after the detail modal closes. */
  highlighted?: boolean;
  notificationBadge?: CardNotificationBadge;
  ownerName?: string;
  /** ISO timestamp when the customer last approved artwork. */
  approvalDate?: string | null;
  /** Client shipping choice after they responded on the portal. */
  shippingSign?: BoardShippingSign;
  /** Alarm when the confirmed die due date is at risk. */
  dieAlert?: DieAlert;
  /** Die request lifecycle from /die-order. */
  dieStatus?: DieBoardStatus;
  groupSize?: number;
  warningRules?: CardWarningRule[];
  animateWarnings?: boolean;
  warningWorkingDays?: number[];
  /** Emergency-view severity for this card (amber/red/critical), or null. */
  emergencySeverity?: EmergencySeverity | null;
  /** Emergency reasons (worst first) shown in the corner-dot tooltip. */
  emergencyReasons?: string[];
  webhookSourceStyles?: WebhookSourceStyles;
  /** Column accent color (hex) — used to tint the customer name at 70% opacity. */
  columnColor?: string | null;
  /** Used to skip overdue badges in terminal (done) columns. */
  columnKind?: ColumnKind | null;
  /** Current board column name — used for column-specific card chrome. */
  columnName?: string | null;
  /**
   * When true, show van + date the card entered this column.
   * Prefer passing from Column; falls back to columnName matching.
   * Ignored when `timeChips` config is loaded.
   */
  showShippedEnteredDate?: boolean;
  /** Configurable time chips from Settings → Tags. */
  timeChips?: TimeChip[] | null;
  /** Columns the user is allowed to move this card to (pre-filtered by board). */
  availableColumns?: ColumnOption[];
  /** Called when the user selects a column from the right-click menu. */
  onMoveToColumn?: (order: OrderWithRelations, targetColumnId: string) => void;
  /** Admin-only automations visible for this card's column (shown by name). */
  actionButtons?: ButtonAutomation[];
  appUrl?: string;
  onActionComplete?: (
    order: OrderWithRelations,
    result: ActionButtonResult
  ) => void;
  onActionError?: (message: string) => void;
  onOpen: (order: OrderWithRelations) => void;
  /** When badge is rejected — open approval resend flow. */
  onResendApproval?: (order: OrderWithRelations) => void;
  /** Used to gate admin-only UI (e.g. billing globe). */
  role?: Role;
}

export function OrderCard({
  order,
  canDrag = true,
  customFields = [],
  fieldValues = {},
  thumbnails,
  onCardThumbnailsChange,
  designerName: designerNameProp,
  designers = [],
  onAssignDesigner,
  tags = [],
  onSetTag,
  onSetPriorityScore,
  onSetReprint,
  onSetLocked,
  onSetDueDate,
  highlighted = false,
  notificationBadge,
  ownerName,
  approvalDate = null,
  shippingSign,
  dieAlert,
  dieStatus,
  groupSize,
  emergencySeverity = null,
  emergencyReasons = [],
  warningRules = [],
  animateWarnings = true,
  warningWorkingDays = [1, 2, 3, 4, 5],
  webhookSourceStyles,
  columnColor,
  columnKind = null,
  columnName = null,
  showShippedEnteredDate,
  timeChips = null,
  availableColumns = [],
  onMoveToColumn,
  actionButtons = [],
  appUrl = "",
  onActionComplete,
  onActionError,
  onOpen,
  onResendApproval,
  role,
}: OrderCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: order.id,
    disabled: !canDrag || order.specs?.locked === true,
  });

  const orderQty = cardOrderQty(customFields, fieldValues, order.specs);
  const skuCount = cardSkuCount(order.specs);
  const customerName = customerNameFromOrder(
    order,
    fieldValues,
    customFields
  );
  const displayCustomerName =
    customerName === "there" ? null : customerName;
  const { email, phone } = customerContactFromOrder(
    order,
    fieldValues,
    customFields
  );

  const productField = findOrderFormField(customFields, "Product");
  const productName = productField
    ? String(fieldValues[productField.id] ?? "").trim()
    : "";

  const materialsField = findOrderFormField(customFields, "Materials");
  const materialsName = materialsField
    ? String(fieldValues[materialsField.id] ?? "").trim()
    : "";

  const finishingField = findOrderFormField(customFields, "Finishing");
  const finishingName = finishingField
    ? String(fieldValues[finishingField.id] ?? "").trim()
    : "";

  const specialEffectsField = findOrderFormField(
    customFields,
    "Special effects"
  );
  const specialEffectsName = specialEffectsField
    ? String(fieldValues[specialEffectsField.id] ?? "").trim()
    : "";

  const artworkField = findOrderFormField(customFields, ARTWORK_FIELD_NAME);
  const artworkUrl = artworkField
    ? String(fieldValues[artworkField.id] ?? "").trim()
    : "";
  const folderHasFiles = useGdriveFolderHasFiles(order.id, artworkUrl);

  const designerName =
    designerNameProp?.trim() ||
    (typeof order.specs?.designer_name === "string"
      ? order.specs.designer_name.trim()
      : "") ||
    null;

  // Designer queue rank (per-designer). Shown as a small #N badge on the card;
  // managers click it to re-rank. Only when the card has a designer + a position.
  const designerId =
    typeof order.specs?.designer_id === "string"
      ? order.specs.designer_id
      : null;
  const queueRank = (() => {
    if (!designerId) return null;
    // Only Start / In Progress cards carry a queue number.
    if (!isDesignerQueueColumnName(columnName)) return null;
    // Saved position wins (updates live after a manual re-rank); otherwise fall
    // back to the rank computed server-side at fetch time.
    const v = (order.specs as { designer_queue_pos?: unknown } | null)
      ?.designer_queue_pos;
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) return n + 1;
    return typeof order.queue_rank === "number" ? order.queue_rank : null;
  })();

  const isOwnerUnassigned = !order.created_by;

  const orderTags = orderTagsFromSpecs(order.specs);
  const hasApplication = isApplicationEnabled(
    order.specs,
    customFields,
    fieldValues
  );
  const isRush = isRushOrder(order);
  const isHighPriority =
    order.priority === "high" || order.priority === "urgent";
  const showRushChip = isRush || isHighPriority;
  const isReprint = order.specs?.reprint === true;
  const isLocked = order.specs?.locked === true;
  const isKeyAccount = order.specs?.is_key_account === true;
  const comboStock = getComboStock(order);
  const isDesignerUnassigned = !designerName;
  const activeWarning = getActiveWarning(order, warningRules, warningWorkingDays);
  const shippingBorderColor =
    !activeWarning ? shippingCardBorderColor(shippingSign) : null;
  const webhookSourceKey = effectiveWebhookSource(order);
  const webhookCardBg = webhookSourceCardBackground(
    webhookSourceKey,
    webhookSourceStyles
  );

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    ...(webhookCardBg ? { backgroundColor: webhookCardBg } : {}),
    // Emergency severity (if any) always wins the border color; else animated
    // warnings set border-color in keyframes so avoid an inline color fighting them.
    ...(emergencySeverity
      ? { borderColor: EMERGENCY_SEVERITY_BORDER[emergencySeverity] }
      : activeWarning && !animateWarnings
        ? { borderColor: CARD_WARNING_BORDER_COLORS[activeWarning.rule.color] }
        : !activeWarning && shippingBorderColor
          ? { borderColor: shippingBorderColor }
          : {}),
  };

  // Derive a 70%-opacity version of the column accent colour for the title.
  const titleColor = (() => {
    if (!columnColor) return undefined;
    const hex = columnColor.replace("#", "");
    if (hex.length !== 6) return undefined;
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r},${g},${b},0.7)`;
  })();

  // Right-click context menu (move / actions)
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [cardImageBusy, setCardImageBusy] = useState(false);

  // Right-click on designer chip (admin / account manager)
  const [designerMenuOpen, setDesignerMenuOpen] = useState(false);
  const [designerMenuPos, setDesignerMenuPos] = useState({ x: 0, y: 0 });
  const designerMenuRef = useRef<HTMLDivElement>(null);

  // Right-click on due date chip
  const [dueMenuOpen, setDueMenuOpen] = useState(false);
  const [dueMenuPos, setDueMenuPos] = useState({ x: 0, y: 0 });
  const [dueExactOpen, setDueExactOpen] = useState(false);
  const [dueExactValue, setDueExactValue] = useState("");
  const dueMenuRef = useRef<HTMLDivElement>(null);
  const dueExactChangedAtRef = useRef(0);

  async function showPicOnCard(index: number) {
    const list = thumbnails ?? [];
    const picked = list[index];
    if (!picked?.id || !onCardThumbnailsChange) return;
    const previous = list;
    const next = preferCardImage(list, {
      source: picked.source,
      id: picked.id,
    });
    onCardThumbnailsChange(order.id, next);
    setLightboxOpen(false);
    setCardImageBusy(true);
    try {
      const res = await fetchWithAuth(`/api/orders/${order.id}/card-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: picked.source, id: picked.id }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? "Failed to set card picture");
      }
    } catch {
      onCardThumbnailsChange(order.id, previous);
    } finally {
      setCardImageBusy(false);
    }
  }

  const hasMoveMenu =
    availableColumns.length > 0 && Boolean(onMoveToColumn);
  const hasActionMenu = actionButtons.length > 0;
  const canAssignDesigner = Boolean(onAssignDesigner) && designers.length > 0;
  const canSetTag = Boolean(onSetTag) && tags.length > 0;
  const canSetPriorityScore = Boolean(onSetPriorityScore);
  const canSetDueDate = Boolean(onSetDueDate);
  const canResendApproval =
    notificationBadge === "rejected" && Boolean(onResendApproval);
  const hasContextMenu =
    hasMoveMenu ||
    hasActionMenu ||
    canAssignDesigner ||
    canSetTag ||
    canSetPriorityScore ||
    Boolean(onSetReprint) ||
    Boolean(onSetLocked) ||
    canResendApproval;
  const [designerSubOpen, setDesignerSubOpen] = useState(false);
  const [tagSubOpen, setTagSubOpen] = useState(false);
  const [prioritySubOpen, setPrioritySubOpen] = useState(false);
  const currentPriorityScore = priorityScoreFromSpecs(order.specs);

  const dueExactOpenRef = useRef(false);
  dueExactOpenRef.current = dueExactOpen;

  useEffect(() => {
    if (!menuOpen && !designerMenuOpen && !dueMenuOpen)
      return;
    function closeDueMenu() {
      setDueMenuOpen(false);
      setDueExactOpen(false);
    }
    function isOutsideDueMenu(target: EventTarget | null) {
      return (
        Boolean(dueMenuRef.current) &&
        target instanceof Node &&
        !dueMenuRef.current!.contains(target)
      );
    }
    function handleClose(e: MouseEvent | KeyboardEvent) {
      if (e instanceof KeyboardEvent) {
        if (e.key === "Escape") {
          setMenuOpen(false);
          setDesignerMenuOpen(false);
          closeDueMenu();
        }
        return;
      }
      const target = e.target as Node;
      if (menuRef.current && !menuRef.current.contains(target)) {
        setMenuOpen(false);
      }
      if (
        designerMenuRef.current &&
        !designerMenuRef.current.contains(target)
      ) {
        setDesignerMenuOpen(false);
      }
      if (isOutsideDueMenu(target)) {
        // While Exact date is open, ignore mousedown — the native date
        // calendar is outside the menu DOM and would dismiss the picker.
        // Real "click away" is handled on click below.
        if (dueExactOpenRef.current) return;
        closeDueMenu();
      }
    }
    function handleDueClickAway(e: MouseEvent) {
      if (!dueExactOpenRef.current || !isOutsideDueMenu(e.target)) return;
      // Picking a day in the native calendar can synthesize a document click;
      // ignore those that land right after the input's onChange.
      if (Date.now() - dueExactChangedAtRef.current < 500) return;
      closeDueMenu();
    }
    document.addEventListener("mousedown", handleClose);
    document.addEventListener("keydown", handleClose);
    // click (not mousedown) so native date-picker day selection can finish
    document.addEventListener("click", handleDueClickAway, true);
    return () => {
      document.removeEventListener("mousedown", handleClose);
      document.removeEventListener("keydown", handleClose);
      document.removeEventListener("click", handleDueClickAway, true);
    };
  }, [menuOpen, designerMenuOpen, dueMenuOpen]);

  // Keep menus fully on-screen (flip up / shift left when near edges).
  useLayoutEffect(() => {
    if (!menuOpen || !menuRef.current) return;
    const el = menuRef.current;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let x = menuPos.x;
    let y = menuPos.y;
    if (x + rect.width > window.innerWidth - pad) {
      x = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (y + rect.height > window.innerHeight - pad) {
      y = Math.max(pad, window.innerHeight - rect.height - pad);
    }
    if (x !== menuPos.x || y !== menuPos.y) {
      setMenuPos({ x, y });
    }
  }, [
    menuOpen,
    menuPos.x,
    menuPos.y,
    hasActionMenu,
    hasMoveMenu,
    canAssignDesigner,
    canSetTag,
    canSetPriorityScore,
    canResendApproval,
    designerSubOpen,
    tagSubOpen,
    prioritySubOpen,
    actionButtons.length,
    availableColumns.length,
    designers.length,
    tags.length,
  ]);

  useLayoutEffect(() => {
    if (!designerMenuOpen || !designerMenuRef.current) return;
    const el = designerMenuRef.current;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let x = designerMenuPos.x;
    let y = designerMenuPos.y;
    if (x + rect.width > window.innerWidth - pad) {
      x = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (y + rect.height > window.innerHeight - pad) {
      y = Math.max(pad, window.innerHeight - rect.height - pad);
    }
    if (x !== designerMenuPos.x || y !== designerMenuPos.y) {
      setDesignerMenuPos({ x, y });
    }
  }, [designerMenuOpen, designerMenuPos.x, designerMenuPos.y, designers.length]);

  useLayoutEffect(() => {
    if (!dueMenuOpen || !dueMenuRef.current) return;
    const el = dueMenuRef.current;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let x = dueMenuPos.x;
    let y = dueMenuPos.y;
    if (x + rect.width > window.innerWidth - pad) {
      x = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (y + rect.height > window.innerHeight - pad) {
      y = Math.max(pad, window.innerHeight - rect.height - pad);
    }
    if (x !== dueMenuPos.x || y !== dueMenuPos.y) {
      setDueMenuPos({ x, y });
    }
  }, [dueMenuOpen, dueExactOpen, dueMenuPos.x, dueMenuPos.y]);

  function handleContextMenu(e: React.MouseEvent) {
    if (!hasContextMenu) return;
    e.preventDefault();
    e.stopPropagation();
    setDesignerMenuOpen(false);
    setDueMenuOpen(false);
    setDueExactOpen(false);
    setDesignerSubOpen(false);
    setTagSubOpen(false);
    setPrioritySubOpen(false);
    setMenuPos({ x: e.clientX, y: e.clientY });
    setMenuOpen(true);
  }

  function handleDesignerContextMenu(e: React.MouseEvent) {
    if (!canAssignDesigner) return;
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(false);
    setDueMenuOpen(false);
    setDueExactOpen(false);
    setDesignerMenuPos({ x: e.clientX, y: e.clientY });
    setDesignerMenuOpen(true);
  }

  function handleDueContextMenu(e: React.MouseEvent) {
    if (!canSetDueDate) return;
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(false);
    setDesignerMenuOpen(false);
    setDueExactOpen(false);
    setDueExactValue(
      dateInputValue(order.due_date) || localDateInputValue()
    );
    setDueMenuPos({ x: e.clientX, y: e.clientY });
    setDueMenuOpen(true);
  }

  function applyDueUpdate(update: {
    mode: DueDateMode;
    dueDate?: string | null;
    processingDays?: number | null;
  }) {
    onSetDueDate?.(update);
    setDueMenuOpen(false);
    setDueExactOpen(false);
  }

  // The card's own line-item title (falls back to product for untitled parts).
  const cardTitle = partCardTitle(order, productName);
  // Drop empty and placeholder ("None"/"N/A") spec values so their separators
  // aren't rendered either.
  const cleanSpec = (value: string | null | undefined): string | null => {
    const trimmed = (value ?? "").trim();
    return trimmed && !/^(none|n\/a)$/i.test(trimmed) ? trimmed : null;
  };
  // One clean detail line: material · lamination · special effects · qty · SKU.
  const detailParts = [
    cleanSpec(materialsName),
    cleanSpec(finishingName),
    cleanSpec(specialEffectsName),
    orderQty != null ? `qty ${orderQty}` : null,
    skuCount > 0 ? `${skuCount} SKU` : null,
  ].filter(Boolean) as string[];

  const dueStatus = dueDateStatus(order.due_date, {
    inDoneColumn: columnKind === "done",
    specs: order.specs,
  });
  const dueLabel = order.due_date
    ? formatDateShort(order.due_date)
    : dueStatus.kind === "pending_approval"
      ? dueStatus.label
      : "—";
  const ownerLabel = isOwnerUnassigned
    ? "Unassigned"
    : ownerName?.trim() || "—";
  const designerLabel = designerName ?? "Unassigned";

  // Live work timer for this card (this user). Only an actively-running timer
  // colors the card green; paused (jumped to another job) leaves it colorless
  // so the board shows at a glance what's actually being worked on right now.
  const activeTimer = useActiveTimer();
  const orderTimer = activeTimer.forOrder(order.id);
  const workedSeconds = activeTimer.workedTotalForOrder(order.id);
  // Any user actively working this card (shown to everyone who can see it).
  const boardTimer = activeTimer.boardActiveForOrder(order.id);
  const otherWorker = boardTimer && !boardTimer.isMine ? boardTimer : null;
  // Total time anyone has spent on this job — always shown so how long a card
  // took is visible on the board without opening it.
  const boardWorkedSeconds = activeTimer.boardWorkedTotalForOrder(order.id);
  // Admins + account managers can pause/stop another person's timer.
  const canControlOthers = role === "admin" || role === "account_manager";
  const timerRunning = (orderTimer?.running ?? false) || (otherWorker?.running ?? false);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...(canDrag ? listeners : {})}
      onClick={() => onOpen(order)}
      onContextMenu={handleContextMenu}
      className={cn(
        "group relative @container shrink-0 overflow-hidden rounded-md border-2",
        activeWarning && animateWarnings && !highlighted
          ? ""
          : "shadow-sm transition-shadow hover:shadow-md",
        isDesignerUnassigned && !webhookCardBg
          ? UNASSIGNED_DESIGNER_CARD_CLASS
          : isDesignerUnassigned
            ? "border-amber-300 hover:border-amber-400"
            : webhookCardBg
              ? ""
              : "bg-white",
        !emergencySeverity && !shippingBorderColor && !activeWarning
          ? "border-slate-200"
          : "",
        canDrag ? "cursor-pointer" : "cursor-default",
        activeWarning && animateWarnings && !highlighted
          ? `warning-${activeWarning.rule.color}`
          : "",
        highlighted && "card-just-closed",
        // Only an actively-running timer colors the card; paused stays neutral.
        timerRunning && "!border-emerald-500 !bg-emerald-100 ring-2 ring-emerald-300"
      )}
      data-order-card=""
      data-order-id={order.id}
    >
      {/* padded content wrapper */}
      <div className="px-3 py-3.5">
      <CardTimerControl
        orderId={order.id}
        timer={orderTimer}
        workedSeconds={workedSeconds}
        busy={activeTimer.busyOrderId === order.id}
        onStart={() => void activeTimer.start(order.id)}
        onPause={(reason) => orderTimer && void activeTimer.pause(orderTimer.entry.id, reason)}
        onResume={() => orderTimer && void activeTimer.resume(orderTimer.entry.id)}
        onStop={() => orderTimer && void activeTimer.stop(orderTimer.entry.id)}
      />
      {otherWorker ? (
        <BoardWorkerChip
          workerName={otherWorker.workerName}
          running={otherWorker.running}
          elapsedSeconds={otherWorker.elapsedSeconds}
          canControl={canControlOthers}
          busy={activeTimer.busyOrderId === order.id}
          onPause={() => void activeTimer.pause(otherWorker.entryId)}
          onResume={() => void activeTimer.resume(otherWorker.entryId)}
          onStop={() => void activeTimer.stop(otherWorker.entryId)}
        />
      ) : null}
      {boardWorkedSeconds > 0 ? (
        <span
          className="mb-1.5 mr-1.5 inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600 tabular-nums"
          title="Total time worked on this job (everyone)"
        >
          <Clock className="h-3 w-3" />
          {formatDuration(boardWorkedSeconds)}
        </span>
      ) : null}
      {emergencySeverity ? (
        <span
          className="absolute right-2 top-2 z-10 h-2.5 w-2.5 rounded-full ring-2 ring-white"
          style={{ backgroundColor: EMERGENCY_SEVERITY_BORDER[emergencySeverity] }}
          title={`${EMERGENCY_SEVERITY_LABEL[emergencySeverity]}${
            emergencyReasons.length ? " — " + emergencyReasons.join(" · ") : ""
          }`}
        />
      ) : activeWarning ? (
        <span
          className={`warning-dot-${activeWarning.rule.color} absolute right-2 top-2 z-10 h-2.5 w-2.5 rounded-full`}
          title={`${activeWarning.rule.name}: card hasn't moved in ${activeWarning.daysSinceMoved} working day${activeWarning.daysSinceMoved === 1 ? "" : "s"}`}
        />
      ) : null}
      {/* Top row: thumbnail + header info */}
      <div className="flex items-start gap-2.5">
        {thumbnails && thumbnails.length > 0 ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setLightboxOpen(true);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="relative h-20 w-20 shrink-0 overflow-hidden rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            aria-label={`View pictures for ${order.title}`}
            title={
              thumbnails.length > 1
                ? `View pictures (${thumbnails.length})`
                : "View picture"
            }
          >
            <Image
              src={thumbnails[0].url}
              alt=""
              width={80}
              height={80}
              className="h-20 w-20 object-cover"
              unoptimized
            />
            {thumbnails.length > 1 ? (
              <span className="absolute bottom-0.5 right-0.5 rounded bg-black/65 px-1 py-px text-[9px] font-semibold tabular-nums text-white">
                {thumbnails.length}
              </span>
            ) : null}
            {/* Order # overlaid on the image — frees the title line for the item name. */}
            <span className="pointer-events-none absolute left-0.5 top-0.5 max-w-[calc(100%-4px)] truncate rounded bg-black/70 px-1 py-px text-[10px] font-bold leading-tight tabular-nums text-white">
              {formatShortOrderNumber(order.title)}
              {groupSize != null && groupSize >= 2 ? ` (${groupSize})` : ""}
            </span>
          </button>
        ) : null}

        <div className="min-w-0 flex-1">
          {/* 1) Order/part # + item title  2) Customer  3) Spec detail */}
          <div className="min-w-0 w-full text-left">
            <WebhookSourceLabel
              webhookSource={webhookSourceKey}
              sourceStyles={webhookSourceStyles}
              orderTitle={sharedOrderTitle(order)}
            />
            <div className="mb-0.5 flex w-full min-w-0 flex-wrap items-start justify-start gap-1.5 text-left">
              <span
                className={cn(
                  "inline-flex shrink-0 items-center justify-start gap-1.5 text-left text-[15px] font-bold leading-none",
                  folderHasFiles ? "text-emerald-600" : "text-slate-900"
                )}
                title={
                  folderHasFiles
                    ? `Final production folder has files (${order.title})`
                    : order.title
                }
              >
                {currentPriorityScore != null ? (
                  <PriorityScoreBadge score={currentPriorityScore} />
                ) : null}
                {queueRank != null ? (
                  <QueueRankBadge
                    orderId={order.id}
                    rank={queueRank}
                    canEdit={canAssignDesigner}
                  />
                ) : null}
                <DesignFlagChip specs={order.specs} />
                {!(thumbnails && thumbnails.length > 0) ? (
                  <span className="truncate leading-snug">
                    {formatShortOrderNumber(order.title)}
                    {groupSize != null && groupSize >= 2 ? (
                      <span
                        className={cn(
                          "font-normal",
                          folderHasFiles
                            ? "text-emerald-500/80"
                            : "text-slate-400"
                        )}
                      >
                        {" "}
                        ({groupSize})
                      </span>
                    ) : null}
                  </span>
                ) : null}
                {hasApplication ? (
                  <ApplicationIcon
                    className="h-3.5 w-3.5 shrink-0 text-slate-500"
                    title="Application"
                  />
                ) : null}
                {isRush ? (
                  <span
                    className="inline-flex shrink-0 items-center"
                    title="Rush order"
                  >
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                  </span>
                ) : null}
                {isReprint ? (
                  <span
                    className="shrink-0 rounded bg-amber-100 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-amber-700"
                    title="Reprint"
                  >
                    Reprint
                  </span>
                ) : null}
                {isLocked ? (
                  <span
                    className="inline-flex shrink-0 items-center gap-0.5 rounded bg-red-100 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-red-700"
                    title="Locked — can't be moved"
                  >
                    <Lock className="h-2.5 w-2.5" />
                    Locked
                  </span>
                ) : null}
                {isKeyAccount ? (
                  <span
                    className="inline-flex shrink-0 items-center"
                    title="Key account"
                  >
                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" />
                  </span>
                ) : null}
                {comboStock ? (
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-px text-[9px] font-bold uppercase tracking-wide",
                      comboStock.status === "in_stock" &&
                        "bg-emerald-100 text-emerald-700",
                      comboStock.status === "ordered" &&
                        "bg-blue-100 text-blue-700",
                      comboStock.status === "pending" &&
                        "bg-amber-100 text-amber-700",
                      comboStock.status === "cant_get" &&
                        "bg-red-100 text-red-700"
                    )}
                    title={COMBO_STOCK_LABELS[comboStock.status]}
                  >
                    <Boxes className="h-2.5 w-2.5" />
                    {comboStock.status === "in_stock"
                      ? "In stock"
                      : comboStock.status === "ordered"
                        ? "Ordered"
                        : comboStock.status === "cant_get"
                          ? "No stock"
                          : "Stock?"}
                  </span>
                ) : null}
              </span>
              {cardTitle ? (
                <>
                  {!(thumbnails && thumbnails.length > 0) ? (
                    <span className="shrink-0 text-slate-300" aria-hidden>
                      ·
                    </span>
                  ) : null}
                  <span
                    className="min-w-0 flex-1 whitespace-normal break-words text-left text-[15px] font-bold leading-snug text-slate-900"
                  >
                    {cardTitle}
                  </span>
                </>
              ) : null}
            </div>
            {displayCustomerName ? (
              <span className="inline-flex max-w-full items-center justify-start text-left text-[15px] font-bold leading-snug text-slate-900">
                <span className="min-w-0 truncate">{displayCustomerName}</span>
              </span>
            ) : null}
            {detailParts.length > 0 ||
            (role === "admin" &&
              hasBillingInfo(billingFromSpecs(order.specs))) ? (
              <p
                lang="en"
                className="mt-1 w-full pr-1 text-left text-[11.5px] font-medium leading-snug text-slate-700 [hyphens:auto] [overflow-wrap:break-word] [word-break:normal]"
              >
                {detailParts.length > 0 ? (
                  <span>
                    {detailParts.join(" · ")}
                    {role === "admin" &&
                    hasBillingInfo(billingFromSpecs(order.specs)) ? (
                      <>
                        {" "}
                        <OrderBillingGlobe
                          specs={order.specs}
                          role={role}
                          className="inline-flex align-middle"
                        />
                      </>
                    ) : null}
                  </span>
                ) : (
                  <OrderBillingGlobe
                    specs={order.specs}
                    role={role}
                    className="inline-flex align-middle"
                  />
                )}
              </p>
            ) : null}
          </div>

          {/* Staff meta — skip unassigned owner/designer; hide Rush when it is no */}
          <p className="mt-1.5 w-full text-left text-[11px] leading-snug text-slate-600">
            {!isOwnerUnassigned ? (
              <>
                <span className="whitespace-nowrap text-slate-600">
                  <span className="font-medium text-slate-500">Owner:</span>{" "}
                  {ownerLabel}
                </span>
                <span className="text-slate-300"> · </span>
              </>
            ) : null}
            {!isDesignerUnassigned ? (
              <>
                <span className="whitespace-nowrap text-slate-600">
                  <span className="font-medium text-slate-500">Designer:</span>{" "}
                  {designerLabel}
                </span>
                <span className="text-slate-300"> · </span>
              </>
            ) : null}
            <span>
              <span className="font-medium text-slate-500">Due:</span>{" "}
              {dueLabel}
            </span>
            {showRushChip ? (
              <>
                <span className="text-slate-300"> · </span>
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[10px] font-semibold",
                    isHighPriority
                      ? PRIORITY_STYLES[order.priority]
                      : "bg-amber-100 text-amber-800"
                  )}
                >
                  <AlertTriangle className="h-3 w-3" />
                  Rush
                  {isHighPriority ? ` · ${order.priority}` : ""}
                </span>
              </>
            ) : null}
            {dieStatus ? (
              <>
                <span className="text-slate-300"> · </span>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-semibold",
                    DIE_BOARD_STATUS_CLASS[dieStatus.status]
                  )}
                  title={
                    dieStatus.status === "ordered"
                      ? `${dieStatus.label} delivery date`
                      : dieStatus.label
                  }
                >
                  {dieStatus.label}
                </span>
              </>
            ) : null}
            {dieAlert ? (
              <>
                <span className="text-slate-300"> · </span>
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[10px] font-semibold",
                    DIE_ALERT_CLASS[dieAlert.level]
                  )}
                  title={`Confirmed die due ${dieAlert.confirmedDueDate}`}
                >
                  <AlertTriangle className="h-3 w-3" />
                  {dieAlert.label}
                </span>
              </>
            ) : null}
          </p>

          {shippingSign ? (
            <div className="mt-1.5 flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                  shippingTagClass(shippingSign)
                )}
                title={shippingSign.title}
              >
                {shippingSign.kind === "awaiting" ? (
                  <Clock className="h-3 w-3" />
                ) : shippingSign.kind === "payment_pending" ? (
                  <CreditCard className="h-3 w-3" />
                ) : shippingSign.kind === "pickup" ? (
                  <MapPin className="h-3 w-3" />
                ) : shippingSign.kind === "uber" ||
                  shippingSign.kind === "curri" ? (
                  <Car className="h-3 w-3" />
                ) : (
                  <Truck className="h-3 w-3" />
                )}
                {shippingSign.label}
              </span>
            </div>
          ) : null}
        </div>
      </div>

      {/* Divider — full card width */}
      <div className="mt-2.5 border-t border-slate-100" />

      {/* Dates + priority — configurable time chips */}
      <OrderCardTimeChips
        order={order}
        columnId={order.column_id}
        columnName={columnName}
        columnKind={columnKind}
        chips={timeChips}
        approvalDate={approvalDate}
        warningWorkingDays={warningWorkingDays}
        showShippedEnteredDate={showShippedEnteredDate}
        onDueContextMenu={canSetDueDate ? handleDueContextMenu : undefined}
      />

      {/* Footer — full-width row; each chip gets flex-1 so all chips together = 100% card width */}
      <div className="mt-2 flex w-full items-stretch overflow-hidden rounded-full text-[clamp(9px,3.1cqi,11px)]">
        {notificationBadge && orderTags.length === 0 ? (
          <span
            className={cn(
              "flex flex-1 min-w-0 items-center justify-center px-1.5 py-0.5 font-medium",
              CARD_BADGE_STYLES[notificationBadge]
            )}
          >
            <span className="truncate">{CARD_BADGE_LABELS[notificationBadge]}</span>
          </span>
        ) : null}
        {orderTags.map((tag) => (
          <span
            key={tag}
            className={cn(
              "flex flex-1 min-w-0 items-center justify-center px-1.5 py-0.5 font-medium",
              ORDER_TAG_STYLES[tag] ??
                "bg-slate-100 text-slate-600"
            )}
          >
            <span className="truncate">{tag}</span>
          </span>
        ))}
        {!isDesignerUnassigned ? (
          <span
            className={cn(
              "flex flex-1 min-w-0 items-center justify-center gap-0.5 px-1.5 py-0.5 font-semibold",
              "bg-[var(--primary)]/10 text-[var(--primary)]",
              canAssignDesigner && "cursor-context-menu"
            )}
            title={
              canAssignDesigner
                ? "Right-click to assign designer"
                : "Assigned designer"
            }
            onContextMenu={handleDesignerContextMenu}
            onPointerDown={(e) => {
              if (canAssignDesigner) e.stopPropagation();
            }}
          >
            <User className="h-[1em] w-[1em] shrink-0 text-[var(--primary)]" />
            <span className="min-w-0 truncate">{designerName}</span>
          </span>
        ) : null}
        {!isOwnerUnassigned && ownerName ? (
          <span
            className="flex flex-1 min-w-0 items-center justify-center gap-0.5 px-1.5 py-0.5 font-semibold bg-slate-100 text-slate-500"
            title="Order owner"
          >
            <User className="h-[1em] w-[1em] shrink-0 text-slate-400" />
            <span className="min-w-0 truncate">{ownerName}</span>
          </span>
        ) : null}
      </div>

      </div>{/* end padded content wrapper */}

      {/* Full-width tag footer bar — bar height fixed; font −20% from 13px */}
      {order.tag ? (
        <div
          style={{ backgroundColor: order.tag.color ?? "#e2e8f0" }}
          className="flex h-[14.3px] w-full items-center justify-center overflow-hidden text-[10.4px] font-medium leading-none tracking-wide text-white"
        >
          {order.tag.name}
        </div>
      ) : null}

      {/* Right-click: actions / assign designer / move (portaled — card has overflow + dnd transform) */}
      {menuOpen && hasContextMenu
        ? createPortal(
            <div
              ref={menuRef}
              style={{
                top: menuPos.y,
                left: menuPos.x,
                maxHeight: "calc(100dvh - 16px)",
              }}
              className="fixed z-[80] flex min-w-[12rem] max-w-[min(18rem,calc(100vw-16px))] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onContextMenu={(e) => e.preventDefault()}
            >
              {canResendApproval ? (
                <div
                  className={cn(
                    "shrink-0 py-1",
                    (hasActionMenu ||
                      hasMoveMenu ||
                      canAssignDesigner ||
                      canSetTag ||
                      canSetPriorityScore) &&
                      "border-b border-slate-100"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onResendApproval?.(order);
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <RefreshCw className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="flex-1 whitespace-nowrap">
                      Resend Approve Request
                    </span>
                  </button>
                </div>
              ) : null}
              {hasActionMenu ? (
                <div className="shrink-0 border-b border-slate-100 py-1">
                  {actionButtons.map((btn) => (
                    <ActionButton
                      key={btn.id}
                      appearance="menu"
                      button={btn}
                      orderId={order.id}
                      orderNumber={order.title}
                      appUrl={appUrl}
                      groupSize={groupSize}
                      customerEmail={email ?? order.customer?.email}
                      customerPhone={phone ?? order.customer?.phone}
                      productLabel={productName || null}
                      onRequestApproval={
                        onResendApproval
                          ? () => {
                              onResendApproval(order);
                              setMenuOpen(false);
                            }
                          : undefined
                      }
                      onComplete={(result) => {
                        setMenuOpen(false);
                        onActionComplete?.(order, result);
                      }}
                      onError={(message) => onActionError?.(message)}
                    />
                  ))}
                </div>
              ) : null}
              {canAssignDesigner ? (
                <div
                  className={cn(
                    "shrink-0 py-1",
                    (hasMoveMenu ||
                      hasActionMenu ||
                      canSetTag ||
                      canSetPriorityScore) &&
                      "border-b border-slate-100"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setDesignerSubOpen((v) => !v);
                      setTagSubOpen(false);
                      setPrioritySubOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <User className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="flex-1 whitespace-nowrap">
                      Assign designer
                    </span>
                    {designerSubOpen ? (
                      <ChevronUp className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    )}
                  </button>
                  {designerSubOpen ? (
                    <div className="max-h-48 overflow-y-auto border-t border-slate-100 bg-slate-50/80 py-1">
                      <button
                        type="button"
                        onClick={() => {
                          onAssignDesigner?.({ id: null, name: null });
                          setMenuOpen(false);
                          setDesignerSubOpen(false);
                        }}
                        className="flex w-full px-3 py-1.5 pl-8 text-left text-sm text-slate-600 hover:bg-slate-100"
                      >
                        Unassigned
                      </button>
                      {designers.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => {
                            onAssignDesigner?.({ id: d.id, name: d.name });
                            setMenuOpen(false);
                            setDesignerSubOpen(false);
                          }}
                          className="flex w-full items-center justify-between gap-2 px-3 py-1.5 pl-8 text-left text-sm text-slate-700 hover:bg-slate-100"
                        >
                          <span className="truncate">{d.name}</span>
                          <span className="shrink-0 tabular-nums text-slate-400">
                            {formatDesignerLoadSuffix(d.load, d.skuCount)}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {canSetTag ? (
                <div
                  className={cn(
                    "shrink-0 py-1",
                    (hasMoveMenu || canSetPriorityScore) &&
                      "border-b border-slate-100"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setTagSubOpen((v) => !v);
                      setDesignerSubOpen(false);
                      setPrioritySubOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <Tag className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="flex-1 whitespace-nowrap">Tag</span>
                    {order.tag?.name ? (
                      <span className="max-w-[6rem] truncate text-xs text-slate-400">
                        {order.tag.name}
                      </span>
                    ) : null}
                    {tagSubOpen ? (
                      <ChevronUp className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    )}
                  </button>
                  {tagSubOpen ? (
                    <div className="max-h-48 overflow-y-auto border-t border-slate-100 bg-slate-50/80 py-1">
                      <button
                        type="button"
                        onClick={() => {
                          onSetTag?.(null);
                          setMenuOpen(false);
                          setTagSubOpen(false);
                        }}
                        className={cn(
                          "flex w-full px-3 py-1.5 pl-8 text-left text-sm hover:bg-slate-100",
                          !order.tag_id
                            ? "font-medium text-slate-900"
                            : "text-slate-600"
                        )}
                      >
                        None
                      </button>
                      {tags.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => {
                            onSetTag?.({
                              id: t.id,
                              name: t.name,
                              color: t.color,
                            });
                            setMenuOpen(false);
                            setTagSubOpen(false);
                          }}
                          className={cn(
                            "flex w-full items-center gap-2 px-3 py-1.5 pl-8 text-left text-sm hover:bg-slate-100",
                            order.tag_id === t.id
                              ? "font-medium text-slate-900"
                              : "text-slate-700"
                          )}
                        >
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full border border-slate-200"
                            style={{ backgroundColor: t.color ?? "#e2e8f0" }}
                          />
                          <span className="truncate">{t.name}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {canSetPriorityScore ? (
                <div
                  className={cn(
                    "shrink-0 py-1",
                    hasMoveMenu && "border-b border-slate-100"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setPrioritySubOpen((v) => !v);
                      setDesignerSubOpen(false);
                      setTagSubOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <Flag className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="flex-1 whitespace-nowrap">Priority</span>
                    {currentPriorityScore != null ? (
                      <span className="tabular-nums text-xs text-slate-400">
                        {currentPriorityScore}
                      </span>
                    ) : null}
                    {prioritySubOpen ? (
                      <ChevronUp className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    )}
                  </button>
                  {prioritySubOpen ? (
                    <div className="max-h-48 overflow-y-auto border-t border-slate-100 bg-slate-50/80 py-1">
                      <button
                        type="button"
                        onClick={() => {
                          onSetPriorityScore?.(null);
                          setMenuOpen(false);
                          setPrioritySubOpen(false);
                        }}
                        className={cn(
                          "flex w-full px-3 py-1.5 pl-8 text-left text-sm hover:bg-slate-100",
                          currentPriorityScore == null
                            ? "font-medium text-slate-900"
                            : "text-slate-600"
                        )}
                      >
                        None
                      </button>
                      {PRIORITY_SCORES.map((score) => (
                        <button
                          key={score}
                          type="button"
                          onClick={() => {
                            onSetPriorityScore?.(score);
                            setMenuOpen(false);
                            setPrioritySubOpen(false);
                          }}
                          className={cn(
                            "flex w-full px-3 py-1.5 pl-8 text-left text-sm tabular-nums hover:bg-slate-100",
                            currentPriorityScore === score
                              ? "font-medium text-slate-900"
                              : "text-slate-700"
                          )}
                        >
                          {score}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {onSetReprint ? (
                <button
                  type="button"
                  onClick={() => {
                    onSetReprint(!isReprint);
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100"
                >
                  <RefreshCw className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                  {isReprint ? "Remove reprint mark" : "Mark as reprint"}
                </button>
              ) : null}
              {onSetLocked ? (
                <button
                  type="button"
                  onClick={() => {
                    onSetLocked(!isLocked);
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100"
                >
                  <Lock className="h-3.5 w-3.5 shrink-0 text-red-600" />
                  {isLocked ? "Unlock card" : "Lock card (no move)"}
                </button>
              ) : null}
              {hasMoveMenu ? (
                <>
                  <p className="flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    <MoveRight className="h-3 w-3" />
                    Move to
                  </p>
                  <div className="min-h-0 flex-1 overflow-y-auto py-1">
                    <MoveMenuSections
                      columns={availableColumns}
                      onSelect={(col) => {
                        onMoveToColumn?.(order, col.id);
                        setMenuOpen(false);
                      }}
                    />
                  </div>
                </>
              ) : null}
            </div>,
            document.body
          )
        : null}

      {/* Right-click designer chip: assign designer */}
      {designerMenuOpen && canAssignDesigner
        ? createPortal(
            <div
              ref={designerMenuRef}
              style={{ top: designerMenuPos.y, left: designerMenuPos.x }}
              className="fixed z-[80] max-h-[min(20rem,calc(100dvh-16px))] w-max min-w-[12rem] max-w-[min(18rem,calc(100vw-16px))] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onContextMenu={(e) => e.preventDefault()}
            >
              <p className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                <User className="h-3 w-3" />
                Assign designer
              </p>
              <button
                type="button"
                onClick={() => {
                  onAssignDesigner?.({ id: null, name: null });
                  setDesignerMenuOpen(false);
                }}
                className="flex w-full px-3 py-1.5 text-left text-sm text-slate-600 hover:bg-slate-50"
              >
                Unassigned
              </button>
              {designers.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => {
                    onAssignDesigner?.({ id: d.id, name: d.name });
                    setDesignerMenuOpen(false);
                  }}
                  className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                >
                  <span className="truncate">{d.name}</span>
                  <span className="shrink-0 tabular-nums text-slate-400">
                    {formatDesignerLoadSuffix(d.load, d.skuCount)}
                  </span>
                </button>
              ))}
            </div>,
            document.body
          )
        : null}

      {/* Right-click due chip: Fixed after approval / Exact date */}
      {dueMenuOpen && canSetDueDate
        ? createPortal(
            <div
              ref={dueMenuRef}
              style={{ top: dueMenuPos.y, left: dueMenuPos.x }}
              className="fixed z-[80] w-max min-w-[12rem] max-w-[min(18rem,calc(100vw-16px))] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-xl"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onContextMenu={(e) => e.preventDefault()}
            >
              <p className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                <CalendarClock className="h-3 w-3" />
                Due date
              </p>
              <button
                type="button"
                onClick={() =>
                  applyDueUpdate({
                    mode: "after_approval",
                    dueDate: null,
                    processingDays: DEFAULT_PROCESSING_DAYS,
                  })
                }
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                Fixed {DEFAULT_PROCESSING_DAYS} days after approval
              </button>
              {!dueExactOpen ? (
                <button
                  type="button"
                  onClick={() => setDueExactOpen(true)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                >
                  Exact date…
                </button>
              ) : (
                <div className="space-y-2 border-t border-slate-100 px-3 py-2">
                  <input
                    type="date"
                    value={dueExactValue}
                    min={localDateInputValue()}
                    onChange={(e) => {
                      dueExactChangedAtRef.current = Date.now();
                      setDueExactValue(e.target.value);
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-800 outline-none focus:border-slate-400"
                    autoFocus
                  />
                  <button
                    type="button"
                    disabled={!dueExactValue.trim()}
                    onClick={() => {
                      if (!dueExactValue.trim()) return;
                      applyDueUpdate({
                        mode: "fixed",
                        dueDate: dueExactValue.trim(),
                      });
                    }}
                    className="w-full rounded-md bg-slate-800 px-2 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Set date
                  </button>
                </div>
              )}
            </div>,
            document.body
          )
        : null}

      {lightboxOpen && thumbnails && thumbnails.length > 0 ? (
        <ImageLightbox
          images={thumbnails.map((thumb, i) => ({
            src: thumb.url,
            label: `${order.title} · ${i + 1}/${thumbnails.length}`,
          }))}
          initialIndex={0}
          onClose={() => setLightboxOpen(false)}
          onShowOnCard={
            onCardThumbnailsChange
              ? (index) => {
                  void showPicOnCard(index);
                }
              : undefined
          }
          showOnCardBusy={cardImageBusy}
          cardImageIndex={0}
        />
      ) : null}
    </div>
  );
}
