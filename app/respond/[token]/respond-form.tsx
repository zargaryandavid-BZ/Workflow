"use client";

import { useMemo, useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  CloudUpload,
  Paperclip,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/input";
import { ProofLayerLegend } from "@/components/respond/proof-layer-legend";
import {
  RESPOND_ACCEPT,
  RESPOND_MAX_BYTES,
  formatFileSize,
  type OrderMetaChip,
  type UploadSlot,
} from "@/lib/respond-page";
import { SkuDecisionProvider } from "@/components/respond/sku-decision-context";
import {
  approvalImageAssetId,
  approvalImageSlotCount,
  formatSkuApprovalNote,
  imageDecisionKey,
  overallApprovalResponse,
  rollupSkuDecisionFromImages,
  type SkuApprovalDecision,
  type SkuApprovalEntry,
  type SkuImageApprovalEntry,
} from "@/lib/sku-approval";
import type { SkuItem } from "@/lib/skus";
import type { CustomerResponse, NotificationType } from "@/lib/types";
import {
  imagesBySkuId,
  type RespondOrderAsset,
  type RespondSkuImage,
} from "@/lib/respond-order";

interface Props {
  token: string;
  type: NotificationType;
  productLabel?: string;
  orderNumber?: string;
  /** This part's line-item title, shown as the heading + upload label. */
  itemTitle?: string;
  /** Titled per-SKU upload targets. Each maps its file to a specific SKU. */
  uploadSlots?: UploadSlot[];
  staffNote?: string | null;
  metaChips?: OrderMetaChip[];
  tenantName?: string;
  orderReview?: React.ReactNode;
  /** SKUs on this proof — customer marks approve/reject per SKU. */
  approvalSkus?: SkuItem[];
  /** Assets with sku_key — used for per-image decisions when a SKU has 2+ images. */
  approvalAssets?: RespondOrderAsset[];
  /** Gallery images keyed by sku id. */
  approvalSkuGallery?: Record<string, RespondSkuImage[]>;
  /** Fired after a successful customer_approval decision (group portal nav). */
  onDecided?: (decision: "approved" | "rejected") => void;
}

/** A single titled upload control (its own file input + drag state). */
function UploadDropzone({
  label,
  files,
  disabled,
  onAdd,
  onRemove,
}: {
  label: string;
  files: File[];
  disabled: boolean;
  onAdd: (list: FileList | null) => void;
  onRemove: (index: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div>
      <Label className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
      </Label>
      <input
        ref={inputRef}
        type="file"
        accept={RESPOND_ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          onAdd(e.target.files);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />

      {files.length > 0 ? (
        <ul className="mb-2 space-y-1.5">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className="truncate">{file.name}</span>
                <span className="shrink-0 text-xs text-slate-400">
                  {formatFileSize(file.size)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => onRemove(index)}
                className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                aria-label={`Remove ${file.name}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          onAdd(e.dataTransfer.files);
        }}
        disabled={disabled}
        className={`flex w-full items-center gap-2.5 rounded-lg border border-dashed px-3 py-2.5 text-left text-sm transition-colors disabled:opacity-60 ${
          dragOver
            ? "border-[#1d4ed8] bg-[#f0f9ff] text-[#1d4ed8]"
            : "border-slate-300 bg-slate-50 text-slate-500 hover:border-[#1d4ed8] hover:bg-[#f0f9ff]"
        }`}
      >
        <CloudUpload className="h-4 w-4 shrink-0" />
        <span className="min-w-0">
          <span className="block text-slate-600">
            {files.length > 0
              ? "Add another file"
              : "Drag & drop or click to upload"}
          </span>
          <span className="text-xs text-slate-400">
            PDF, AI, EPS, PNG, JPG · Max 50MB
          </span>
        </span>
      </button>
    </div>
  );
}

export function RespondForm({
  token,
  type,
  productLabel,
  orderNumber,
  itemTitle,
  uploadSlots,
  staffNote,
  metaChips = [],
  tenantName,
  orderReview,
  approvalSkus = [],
  approvalAssets = [],
  approvalSkuGallery = {},
  onDecided,
}: Props) {
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [doneKind, setDoneKind] = useState<
    "approved" | "rejected" | "info" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [filesBySlot, setFilesBySlot] = useState<Record<number, File[]>>({});
  const [skuChoices, setSkuChoices] = useState<
    Record<string, SkuApprovalDecision | undefined>
  >({});
  const [imageChoices, setImageChoices] = useState<
    Record<string, SkuApprovalDecision | undefined>
  >({});
  const [pdfPageCountBySku, setPdfPageCountBySku] = useState<
    Record<string, number>
  >({});
  const [submittedSkuEntries, setSubmittedSkuEntries] = useState<
    SkuApprovalEntry[]
  >([]);
  const [submittedImageEntries, setSubmittedImageEntries] = useState<
    SkuImageApprovalEntry[]
  >([]);

  const skuImages = useMemo(
    () => imagesBySkuId(approvalSkus, approvalAssets, approvalSkuGallery),
    [approvalSkus, approvalAssets, approvalSkuGallery]
  );

  const skuRollup = useMemo(() => {
    const rollup: Record<string, SkuApprovalDecision | undefined> = {
      ...skuChoices,
    };
    for (const sku of approvalSkus) {
      const imgs = skuImages[sku.id] ?? [];
      const slotCount = approvalImageSlotCount(
        imgs.length,
        pdfPageCountBySku[sku.id] ?? 0
      );
      if (slotCount < 2) continue;
      rollup[sku.id] = rollupSkuDecisionFromImages(
        Array.from({ length: slotCount }, (_, imgIdx) =>
          imageChoices[
            imageDecisionKey(
              sku.id,
              approvalImageAssetId(imgIdx + 1, imgs)
            )
          ]
        )
      );
    }
    return rollup;
  }, [skuChoices, imageChoices, approvalSkus, skuImages, pdfPageCountBySku]);

  const perSkuApproval =
    type === "customer_approval" && approvalSkus.length > 0;

  function skuEntriesFromChoices(): {
    skuEntries: SkuApprovalEntry[];
    imageEntries: SkuImageApprovalEntry[];
  } | null {
    const skuEntries: SkuApprovalEntry[] = [];
    const imageEntries: SkuImageApprovalEntry[] = [];
    for (let i = 0; i < approvalSkus.length; i += 1) {
      const sku = approvalSkus[i];
      const imgs = skuImages[sku.id] ?? [];
      const slotCount = approvalImageSlotCount(
        imgs.length,
        pdfPageCountBySku[sku.id] ?? 0
      );
      if (slotCount >= 2) {
        for (let imgIdx = 0; imgIdx < slotCount; imgIdx += 1) {
          const assetId = approvalImageAssetId(imgIdx + 1, imgs);
          const decision = imageChoices[imageDecisionKey(sku.id, assetId)];
          if (!decision) return null;
          imageEntries.push({
            skuId: sku.id,
            skuIndex: i + 1,
            skuName: sku.name.trim(),
            assetId,
            imageIndex: imgIdx + 1,
            decision,
          });
        }
        continue;
      }
      const decision = skuChoices[sku.id];
      if (!decision) return null;
      skuEntries.push({
        skuId: sku.id,
        index: i + 1,
        name: sku.name.trim(),
        decision,
      });
    }
    return { skuEntries, imageEntries };
  }

  // Titled upload targets. Legacy links (no slots) fall back to one item slot.
  const itemHeading = itemTitle?.trim() || productLabel || "Your order";
  const slots: UploadSlot[] =
    uploadSlots && uploadSlots.length > 0
      ? uploadSlots
      : [{ skuKey: null, label: itemHeading }];
  const multiSlot = slots.length > 1;

  const anyFiles = Object.values(filesBySlot).some((f) => f.length > 0);
  const canSend = note.trim().length > 0 || anyFiles;

  function addFiles(slotIndex: number, list: FileList | null) {
    if (!list || list.length === 0) return;
    setError(null);
    const next: File[] = [];
    for (const file of Array.from(list)) {
      if (file.size > RESPOND_MAX_BYTES) {
        setError(`${file.name} is larger than 50MB.`);
        continue;
      }
      next.push(file);
    }
    if (next.length > 0) {
      setFilesBySlot((prev) => ({
        ...prev,
        [slotIndex]: [...(prev[slotIndex] ?? []), ...next],
      }));
    }
  }

  function removeFile(slotIndex: number, index: number) {
    setFilesBySlot((prev) => ({
      ...prev,
      [slotIndex]: (prev[slotIndex] ?? []).filter((_, i) => i !== index),
    }));
  }

  async function respond(response: CustomerResponse, noteOverride?: string) {
    if (type === "missing_info" && response === "info_submitted" && !canSend) {
      setError("Please attach a file or leave a comment before sending.");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
        const files = filesBySlot[slotIndex] ?? [];
        const { skuKey } = slots[slotIndex];
        for (const file of files) {
          const form = new FormData();
          form.append("file", file);
          form.append("token", token);
          if (skuKey) form.append("skuKey", skuKey);
          const uploadRes = await fetch("/api/notifications/upload", {
            method: "POST",
            body: form,
          });
          const uploadJson = await uploadRes.json();
          if (!uploadRes.ok) {
            throw new Error(uploadJson.error ?? `Failed to upload ${file.name}`);
          }
        }
      }

      const res = await fetch("/api/notifications/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          response,
          note: (noteOverride ?? note).trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? "Something went wrong");
      }
      setDone(true);
      if (type === "customer_approval") {
        const kind = response === "approved" ? "approved" : "rejected";
        setDoneKind(kind);
        onDecided?.(kind);
      } else {
        setDoneKind("info");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function submitPerSku() {
    const built = skuEntriesFromChoices();
    if (!built) {
      setError("Please check Approve or Not approved for each SKU and image.");
      return;
    }
    const overall = overallApprovalResponse([
      ...built.skuEntries,
      ...built.imageEntries,
    ]);
    if (overall === "changes_requested" && !note.trim()) {
      setError("Please tell us why the proof was not approved.");
      return;
    }
    setSubmittedSkuEntries(built.skuEntries);
    setSubmittedImageEntries(built.imageEntries);
    respond(
      overall,
      formatSkuApprovalNote(built.skuEntries, built.imageEntries, note)
    );
  }

  if (done) {
    const approvalDone =
      type === "customer_approval" && doneKind === "approved";
    const rejectionDone =
      type === "customer_approval" && doneKind === "rejected";
    const mixedDecisions = [
      ...submittedSkuEntries,
      ...submittedImageEntries,
    ];
    const mixed =
      mixedDecisions.length > 0 &&
      mixedDecisions.some((e) => e.decision === "approved") &&
      mixedDecisions.some((e) => e.decision === "rejected");
    const resultLines = formatSkuApprovalNote(
      submittedSkuEntries,
      submittedImageEntries,
      ""
    )
      .split("\n")
      .filter(Boolean);

    return (
      <SkuDecisionProvider
        mode={
          submittedSkuEntries.length > 0 || submittedImageEntries.length > 0
            ? "result"
            : "off"
        }
        byId={skuRollup}
        byImageKey={imageChoices}
      >
        <div
          className={`rounded-lg p-6 text-center ${
            approvalDone
              ? "bg-emerald-50 text-emerald-900"
              : rejectionDone
                ? "bg-red-50 text-red-900"
                : "bg-emerald-50 text-emerald-900"
          }`}
        >
          <CheckCircle2
            className={`mx-auto h-10 w-10 ${
              approvalDone
                ? "text-emerald-600"
                : rejectionDone
                  ? "text-red-600"
                  : "text-emerald-600"
            }`}
          />
          <h2 className="mt-3 text-lg font-semibold">
            {approvalDone
              ? "Thank you!"
              : mixed
                ? "Response received"
                : rejectionDone
                  ? "Feedback received"
                  : type === "ready_to_ship"
                    ? "Got it!"
                    : "Response received!"}
          </h2>
          <p
            className={`mt-2 text-sm ${
              approvalDone || (!approvalDone && !rejectionDone)
                ? "text-emerald-800"
                : "text-red-800"
            }`}
          >
            {approvalDone
              ? "Your approval has been recorded. We'll get started right away."
              : mixed
                ? "We recorded which SKUs were approved and which need changes. Our team will be in touch shortly."
                : rejectionDone
                  ? "Thank you for your feedback. Our team will be in touch shortly."
                  : type === "ready_to_ship"
                    ? "You're all set. Contact us anytime to arrange pickup or delivery. You can close this page."
                    : `Thank you — the ${tenantName ?? "team"} has been notified and will review your response shortly. You can close this page.`}
          </p>
          {resultLines.length > 0 ? (
            <ul className="mt-4 space-y-1.5 text-left">
              {resultLines.map((line) => {
                const rejected = line.endsWith("Not approved");
                return (
                  <li
                    key={line}
                    className={`flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm ${
                      rejected
                        ? "bg-red-100/80 text-red-900"
                        : "bg-emerald-100/80 text-emerald-900"
                    }`}
                  >
                    <span className="min-w-0 truncate font-medium">
                      {line.replace(/: (Approved|Not approved)\s*$/, "")}
                    </span>
                    <span className="shrink-0 text-xs font-semibold uppercase tracking-wide">
                      {rejected ? "Not approved" : "Approved"}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
        {orderReview ? <div className="mt-5">{orderReview}</div> : null}
      </SkuDecisionProvider>
    );
  }

  if (type === "customer_approval") {
    const review = perSkuApproval ? (
      <SkuDecisionProvider
        mode="choose"
        byId={skuRollup}
        onChange={(skuId, decision) => {
          setSkuChoices((prev) => ({ ...prev, [skuId]: decision }));
          setError(null);
        }}
        byImageKey={imageChoices}
        pdfPageCountBySku={pdfPageCountBySku}
        setPdfPageCount={(skuId, count) => {
          setPdfPageCountBySku((prev) =>
            prev[skuId] === count ? prev : { ...prev, [skuId]: count }
          );
        }}
        onImageChange={(skuId, assetId, decision) => {
          setImageChoices((prev) => ({
            ...prev,
            [imageDecisionKey(skuId, assetId)]: decision,
          }));
          setError(null);
        }}
      >
        {orderReview}
      </SkuDecisionProvider>
    ) : (
      orderReview
    );

    return (
      <div className="space-y-5">
        <p className="text-sm leading-relaxed text-slate-600">
          Your print proof is ready for review.
          {perSkuApproval
            ? " Check Approve or Not approved for each SKU (and each image when a SKU has more than one)."
            : ""}
        </p>

        {review}

        {!orderReview && metaChips.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {metaChips.map((chip) => (
              <div
                key={chip.label}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  {chip.label}
                </p>
                <p className="mt-0.5 text-sm font-medium text-slate-800">
                  {chip.value}
                </p>
              </div>
            ))}
          </div>
        ) : null}

        {staffNote?.trim() ? (
          <div className="rounded-r-lg border-l-[3px] border-[#1d4ed8] bg-[#f0f9ff] px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#1d4ed8]">
              Note from our team
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
              {staffNote.trim()}
            </p>
          </div>
        ) : null}

        <ProofLayerLegend />

        <p className="text-sm font-medium text-slate-700">
          {perSkuApproval
            ? "Please mark each SKU and confirm below:"
            : "Please review and confirm below:"}
        </p>
        <div>
          <Label htmlFor="approval-comment">Comment</Label>
          <Textarea
            id="approval-comment"
            className="mt-1.5"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setError(null);
            }}
            placeholder={
              perSkuApproval
                ? "Optional note — required if any SKU or image is not approved"
                : "Optional note — required if not approving"
            }
            rows={4}
          />
        </div>
        {error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        ) : null}
        {perSkuApproval ? (
          <Button
            className="w-full"
            onClick={submitPerSku}
            disabled={loading}
          >
            <Check className="h-4 w-4" /> Submit review
          </Button>
        ) : (
          <div className="flex gap-3">
            <Button
              className="flex-1"
              onClick={() => respond("approved")}
              disabled={loading}
            >
              <Check className="h-4 w-4" /> Approve
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              onClick={() => {
                if (!note.trim()) {
                  setError("Please tell us why the proof was not approved.");
                  return;
                }
                respond("changes_requested");
              }}
              disabled={loading}
            >
              <X className="h-4 w-4" /> Not Approved
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (type === "ready_to_ship") {
    return (
      <div className="space-y-5">
        <p className="text-sm leading-relaxed text-slate-600">
          Great news — your order is ready for pickup or delivery.
        </p>

        {orderReview}

        {!orderReview && metaChips.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {metaChips.map((chip) => (
              <div
                key={chip.label}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  {chip.label}
                </p>
                <p className="mt-0.5 text-sm font-medium text-slate-800">
                  {chip.value}
                </p>
              </div>
            ))}
          </div>
        ) : null}

        {staffNote?.trim() ? (
          <div className="rounded-r-lg border-l-[3px] border-emerald-600 bg-emerald-50 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
              Note from our team
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
              {staffNote.trim()}
            </p>
          </div>
        ) : null}

        <p className="text-sm leading-relaxed text-slate-600">
          Pickup is available at 306 Boyd St, LA — Mon–Fri 9:30 AM–5:30 PM,
          Saturday until 4:00 PM. To choose delivery or pickup online, ask us to
          resend your shipping link (new notifications include pickup and
          delivery options).
        </p>

        {error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        ) : null}

        <Button
          className="w-full"
          onClick={() => respond("info_submitted")}
          disabled={loading}
        >
          <Check className="h-4 w-4" /> Got it
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {orderReview}

      {!orderReview && metaChips.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {metaChips.map((chip) => (
            <div
              key={chip.label}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
            >
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {chip.label}
              </p>
              <p className="mt-0.5 text-sm font-medium text-slate-800">
                {chip.value}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      <div>
        <h2 className="text-base font-semibold text-slate-800">
          {itemHeading}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          We need your file{multiSlot ? "s" : ""} for this item
          {orderNumber ? ` (order ${orderNumber})` : ""} before we can proceed.
          {multiSlot
            ? " Please upload the correct file for each item below,"
            : " Please attach your file below,"}
          {" "}or leave us a note.
        </p>
      </div>

      {staffNote?.trim() ? (
        <div className="rounded-r-lg border-l-[3px] border-[#1d4ed8] bg-[#f0f9ff] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#1d4ed8]">
            Note from our team
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
            {staffNote.trim()}
          </p>
        </div>
      ) : null}

      <div className="space-y-4">
        {slots.map((slot, index) => (
          <UploadDropzone
            key={`${slot.skuKey ?? "item"}-${index}`}
            label={
              multiSlot
                ? slot.label || `Item ${index + 1}`
                : `Attach files for ${slot.label}`
            }
            files={filesBySlot[index] ?? []}
            disabled={loading}
            onAdd={(list) => addFiles(index, list)}
            onRemove={(fileIndex) => removeFile(index, fileIndex)}
          />
        ))}
      </div>

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-slate-200" />
        <span className="text-xs text-slate-400">or leave a comment</span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      <div>
        <Label
          htmlFor="reply-note"
          className="mb-2 block text-sm font-medium text-slate-700"
        >
          Your reply / comment
        </Label>
        <Textarea
          id="reply-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. 'Sending the file tomorrow morning.' or 'Please use the logo from our last order.'"
          rows={3}
          className="min-h-[80px]"
        />
      </div>

      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => respond("info_submitted")}
        disabled={loading || !canSend}
        className="w-full rounded-lg bg-[#1d4ed8] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:bg-[#1e40af] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Sending…" : "Send reply"}
      </button>
    </div>
  );
}
