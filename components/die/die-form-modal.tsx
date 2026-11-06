"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  Circle,
  FileText,
  FileUp,
  PackagePlus,
  Package,
  PenTool,
  Shapes,
  Square,
  Send,
  Tag,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { RequiredDatePicker } from "@/components/die/required-date-picker";
import { dieManufacturerLabel, type DieManufacturer } from "@/lib/die-manufacturers";
import {
  DIE_PAST_DATE_ERROR,
  dieTodayYmd,
  isDieDatePast,
  dieRequestFiles,
  formatDieQuotedPrice,
  type DieRequest,
} from "@/lib/die-request";
import { Modal } from "@/components/ui/modal";
import { DieOrderPicker } from "@/components/die/die-order-picker";
import { formatShortOrderNumber } from "@/lib/board-order-filters";
import {
  DIE_SHAPE_LABEL,
  DIE_SHAPES,
  DIE_TYPE_LABEL,
  DIE_TYPES,
  diePdfError,
  type Die,
  type DieShape,
  type DieType,
} from "@/lib/dies";
import { cn } from "@/lib/utils";

type Icon = ComponentType<{ className?: string }>;

const DIE_TYPE_ICON: Record<DieType, Icon> = {
  label: Tag,
  paper: FileText,
  box: Package,
  other: Shapes,
};

const DIE_SHAPE_ICON: Record<DieShape, Icon> = {
  square: Square,
  round: Circle,
  custom: PenTool,
};

/** die_requests stores displayed L × W × H in legacy width × height × depth columns. */
function setRequestDimensions(
  form: FormData,
  dimensions: { length: string; width: string; height: string }
) {
  form.set("width", dimensions.length);
  form.set("height", dimensions.width);
  form.set("depth", dimensions.height);
}

function DieTypePicker({
  value,
  onChange,
}: {
  value: DieType;
  onChange: (v: DieType) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Die type" className="mt-1 grid grid-cols-4 gap-1.5">
      {DIE_TYPES.map((opt) => {
        const Icon = DIE_TYPE_ICON[opt];
        const on = value === opt;
        return (
          <button
            key={opt}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(opt)}
            className={cn(
              "inline-flex h-10 items-center justify-center gap-1.5 rounded-md border px-2 text-sm font-medium transition-colors",
              on
                ? "border-blue-600 bg-blue-50 text-blue-700"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            )}
          >
            <Icon className={cn("h-4 w-4 shrink-0", on ? "text-blue-600" : "text-slate-400")} />
            {DIE_TYPE_LABEL[opt]}
          </button>
        );
      })}
    </div>
  );
}

/** Filled shapes, so Square doesn't look like an empty checkbox. */
function shapeIconClass(shape: DieShape, on: boolean): string {
  return cn(
    "h-4 w-4 shrink-0",
    on ? "text-blue-600" : "text-slate-500",
    shape !== "custom" && (on ? "fill-blue-200" : "fill-slate-300")
  );
}

/** Dropdown with an icon per shape (a native <select> can't show icons). */
function ShapeSelect({
  value,
  onChange,
}: {
  value: DieShape;
  onChange: (v: DieShape) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  // Float the list over everything (the popup body scrolls and would clip it);
  // open upward when there's no room below.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    function place() {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const height = listRef.current?.offsetHeight ?? 120;
      const below = r.bottom + 4;
      const above = r.top - 4 - height;
      const top = below + height > window.innerHeight - 8 && above >= 8 ? above : below;
      setPos({ top, left: r.left, width: r.width });
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !listRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  const Current = DIE_SHAPE_ICON[value];
  return (
    <div ref={ref} className="relative mt-1">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Shape: ${DIE_SHAPE_LABEL[value]}`}
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-full items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-left text-sm text-slate-800 hover:bg-slate-50 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
      >
        <Current className={shapeIconClass(value, false)} />
        <span className="flex-1">{DIE_SHAPE_LABEL[value]}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
      </button>
      {open && typeof document !== "undefined" ? createPortal(
        <ul
          ref={listRef}
          role="listbox"
          aria-label="Shape"
          className="fixed z-[200] overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg"
          style={{
            top: pos?.top ?? -9999,
            left: pos?.left ?? 0,
            width: pos?.width,
            visibility: pos ? "visible" : "hidden",
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {DIE_SHAPES.map((opt) => {
            const Icon = DIE_SHAPE_ICON[opt];
            const on = opt === value;
            return (
              <li key={opt} role="option" aria-selected={on}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(opt);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50",
                    on ? "font-semibold text-blue-700" : "text-slate-700"
                  )}
                >
                  <Icon className={shapeIconClass(opt, on)} />
                  <span className="flex-1">{DIE_SHAPE_LABEL[opt]}</span>
                  {on ? <Check className="h-4 w-4 text-blue-600" /> : null}
                </button>
              </li>
            );
          })}
        </ul>,
        document.body
      ) : null}
    </div>
  );
}

function CheckOption({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "flex h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors",
        checked
          ? "border-blue-600 bg-blue-50 text-blue-700"
          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
      )}
    >
      <input
        type="checkbox"
        className="h-4 w-4 accent-blue-600"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

function dieHistoryTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  });
}

function DieHistoryPanel({ request }: { request: DieRequest }) {
  const files = dieRequestFiles(request);
  const stages = [
    {
      label: "Created",
      at: request.created_at,
      detail: "Die request created.",
    },
    {
      label: "Sent to manufacturer",
      at: request.sent_at,
      detail: `Sent to ${request.manufacturer_name ?? request.to_email}.`,
    },
    {
      label: "Priced",
      at: request.quoted_at,
      detail:
        request.quoted_at && request.quoted_price != null
          ? `${formatDieQuotedPrice(request.quoted_price)}${
              request.time_estimate ? ` · ${request.time_estimate}` : ""
            }`
          : null,
    },
    {
      label: "Confirmed",
      at: request.ordered_at,
      detail: request.ordered_at ? "Final order sent to manufacturer." : null,
    },
    {
      label: "Received",
      at: request.received_at,
      detail: request.received_at ? "Die received by the shop." : null,
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Attached files
        </p>
        {files.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {files.map((file, index) => (
              <a
                key={`${file.path}-${index}`}
                href={`/api/die/${request.token}/file?i=${index}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex max-w-64 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-slate-100"
              >
                <FileText className="h-4 w-4 shrink-0" />
                <span className="truncate">{file.name}</span>
              </a>
            ))}
          </div>
        ) : (
          <p className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-500">
            No files are attached to this request.
          </p>
        )}
      </div>

      <ol>
        {stages.map((stage, index) => (
          <li key={stage.label} className="relative flex gap-3 pb-5 last:pb-0">
            {index < stages.length - 1 ? (
              <span className="absolute left-[7px] top-4 h-full w-px bg-slate-200" />
            ) : null}
            <span
              className={cn(
                "relative mt-1 h-4 w-4 shrink-0 rounded-full border-2",
                stage.at
                  ? "border-blue-600 bg-blue-600"
                  : "border-slate-300 bg-white"
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className={cn("font-semibold", stage.at ? "text-slate-900" : "text-slate-400")}>
                  {stage.label}
                </p>
                <p className="text-xs text-slate-500">
                  {stage.at ? dieHistoryTime(stage.at) : "Pending"}
                </p>
              </div>
              {stage.detail ? (
                <p className="mt-0.5 text-sm text-slate-600">{stage.detail}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function DieFormModal({
  die,
  onClose,
  onSaved,
  onDeleted,
  requestCount = 0,
  manufacturers = [],
  historyRequest = null,
}: {
  /** Edit this die; omit for "+ Add Die". */
  die?: Die | null;
  onClose: () => void;
  onSaved: (
    die: Die,
    created: boolean,
    result?: { sent: boolean; warning: string | null }
  ) => void;
  manufacturers?: DieManufacturer[];
  historyRequest?: DieRequest | null;
  onDeleted?: (die: Die) => void;
  /** Quote requests already sent for this die (they are kept on delete). */
  requestCount?: number;
}) {
  const editing = Boolean(die);
  // "+ Add Die" first asks: add a die we have, or order a new one.
  const [intent, setIntent] = useState<"add" | "order" | null>(
    editing ? "add" : null
  );
  // Manufacturer / date fields: ordering a new die, or editing its request.
  const ordering = intent === "order" || Boolean(historyRequest);
  const [maxUses, setMaxUses] = useState(die?.max_uses != null ? String(die.max_uses) : "");
  const [location, setLocation] = useState(die?.location ?? "");
  const [name, setName] = useState(die?.name ?? "");
  const [dieType, setDieType] = useState<DieType>(die?.die_type ?? "box");
  const [orderId, setOrderId] = useState<string | null>(die?.order_id ?? null);
  const [orderLabel, setOrderLabel] = useState<string | null>(
    die?.order_title ? formatShortOrderNumber(die.order_title) : null
  );
  const [templateName, setTemplateName] = useState(die?.pacdora_template_name ?? "");
  const [link, setLink] = useState(die?.pacdora_link ?? "");
  const [length, setLength] = useState(die?.length != null ? String(die.length) : "");
  const [width, setWidth] = useState(die?.width != null ? String(die.width) : "");
  const [height, setHeight] = useState(die?.height != null ? String(die.height) : "");
  const [shape, setShape] = useState<DieShape>(die?.shape ?? "square");
  const [rounded, setRounded] = useState(die?.rounded_corner ?? false);
  const [perforation, setPerforation] = useState(die?.perforation ?? false);
  const [saving, setSaving] = useState<"draft" | "send" | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [manufacturerId, setManufacturerId] = useState(
    historyRequest?.manufacturer_id ??
      die?.manufacturer_id ??
      manufacturers[0]?.id ??
      ""
  );
  const [requiredDate, setRequiredDate] = useState(
    historyRequest?.required_date ?? ""
  );
  const [orderDue, setOrderDue] = useState<string | null>(null);
  const [allowOwnDate, setAllowOwnDate] = useState(
    historyRequest?.allow_own_date ?? false
  );
  const [activeTab, setActiveTab] = useState<"details" | "history">("details");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The popup body scrolls: bring a new error into view so it isn't missed.
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [error]);
  // Set when "Send order" saved the die but the order failed (retry reuses it).
  const [savedDie, setSavedDie] = useState<Die | null>(null);
  function close() {
    if (savedDie) {
      // Leaving after a failed send: the die stays in Dies without an order.
      onSaved(savedDie, true, {
        sent: false,
        warning: `the order wasn't sent, so ${savedDie.template_code} was saved to Dies without one`,
      });
      return;
    }
    onClose();
  }
  const [preview, setPreview] = useState<{ code: string; qrDataUrl: string } | null>(null);

  // "+ Add Die": show the Template ID + QR this die will get, before saving.
  useEffect(() => {
    if (die) return;
    let cancelled = false;
    fetch("/api/dies/next-code", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { code?: string; qrDataUrl?: string } | null) => {
        if (!cancelled && json?.code && json.qrDataUrl) {
          setPreview({ code: json.code, qrDataUrl: json.qrDataUrl });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [die]);

  const headerCode = die?.template_code ?? preview?.code ?? null;
  const TypeIcon = DIE_TYPE_ICON[dieType];
  // Header shows only the sizes filled in so far ("2.5 × 3.5"); nothing when none.
  const filledSizes = [length, width, height].filter((v) => Number(v) > 0);
  const sizeLabel = filledSizes.length ? filledSizes.join(" × ") : null;
  const headerQr = die ? `/api/dies/${die.id}/qr` : preview?.qrDataUrl ?? null;

  async function save(mode: "draft" | "send") {
    setError(null);
    if (!name.trim()) return setError("Die name is required.");
    if (pdfFile) {
      const bad = diePdfError(pdfFile);
      if (bad) return setError(bad);
    }
    if (mode === "send") {
      if (!manufacturerId) return setError("Pick a die manufacturer to send.");
      if (!orderId) return setError("Pick the order this die is for to send it.");
      if (!requiredDate) return setError("Pick a required date to send.");
      if (isDieDatePast(requiredDate)) {
        return setError(`Required date is in the past. ${DIE_PAST_DATE_ERROR}`);
      }
    }
    setSaving(mode);
    try {
      // 1. Save the die (draft).
      // After a failed send the die already exists: update it, don't make a second one.
      const existingId = die?.id ?? savedDie?.id ?? null;
      const res = await fetch(existingId ? `/api/dies/${existingId}` : "/api/dies", {
        method: existingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          die_type: dieType,
          order_id: orderId,
          pacdora_template_name: templateName,
          pacdora_link: link,
          length,
          width,
          height,
          shape,
          rounded_corner: rounded,
          perforation,
          manufacturer_id: ordering ? manufacturerId || null : die?.manufacturer_id ?? null,
          max_uses: maxUses.trim() || null,
          location: location.trim() || null,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        die?: Die;
        warning?: string | null;
      };
      if (!res.ok || !json.die) throw new Error(json.error ?? "Failed to save die");
      let saved = json.die;
      const warnings: string[] = [];
      if (json.warning) warnings.push(json.warning.replace(/^The /, "the "));

      // 2. Attach the PDF.
      if (pdfFile) {
        const form = new FormData();
        form.set("file", pdfFile);
        const up = await fetch(`/api/dies/${saved.id}/file`, { method: "POST", body: form });
        const upJson = (await up.json().catch(() => ({}))) as { error?: string; die?: Die };
        if (up.ok && upJson.die) saved = upJson.die;
        else warnings.push(`the PDF didn't upload (${upJson.error ?? "unknown error"})`);
      }

      // Editing from the Requests tab updates the existing request too, rather
      // than creating a second quote request for the same die.
      if (historyRequest) {
        const form = new FormData();
        form.set("manufacturerId", manufacturerId);
        form.set("productName", name.trim());
        setRequestDimensions(form, { length, width, height });
        form.set("requiredDate", requiredDate);
        form.set("allowOwnDate", allowOwnDate ? "true" : "false");
        form.set("comment", historyRequest.comment ?? "");
        const update = await fetch(`/api/die-requests/${historyRequest.id}`, {
          method: "PATCH",
          body: form,
        });
        const updateJson = (await update.json().catch(() => ({}))) as {
          error?: string;
        };
        if (!update.ok) {
          throw new Error(
            updateJson.error ?? "The die saved, but the request did not update."
          );
        }
      }

      // 3. Send the quote request (the die's PDF goes with it).
      let sent = false;
      if (mode === "send" && !historyRequest) {
        const form = new FormData();
        form.set("orderId", orderId!);
        form.set("dieId", saved.id);
        form.set("manufacturerId", manufacturerId);
        form.set("productName", name.trim());
        setRequestDimensions(form, { length, width, height });
        form.set("requiredDate", requiredDate);
        form.set("allowOwnDate", allowOwnDate ? "true" : "false");
        form.set("comment", "");
        // A new die waits on the Requests tab until it's received.
        if (!editing) form.set("newDieOrder", "true");
        const req = await fetch("/api/die-requests", { method: "POST", body: form });
        const reqJson = (await req.json().catch(() => ({}))) as {
          error?: string;
          warning?: string | null;
        };
        if (req.ok) {
          sent = true;
          if (reqJson.warning) warnings.push(`the message didn't go out (${reqJson.warning})`);
        } else if (!editing) {
          // Keep the popup open: fix the problem and press Send order again
          // (the same die is reused, so no duplicate Template ID).
          setSavedDie(saved);
          setError(
            `${saved.template_code} is saved, but the order wasn't sent: ${reqJson.error ?? "unknown error"}. Fix it and press Send order again.`
          );
          return;
        } else {
          warnings.push(`the request wasn't sent (${reqJson.error ?? "unknown error"})`);
        }
      }
      onSaved(saved, !editing && !savedDie ? true : !editing, {
        sent,
        warning: warnings.length ? warnings.join("; ") : null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save die");
    } finally {
      setSaving(null);
    }
  }

  async function remove() {
    if (!die) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/dies/${die.id}`, { method: "DELETE" });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to delete die");
      onDeleted?.(die);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete die");
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Modal
      open
      fitViewport
      onClose={close}
      className="max-w-2xl"
      title={
        editing
          ? `Edit die · ${die!.template_code}`
          : intent === "order"
            ? "Order a new die"
            : intent === "add"
              ? "Add a die"
              : "Add die"
      }
      footer={
        <>
          {historyRequest ? (
            <span />
          ) : editing && confirmDelete ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-red-700">
                Delete {die!.template_code}?
                {requestCount > 0
                  ? ` Its ${requestCount} quote request${requestCount === 1 ? "" : "s"} will stay.`
                  : ""}
              </span>
              <Button
                type="button"
                className="bg-red-600 hover:bg-red-700"
                onClick={() => void remove()}
                disabled={deleting}
              >
                {deleting ? "Deleting…" : "Yes, delete"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
              >
                Keep
              </Button>
            </div>
          ) : editing ? (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="text-sm font-semibold text-red-600 hover:text-red-800"
              >
                Delete die
              </button>
            </div>
          ) : (
            <span />
          )}
          <div className={cn("flex gap-2", confirmDelete && "hidden")}>
            {!editing && intent ? (
              <Button type="button" variant="secondary" onClick={() => setIntent(null)}>
                Back
              </Button>
            ) : null}
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
            {intent === "add" || historyRequest ? (
              <Button
                type="button"
                onClick={() => void save("draft")}
                disabled={saving !== null}
              >
                {saving === "draft" ? "Saving…" : editing ? "Save" : "Add die"}
              </Button>
            ) : null}
            {intent === "order" && !historyRequest ? (
              <Button
                type="button"
                onClick={() => void save("send")}
                disabled={saving !== null || manufacturers.length === 0}
                className="inline-flex items-center gap-1.5"
                title={manufacturers.length === 0 ? "Add a die manufacturer in Settings first" : undefined}
              >
                <Send className="h-4 w-4" />
                {saving === "send" ? "Sending…" : "Send order"}
              </Button>
            ) : null}
          </div>
        </>
      }
    >
      <form
        className="space-y-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save("draft");
        }}
      >
        {!intent ? (
          <div className="grid gap-3 py-2 sm:grid-cols-2">
            {(
              [
                {
                  key: "add",
                  icon: PackagePlus,
                  title: "Add a die",
                  body: "We already have this die. Save it to the Dies list with its QR code, max uses and details.",
                },
                {
                  key: "order",
                  icon: Send,
                  title: "Order a new die",
                  body: "Ask a manufacturer to make it. It waits on the Requests tab and joins the Dies list when you mark it received.",
                },
              ] as const
            ).map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setIntent(option.key)}
                  className="flex flex-col items-start gap-2 rounded-xl border-2 border-slate-200 bg-white p-5 text-left transition-colors hover:border-blue-500 hover:bg-blue-50/40"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="text-base font-semibold text-slate-900">{option.title}</span>
                  <span className="text-sm text-slate-600">{option.body}</span>
                </button>
              );
            })}
          </div>
        ) : null}
        {historyRequest ? (
          <div className="flex border-b border-slate-200" role="tablist">
            {(["details", "history"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "-mb-px border-b-2 px-4 py-2 text-sm font-semibold capitalize",
                  activeTab === tab
                    ? "border-blue-600 text-blue-700"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                )}
              >
                {tab}
              </button>
            ))}
          </div>
        ) : null}
        <div
          className={cn(
            "space-y-4",
            historyRequest && activeTab !== "details" && "hidden",
            !intent && "hidden"
          )}
        >
        <div className="flex items-center gap-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white p-1">
            {headerQr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={headerQr} alt={`QR code for ${headerCode}`} className="h-full w-full" />
            ) : (
              <span className="h-full w-full animate-pulse rounded bg-slate-100" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Template ID
            </p>
            {/* Updates as the fields below are filled in; empty or "No" items are left out. */}
            <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="font-mono text-2xl font-bold tracking-wider text-slate-900">
                {headerCode ?? "DIE-·····"}
              </span>
              {name.trim() ? (
                <span className="min-w-0 truncate text-base font-semibold text-slate-800" title={name.trim()}>
                  {name.trim()}
                </span>
              ) : null}
              {name.trim() ? <span className="text-slate-300">|</span> : null}
              <span className="inline-flex items-center gap-1 text-sm font-medium text-slate-700">
                <TypeIcon className="h-3.5 w-3.5 text-slate-500" />
                {DIE_TYPE_LABEL[dieType]}
              </span>
              {sizeLabel ? (
                <>
                  <span className="text-slate-300">|</span>
                  <span className="text-sm font-medium tabular-nums text-slate-700">
                    {sizeLabel} in
                  </span>
                </>
              ) : null}
            </p>
            <p className="text-xs text-slate-500">
              {editing
                ? "This ID and QR code never change."
                : "Unique to this die. If someone adds a die before you save, you get the next number."}
            </p>
            {/* Values only, no "Order:" / "Shape:" labels. */}
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-semibold text-slate-800">
              {[
                orderLabel ? `#${orderLabel}` : null,
                DIE_SHAPE_LABEL[shape],
                perforation ? "Perforation" : null,
                rounded ? "Rounded corner" : null,
              ]
                .filter((v): v is string => Boolean(v))
                .map((v, i) => (
                  <span key={v} className="inline-flex items-center gap-1.5">
                    {i > 0 ? <span className="font-normal text-slate-300">·</span> : null}
                    {v}
                  </span>
                ))}
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="die-name">Die name *</Label>
            <Input
              id="die-name"
              className="mt-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Mailer box 9×6×2"
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="die-order-pick">Order</Label>
            <DieOrderPicker
              id="die-order-pick"
              initialText={die?.order_title ? formatShortOrderNumber(die.order_title) : ""}
              placeholder="Optional · type digits…"
              onClear={() => {
                setOrderId(null);
                setOrderLabel(null);
              }}
              onPick={(hit) => {
                setOrderId(hit.id);
                setOrderLabel(hit.orderNumber || formatShortOrderNumber(hit.title));
                const due = hit.dueDate ? hit.dueDate.slice(0, 10) : null;
                setOrderDue(due);
                if (due && !requiredDate) setRequiredDate(due);
                // Fill blanks from the board card.
                if (!name.trim() && hit.productName) setName(hit.productName);
                if (!length && hit.width) setLength(hit.width);
                if (!width && hit.height) setWidth(hit.height);
                if (!height && hit.depth) setHeight(hit.depth);
              }}
            />
          </div>
        </div>

        <div>
          <Label>Die type</Label>
          <DieTypePicker value={dieType} onChange={setDieType} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="die-template-name">Pacdora template name</Label>
            <Input
              id="die-template-name"
              className="mt-1"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div>
            <Label htmlFor="die-link">Pacdora link</Label>
            <Input
              id="die-link"
              className="mt-1"
              type="url"
              inputMode="url"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://www.pacdora.com/…"
            />
          </div>
        </div>

        <div>
          <Label>Size (in)</Label>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {(
              [
                ["L", length, setLength],
                ["W", width, setWidth],
                ["H", height, setHeight],
              ] as const
            ).map(([label, value, set]) => (
              <label key={label} className="relative block">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">
                  {label}
                </span>
                <Input
                  aria-label={`${label} (in)`}
                  className="pl-8"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.001"
                  value={value}
                  onChange={(e) => set(e.target.value)}
                />
              </label>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
          <div>
            <Label>Shape</Label>
            <ShapeSelect value={shape} onChange={setShape} />
          </div>
          <div>
            <Label>Finishing</Label>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <CheckOption label="Rounded corner" checked={rounded} onChange={setRounded} />
              <CheckOption label="Perforation" checked={perforation} onChange={setPerforation} />
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="die-pdf">Die PDF</Label>
            <label
              htmlFor="die-pdf"
              className="mt-1 flex h-10 cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50"
            >
              <FileUp className="h-4 w-4 shrink-0 text-slate-500" />
              <span className="min-w-0 flex-1 truncate">
                {pdfFile
                  ? pdfFile.name
                  : die?.pdf_name
                    ? `Replace ${die.pdf_name}`
                    : "Attach PDF"}
              </span>
              {pdfFile ? (
                <button
                  type="button"
                  aria-label="Remove PDF"
                  className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  onClick={(e) => {
                    e.preventDefault();
                    setPdfFile(null);
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </label>
            <input
              id="die-pdf"
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                e.target.value = "";
                if (!file) return;
                const bad = diePdfError(file);
                if (bad) {
                  setError(bad);
                  return;
                }
                setError(null);
                setPdfFile(file);
              }}
            />
            {die?.has_pdf && !pdfFile ? (
              <a
                href={`/api/dies/${die.id}/file`}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
              >
                Open current PDF
              </a>
            ) : null}
          </div>
          <div>
            <Label htmlFor="die-max-uses">Max uses</Label>
            <Input
              id="die-max-uses"
              className="mt-1"
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              placeholder="Optional · e.g. 500"
            />
            <p className="mt-1 text-xs text-slate-500">
              You&apos;re warned near the limit.
            </p>
          </div>
          <div>
            <Label htmlFor="die-location">Location on shelf</Label>
            <Input
              id="die-location"
              className="mt-1"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Shelf B · Bin 4"
              maxLength={120}
            />
          </div>
        </div>

        {ordering ? (
        <div className="space-y-4 rounded-lg border border-blue-100 bg-blue-50/40 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-800">
          Order from manufacturer
        </p>
        <div>
          <Label htmlFor="die-mfg">Die manufacturer</Label>
          {manufacturers.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Add one in Settings to send.</p>
          ) : (
            <Select
              id="die-mfg"
              className="mt-1"
              value={manufacturerId}
              onChange={(e) => setManufacturerId(e.target.value)}
            >
              {manufacturers.map((m) => (
                <option key={m.id} value={m.id}>
                  {dieManufacturerLabel(m)}
                </option>
              ))}
            </Select>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="die-required">Required date</Label>
            <RequiredDatePicker
              minDate={dieTodayYmd()}
              id="die-required"
              value={requiredDate}
              dueDate={orderDue}
              dueLabel="Order due"
              selectedLabel="Required date"
              onChange={setRequiredDate}
            />
          </div>
          <div>
            <Label>Manufacturer date (optional)</Label>
            <CheckOption
              label="Manufacturer sets own date & time"
              checked={allowOwnDate}
              onChange={setAllowOwnDate}
            />
          </div>
        </div>
        <p className="-mt-2 text-xs text-slate-500">
          {allowOwnDate
            ? "The manufacturer can reply with a different due date and their time estimate. "
            : "The manufacturer must confirm your required date. "}
          {historyRequest
            ? null
            : "Send order emails the manufacturer for a price, with the PDF attached."}
        </p>
        </div>
        ) : null}

        {error ? (
          <p ref={errorRef} role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            {error}
          </p>
        ) : null}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
        </div>
        {historyRequest && activeTab === "history" ? (
          <DieHistoryPanel request={historyRequest} />
        ) : null}
      </form>
    </Modal>
  );
}
