"use client";

import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ClipboardList,
  Plus,
  Trash2,
} from "lucide-react";
import { Input, Label, Textarea } from "@/components/ui/input";
import {
  SkuImageUpload,
  SkuPendingImagePicker,
  type PendingSkuImage,
} from "./sku-image-upload";
import type { SkuItem } from "@/lib/skus";
import { skuTotalQty } from "@/lib/sku-resync";
import {
  applySkuPaste,
  isApplicablePasteLine,
  parseSkuPasteText,
  serializeSkuRows,
  skuTextMatchesRows,
  summarizeSkuPaste,
  SKU_TEXT_MAX_LENGTH,
  type SkuPasteLine,
} from "@/lib/sku-paste";
import type { OrderSkuImageWithUrl } from "@/lib/types";

export type { SkuItem } from "@/lib/skus";
export type { PendingSkuImage } from "./sku-image-upload";
export { normalizeSkus, prepareSkusForSave, validateSkus, mergeSkusWithAssets } from "@/lib/skus";

interface SkuEditorProps {
  value: SkuItem[];
  onChange: (next: SkuItem[]) => void;
  /** When set, artwork uploads go to Supabase immediately */
  orderId?: string;
  skuImagesBySkuId?: Record<string, OrderSkuImageWithUrl[]>;
  /** Local files held until the order exists (create flow). */
  pendingImagesBySkuId?: Record<string, PendingSkuImage[]>;
  onPendingImagesChange?: (skuId: string, next: PendingSkuImage[]) => void;
  /** Saves a newly added SKU row before gallery uploads can attach to it. */
  ensureSkuPersisted?: (skuId: string) => Promise<string | null>;
  disabled?: boolean;
  /**
   * `specs.skus_staff_edited_at` — when set, CRM / website re-syncs keep these
   * SKUs unless the source changes its own SKU list.
   */
  staffEditedAt?: string | null;
  /**
   * Raw free-form SKU list text (`specs.skus_text`). When `onFreeTextChange`
   * is set the text is saved with the order; otherwise the paste box still
   * works but the text is only kept while the form is open.
   */
  freeText?: string;
  onFreeTextChange?: (next: string) => void;
}

export function SkuEditor({
  value,
  onChange,
  orderId,
  skuImagesBySkuId = {},
  pendingImagesBySkuId = {},
  onPendingImagesChange,
  ensureSkuPersisted,
  disabled = false,
  staffEditedAt = null,
  freeText,
  onFreeTextChange,
}: SkuEditorProps) {
  const totalQty = skuTotalQty(value);
  const [localText, setLocalText] = useState("");
  const text = onFreeTextChange ? (freeText ?? "") : localText;
  const setText = onFreeTextChange ?? setLocalText;
  const [textOpen, setTextOpen] = useState(() => Boolean(freeText?.trim()));
  const [previewOpen, setPreviewOpen] = useState(false);
  const [skipped, setSkipped] = useState<Set<number>>(() => new Set());

  const parsedLines = useMemo(() => parseSkuPasteText(text), [text]);
  const summary = useMemo(() => summarizeSkuPaste(parsedLines), [parsedLines]);
  const inSync = useMemo(() => skuTextMatchesRows(text, value), [text, value]);
  const applicableCount = parsedLines.filter(
    (l) => isApplicablePasteLine(l) && !skipped.has(l.lineNo)
  ).length;

  /** Row edits: keep the text box in step when it was in step before. */
  function emitRows(next: SkuItem[]) {
    if (text.trim() && skuTextMatchesRows(text, value)) {
      setText(serializeSkuRows(next));
    }
    onChange(next);
  }

  function update(index: number, patch: Partial<SkuItem>) {
    emitRows(value.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function add() {
    emitRows([
      ...value,
      { id: crypto.randomUUID(), name: "", qty: null },
    ]);
  }

  function move(index: number, delta: -1 | 1) {
    const to = index + delta;
    if (to < 0 || to >= value.length) return;
    const next = [...value];
    const [row] = next.splice(index, 1);
    next.splice(to, 0, row!);
    emitRows(next);
  }

  function applyText(mode: "replace" | "append") {
    const next = applySkuPaste(value, parsedLines, {
      mode,
      skip: skipped,
      newId: () => crypto.randomUUID(),
    });
    // Rows that lost their place (replace) drop their pending local files.
    if (mode === "replace" && onPendingImagesChange) {
      const keep = new Set(next.map((r) => r.id));
      for (const old of value) {
        if (keep.has(old.id)) continue;
        for (const img of pendingImagesBySkuId[old.id] ?? []) {
          URL.revokeObjectURL(img.previewUrl);
        }
        onPendingImagesChange(old.id, []);
      }
    }
    onChange(next);
    setPreviewOpen(false);
    setSkipped(new Set());
  }

  function toggleSkip(lineNo: number) {
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(lineNo)) next.delete(lineNo);
      else next.add(lineNo);
      return next;
    });
  }

  function remove(index: number) {
    const removed = value[index];
    if (removed && onPendingImagesChange) {
      const pending = pendingImagesBySkuId[removed.id] ?? [];
      for (const img of pending) URL.revokeObjectURL(img.previewUrl);
      onPendingImagesChange(removed.id, []);
    }
    emitRows(value.filter((_, i) => i !== index));
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex min-w-0 flex-wrap items-center text-sm font-semibold text-slate-700">
          SKUs
          <span className="ml-2 whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
            SKU QTY: {value.length}
          </span>
          {value.length > 0 ? (
            <span className="ml-1 whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
              TOTAL QTY: {totalQty.toLocaleString("en-US")}
            </span>
          ) : null}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setTextOpen((o) => !o)}
            className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-xs font-medium hover:bg-slate-50 ${
              textOpen
                ? "border-blue-300 bg-blue-50 text-blue-700"
                : "border-slate-300 text-slate-700"
            }`}
            aria-expanded={textOpen}
          >
            <ClipboardList className="h-3.5 w-3.5" /> Paste / type list
          </button>
          <button
            type="button"
            onClick={add}
            disabled={disabled}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" /> Add SKU
          </button>
        </div>
      </div>

      {textOpen ? (
        <SkuFreeTextPanel
          text={text}
          onTextChange={(t) => {
            setText(t);
            setSkipped(new Set());
            setPreviewOpen(t.trim().length > 0);
          }}
          disabled={disabled}
          saved={Boolean(onFreeTextChange)}
          inSync={inSync}
          rowsCount={value.length}
          lines={parsedLines}
          summary={summary}
          skipped={skipped}
          onToggleSkip={toggleSkip}
          previewOpen={previewOpen}
          onPreviewOpenChange={setPreviewOpen}
          applicableCount={applicableCount}
          onApply={applyText}
          onRowsToText={() => setText(serializeSkuRows(value))}
        />
      ) : null}

      {staffEditedAt ? (
        <p className="mb-2 text-xs text-slate-400">
          Edited by staff — CRM / website updates keep these SKUs unless the
          source changes its own SKU list.
        </p>
      ) : null}

      {value.length === 0 ? (
        <p className="text-sm text-slate-400">
          No SKUs yet. Add one per distinct item / quantity.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_5.5rem_auto] gap-2">
            <Label className="mb-0">
              SKU name <span className="text-red-500">*</span>
            </Label>
            <Label className="mb-0">Quantity</Label>
            <span />
          </div>
          {value.map((sku, index) => (
            <div key={sku.id} className="space-y-1">
              <div className="grid grid-cols-[1fr_5.5rem_auto] items-start gap-2">
                <Input
                  value={sku.name}
                  onChange={(e) => update(index, { name: e.target.value })}
                  placeholder={`SKU ${index + 1} name`}
                  disabled={disabled}
                />
                <Input
                  type="number"
                  min={1}
                  value={sku.qty ?? ""}
                  onChange={(e) =>
                    update(index, {
                      qty: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                  placeholder="Qty"
                  disabled={disabled}
                />
                <div className="flex items-center">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={disabled || index === 0}
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                    aria-label="Move SKU up"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={disabled || index === value.length - 1}
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                    aria-label="Move SKU down"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(index)}
                    disabled={disabled}
                    className="rounded p-1.5 text-slate-400 hover:bg-red-100 hover:text-red-600 disabled:opacity-50"
                    aria-label="Remove SKU"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              {orderId ? (
                <SkuImageUpload
                  orderId={orderId}
                  skuId={sku.id}
                  initialImages={skuImagesBySkuId[sku.id] ?? []}
                  ensureSkuPersisted={ensureSkuPersisted}
                  disabled={disabled}
                />
              ) : onPendingImagesChange ? (
                <SkuPendingImagePicker
                  files={pendingImagesBySkuId[sku.id] ?? []}
                  onChange={(next) => onPendingImagesChange(sku.id, next)}
                  disabled={disabled}
                />
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const STATUS_STYLE: Record<SkuPasteLine["status"], { row: string; note: string }> = {
  ok: { row: "", note: "" },
  no_qty: {
    row: "bg-amber-50",
    note: "No quantity — row added with a blank qty",
  },
  no_name: {
    row: "bg-red-50",
    note: "Couldn't read a SKU name — not added",
  },
  header: { row: "bg-slate-50 text-slate-400", note: "Header row — skipped" },
};

function SkuFreeTextPanel({
  text,
  onTextChange,
  disabled,
  saved,
  inSync,
  rowsCount,
  lines,
  summary,
  skipped,
  onToggleSkip,
  previewOpen,
  onPreviewOpenChange,
  applicableCount,
  onApply,
  onRowsToText,
}: {
  text: string;
  onTextChange: (next: string) => void;
  disabled: boolean;
  saved: boolean;
  inSync: boolean;
  rowsCount: number;
  lines: SkuPasteLine[];
  summary: ReturnType<typeof summarizeSkuPaste>;
  skipped: ReadonlySet<number>;
  onToggleSkip: (lineNo: number) => void;
  previewOpen: boolean;
  onPreviewOpenChange: (open: boolean) => void;
  applicableCount: number;
  onApply: (mode: "replace" | "append") => void;
  onRowsToText: () => void;
}) {
  const hasText = text.trim().length > 0;
  return (
    <div className="mb-3 space-y-2 rounded-md border border-slate-200 bg-slate-50/60 p-2">
      <Textarea
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        maxLength={SKU_TEXT_MAX_LENGTH}
        rows={Math.min(10, Math.max(3, text.split("\n").length + 1))}
        placeholder={
          "One SKU per line — e.g.\nMango 1200\nGrape - 2,000\nLemon x 500\n(paste columns from Excel too; qty is optional)"
        }
        disabled={disabled}
        className="font-mono text-xs"
        aria-label="SKU list text"
      />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {hasText || rowsCount > 0 ? (
          inSync ? (
            <span className="text-emerald-600">Text and SKU rows match.</span>
          ) : (
            <span className="text-amber-700">Text differs from the SKU rows.</span>
          )
        ) : (
          <span className="text-slate-400">
            Paste or type a list, then preview it before it becomes SKU rows.
          </span>
        )}
        <span className="ml-auto flex gap-1">
          {hasText && !inSync ? (
            <button
              type="button"
              onClick={() => onPreviewOpenChange(!previewOpen)}
              disabled={disabled}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {previewOpen ? "Hide preview" : "Preview → rows"}
            </button>
          ) : null}
          {rowsCount > 0 && !inSync ? (
            <button
              type="button"
              onClick={onRowsToText}
              disabled={disabled}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              title="Replace the text with the current SKU rows"
            >
              Rows → text
            </button>
          ) : null}
        </span>
      </div>
      <p className="text-[11px] text-slate-400">
        {saved
          ? "This text is saved on the card as typed (notes like “6 flavors, 1200 each” are kept)."
          : "Text is used to fill the rows; it is saved once the order exists."}
      </p>

      {previewOpen && hasText && !inSync ? (
        <div className="rounded-md border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-2 py-1.5 text-xs text-slate-600">
            <span className="font-semibold">Preview</span>
            <span>
              {summary.rows} SKU{summary.rows === 1 ? "" : "s"} · total{" "}
              {summary.total.toLocaleString("en-US")}
            </span>
            {summary.missingQty > 0 ? (
              <span className="text-amber-700">{summary.missingQty} without qty</span>
            ) : null}
            {summary.unparsed > 0 ? (
              <span className="text-red-600">{summary.unparsed} not read</span>
            ) : null}
          </div>
          <ul className="max-h-60 divide-y divide-slate-100 overflow-y-auto text-xs">
            {lines.map((l) => {
              const style = STATUS_STYLE[l.status];
              const applicable = isApplicablePasteLine(l);
              return (
                <li
                  key={l.lineNo}
                  className={`grid grid-cols-[1.25rem_1fr_5rem] items-start gap-2 px-2 py-1 ${style.row}`}
                >
                  <input
                    type="checkbox"
                    checked={applicable && !skipped.has(l.lineNo)}
                    disabled={!applicable || disabled}
                    onChange={() => onToggleSkip(l.lineNo)}
                    aria-label={`Use line ${l.lineNo}`}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-800">
                      {l.name || <span className="text-slate-400">{l.raw.trim()}</span>}
                    </span>
                    {style.note ? (
                      <span className="block text-[11px] text-slate-500">
                        Line {l.lineNo}: {style.note}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-right tabular-nums text-slate-700">
                    {l.qty != null ? l.qty.toLocaleString("en-US") : "—"}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap justify-end gap-1 border-t border-slate-100 px-2 py-1.5">
            <button
              type="button"
              onClick={() => onApply("append")}
              disabled={disabled || applicableCount === 0}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Add {applicableCount} to rows
            </button>
            <button
              type="button"
              onClick={() => onApply("replace")}
              disabled={disabled || applicableCount === 0}
              className="rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              title="SKU rows become exactly this list (artwork stays on rows with the same name or position)"
            >
              Replace rows with {applicableCount}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
