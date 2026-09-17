"use client";

import { useEffect, useState } from "react";
import { Check, Download, FileText, X } from "lucide-react";
import {
  collectSkuApprovalImages,
  isRespondImageAsset,
  respondAssetUrl,
  respondSkuImageUrl,
  type RespondOrderAsset,
  type RespondOrderRow,
  type RespondSkuImage,
  type SkuApprovalImageRef,
  type RespondFinalPdf,
} from "@/lib/respond-order";
import type { SkuItem } from "@/lib/skus";
import { formatFileSize } from "@/lib/respond-page";
import {
  approvalImageSlotCount,
  imageDecisionKey,
  skuLabel,
} from "@/lib/sku-approval";
import { isRollDirectionFieldName, rollDirectionFromRespondRows } from "@/lib/roll-direction";
import type { RespondLayerPreview } from "@/lib/approval-layer-preview-paths";
import {
  RESPOND_SKU_ANCHOR_PREFIX,
  scrollAfterSkuChoice,
  useSkuDecision,
} from "@/components/respond/sku-decision-context";
import { OnRollPreview } from "@/components/respond/on-roll-preview";
import { ProofLayerImages } from "@/components/respond/proof-layer-images";
import { RollDirectionThumb } from "@/components/board/roll-direction-select";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { PdfLoadingBar } from "@/components/pdf/pdf-loading-bar";

interface OrderReviewProps {
  token: string;
  rows: RespondOrderRow[];
  skus: SkuItem[];
  assets: RespondOrderAsset[];
  /** Gallery images from order_sku_images, keyed by sku_id. */
  skuImages?: Record<string, RespondSkuImage[]>;
  /** Optional part heading for multi-item ready-to-ship groups. */
  heading?: string;
  orderId?: string;
  /** Final-for-Prod multilayer PDFs keyed by SKU id. */
  finalPdfs?: Record<string, RespondFinalPdf>;
  /** Per-SKU rasterized proof images (built when staff send approval). */
  layerPreviews?: Record<string, RespondLayerPreview>;
  /**
   * Pre-signed Supabase CDN URLs for layer preview images, keyed by
   * `${fileId}|${rev}|${page}|${layer}`. When present the client uses these
   * directly instead of routing each image through /api/notifications/asset.
   */
  preSignedLayerUrls?: Record<string, string>;
  /** Staff customer note — shown above the SKU list. */
  customerNote?: string | null;
  /** Skip Google Drive PDF lookup (missing-info pages have no proof). */
  skipDrivePdf?: boolean;
  /** Customer approval: production Final PDF only — never ticket screenshots. */
  pdfProofOnly?: boolean;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function OrderRowValue({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  if (isRollDirectionFieldName(label)) {
    return (
      <RollDirectionThumb value={value} className="text-sm font-medium" />
    );
  }
  const trimmed = value.trim();
  if (isHttpUrl(trimmed)) {
    return (
      <a
        href={trimmed}
        target="_blank"
        rel="noreferrer"
        title={trimmed}
        className="block min-w-0 truncate text-xs font-medium text-blue-600 underline decoration-blue-600/30 underline-offset-2 hover:decoration-blue-600"
      >
        {trimmed}
      </a>
    );
  }
  return (
    <span className="block min-w-0 break-words whitespace-pre-wrap text-xs font-medium text-slate-800">
      {value}
    </span>
  );
}

function AssetPreview({
  token,
  asset,
}: {
  token: string;
  asset: RespondOrderAsset;
}) {
  const href = respondAssetUrl(token, asset.id);
  const isImage = isRespondImageAsset(asset.file_name, asset.mime_type);
  const [open, setOpen] = useState(false);

  if (isImage) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="block w-full overflow-hidden rounded-md border border-slate-200 bg-slate-50"
          title="Open large view"
        >
          <img
            src={href}
            alt={asset.file_name}
            className="h-56 w-full object-contain"
          />
        </button>
        {open ? (
          <ImageLightbox
            src={href}
            alt={asset.file_name}
            label={asset.file_name}
            onClose={() => setOpen(false)}
          />
        ) : null}
      </>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
    >
      <FileText className="h-4 w-4 shrink-0 text-slate-400" />
      <span className="min-w-0 truncate">{asset.file_name}</span>
      <Download className="ml-auto h-4 w-4 shrink-0 text-slate-400" />
    </a>
  );
}

function ApprovalChoiceButtons({
  decision,
  onApproved,
  onRejected,
  resultPill = "full",
}: {
  decision: "approved" | "rejected" | undefined;
  onApproved: () => void;
  onRejected: () => void;
  /** SKU header uses a compact pill after submit; per-image uses full width. */
  resultPill?: "full" | "compact";
}) {
  const skuUi = useSkuDecision();

  if (skuUi.mode === "result") {
    if (!decision) return null;
    const approved = decision === "approved";
    return (
      <span
        className={`inline-flex items-center justify-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
          resultPill === "full" ? "w-full" : "shrink-0"
        } ${
          approved
            ? "bg-emerald-100 text-emerald-800"
            : "bg-red-100 text-red-800"
        }`}
      >
        {approved ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
        {approved ? "Approved" : "Not approved"}
      </span>
    );
  }

  if (skuUi.mode !== "choose") return null;

  return (
    <div className="flex w-full min-w-[10rem] flex-col gap-1.5">
      <button
        type="button"
        onClick={onApproved}
        className={`inline-flex h-11 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border-2 px-3 text-sm font-bold shadow-sm ${
          decision === "approved"
            ? "border-emerald-600 bg-emerald-600 text-white"
            : "border-emerald-600 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
        }`}
      >
        <Check className="h-4 w-4 shrink-0" strokeWidth={2.5} />
        Approve
      </button>
      <button
        type="button"
        onClick={onRejected}
        className={`inline-flex h-11 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border-2 px-3 text-sm font-bold shadow-sm ${
          decision === "rejected"
            ? "border-red-600 bg-red-600 text-white"
            : "border-red-600 bg-red-50 text-red-800 hover:bg-red-100"
        }`}
      >
        <X className="h-4 w-4 shrink-0" strokeWidth={2.5} />
        Not approved
      </button>
    </div>
  );
}

function ImageDecisionControls({
  skuId,
  assetId,
}: {
  skuId: string;
  assetId: string;
}) {
  const skuUi = useSkuDecision();
  const key = imageDecisionKey(skuId, assetId);
  const decision = skuUi.byImageKey?.[key];

  if (skuUi.mode === "result") {
    return (
      <ApprovalChoiceButtons
        decision={decision}
        onApproved={() => undefined}
        onRejected={() => undefined}
      />
    );
  }

  if (skuUi.mode !== "choose" || !skuUi.onImageChange) return null;

  return (
    <ApprovalChoiceButtons
      decision={decision}
      onApproved={() => {
        skuUi.onImageChange?.(skuId, assetId, "approved");
        scrollAfterSkuChoice(skuId, skuUi.skuIds ?? []);
      }}
      onRejected={() => {
        skuUi.onImageChange?.(skuId, assetId, "rejected");
        scrollAfterSkuChoice(skuId, skuUi.skuIds ?? []);
      }}
    />
  );
}

function SkuDecisionControls({ skuId }: { skuId: string }) {
  const skuUi = useSkuDecision();
  const decision = skuUi.byId[skuId];

  if (skuUi.mode === "result") {
    return (
      <ApprovalChoiceButtons
        decision={decision}
        onApproved={() => undefined}
        onRejected={() => undefined}
        resultPill="compact"
      />
    );
  }

  if (skuUi.mode !== "choose" || !skuUi.onChange) return null;

  return (
    <div className="w-[10.5rem] shrink-0">
      <ApprovalChoiceButtons
        decision={decision}
        onApproved={() => {
          skuUi.onChange?.(skuId, "approved");
          scrollAfterSkuChoice(skuId, skuUi.skuIds ?? []);
        }}
        onRejected={() => {
          skuUi.onChange?.(skuId, "rejected");
          scrollAfterSkuChoice(skuId, skuUi.skuIds ?? []);
        }}
      />
    </div>
  );
}

function SkuArtworkBlock({
  token,
  orderId,
  skuArt,
  multiImage,
  skuId,
  finalPdf,
  pdfPending = false,
  rollDirection,
  labelWidthIn,
  labelHeightIn,
  layerPreview = null,
  pdfProofOnly = false,
  preSignedLayerUrls,
  showPdfLoadingBar = true,
  onPdfDrawn,
}: {
  token: string;
  orderId?: string;
  skuArt: SkuApprovalImageRef[];
  multiImage: boolean;
  skuId: string;
  finalPdf: RespondFinalPdf | null;
  pdfPending?: boolean;
  rollDirection: ReturnType<typeof rollDirectionFromRespondRows>;
  labelWidthIn?: number | null;
  labelHeightIn?: number | null;
  layerPreview?: RespondLayerPreview | null;
  pdfProofOnly?: boolean;
  preSignedLayerUrls?: Record<string, string>;
  showPdfLoadingBar?: boolean;
  onPdfDrawn?: () => void;
}) {
  const canShowPdf = Boolean(
    orderId && (layerPreview || (!pdfProofOnly && finalPdf))
  );
  const pdfOn = canShowPdf;
  const [photoOnRoll, setPhotoOnRoll] = useState(true);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const skuUi = useSkuDecision();
  const showUploads = !pdfProofOnly && skuArt.length > 0 && !pdfOn;

  if (!canShowPdf && !pdfPending && !showUploads) {
    if (pdfProofOnly) {
      return (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Proof pictures are being prepared. This page will update when they
          are ready — you do not need a new email.
        </p>
      );
    }
    return null;
  }

  return (
    <div className="mt-2">
      {pdfPending && !layerPreview && showPdfLoadingBar ? <PdfLoadingBar /> : null}
      {pdfOn && orderId && layerPreview ? (
        <ProofLayerImages
          token={token}
          orderId={orderId}
          preview={layerPreview}
          fileName={finalPdf?.fileName ?? layerPreview.fileName}
          rollDirection={rollDirection}
          labelWidthIn={labelWidthIn}
          labelHeightIn={labelHeightIn}
          preSignedLayerUrls={preSignedLayerUrls}
          onReady={() => {
            skuUi.setPdfPageCount?.(skuId, 1);
            onPdfDrawn?.();
          }}
        />
      ) : pdfProofOnly && !layerPreview ? (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Proof pictures are being prepared. This page will update when they
          are ready — you do not need a new email.
        </p>
      ) : null}
      {showUploads ? (
        <>
          <p className="mb-2 mt-3 text-[10px] font-medium uppercase tracking-wide text-slate-400">
            Artwork
          </p>
          <ul
            className={
              multiImage
                ? "grid grid-cols-2 gap-2 sm:grid-cols-3"
                : "mx-auto flex w-full max-w-xl flex-col"
            }
          >
            {skuArt.map((img, imgIdx) => {
              const href =
                img.source === "gallery"
                  ? respondSkuImageUrl(token, img.id)
                  : respondAssetUrl(token, img.id);
              const isImage = isRespondImageAsset(img.file_name, img.mime_type);
              return (
                <li key={img.id} className="space-y-1.5">
                  {isImage ? (
                    <button
                      type="button"
                      onClick={() => setLightboxIndex(imgIdx)}
                      className="flex w-full items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-50"
                      title="Open large view"
                    >
                      <img
                        src={href}
                        alt={img.file_name}
                        className={
                          multiImage
                            ? "aspect-square w-full object-cover"
                            : "mx-auto max-h-[28rem] w-auto max-w-full object-contain"
                        }
                      />
                    </button>
                  ) : (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                    >
                      <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                      <span className="min-w-0 truncate">{img.file_name}</span>
                      <Download className="ml-auto h-4 w-4 shrink-0 text-slate-400" />
                    </a>
                  )}
                  <p className="truncate text-center text-[11px] text-slate-500">
                    {multiImage ? `Image ${imgIdx + 1}` : img.file_name}
                    {!multiImage && img.size
                      ? ` · ${formatFileSize(img.size)}`
                      : null}
                  </p>
                  {multiImage ? (
                    <ImageDecisionControls skuId={skuId} assetId={img.id} />
                  ) : null}
                </li>
              );
            })}
          </ul>
          {lightboxIndex != null ? (
            <ImageLightbox
              images={skuArt
                .filter((img) =>
                  isRespondImageAsset(img.file_name, img.mime_type)
                )
                .map((img) => ({
                  src:
                    img.source === "gallery"
                      ? respondSkuImageUrl(token, img.id)
                      : respondAssetUrl(token, img.id),
                  alt: img.file_name,
                  label: img.file_name,
                }))}
              initialIndex={Math.min(
                lightboxIndex,
                Math.max(
                  0,
                  skuArt.filter((img) =>
                    isRespondImageAsset(img.file_name, img.mime_type)
                  ).length - 1
                )
              )}
              onClose={() => setLightboxIndex(null)}
            />
          ) : null}
          {!pdfOn && rollDirection
            ? (() => {
                const first = skuArt.find((img) =>
                  isRespondImageAsset(img.file_name, img.mime_type)
                );
                if (!first) return null;
                const href =
                  first.source === "gallery"
                    ? respondSkuImageUrl(token, first.id)
                    : respondAssetUrl(token, first.id);
                return (
                  <div className="mt-3">
                    <div className="mb-2 flex items-center justify-end gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Roll preview
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={photoOnRoll}
                        onClick={() => setPhotoOnRoll((v) => !v)}
                        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
                          photoOnRoll ? "bg-blue-600" : "bg-slate-200"
                        }`}
                      >
                        <span className="sr-only">Show artwork on roll</span>
                        <span
                          className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                            photoOnRoll ? "translate-x-6" : "translate-x-1"
                          }`}
                        />
                      </button>
                    </div>
                    {photoOnRoll ? (
                      <OnRollPreview
                        artworkSrc={href}
                        direction={rollDirection}
                        labelWidthIn={labelWidthIn}
                        labelHeightIn={labelHeightIn}
                      />
                    ) : null}
                  </div>
                );
              })()
            : null}
        </>
      ) : null}
    </div>
  );
}

function CustomerNoteBlock({ note }: { note: string }) {
  return (
    <div className="mb-3 rounded-md border border-sky-100 bg-sky-50 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-700">
        Customer note
      </p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">
        {note}
      </p>
    </div>
  );
}

export function OrderReview({
  token,
  rows,
  skus,
  assets,
  skuImages = {},
  heading,
  orderId,
  finalPdfs = {},
  layerPreviews: layerPreviewsProp = {},
  preSignedLayerUrls,
  customerNote,
  skipDrivePdf = false,
  pdfProofOnly = false,
}: OrderReviewProps) {
  const skuUi = useSkuDecision();
  const orderAssets: RespondOrderAsset[] = pdfProofOnly
    ? []
    : assets.filter((a) => !a.sku_key);
  const rollDirection = rollDirectionFromRespondRows(rows);

  // Extract label dimensions from order rows for the roll preview sizing.
  const labelWidthIn = parseFloat(
    rows.find((r) => r.label.trim().toLowerCase() === "width")?.value ?? ""
  ) || null;
  const labelHeightIn = parseFloat(
    rows.find((r) => r.label.trim().toLowerCase() === "height")?.value ?? ""
  ) || null;
  const [drivePdfs, setDrivePdfs] = useState(finalPdfs);
  const [driveSkus, setDriveSkus] = useState(skus);
  const [layerBySku, setLayerBySku] = useState<
    Record<string, RespondLayerPreview>
  >(layerPreviewsProp);
  const [pdfDrawn, setPdfDrawn] = useState(
    () => Object.keys(layerPreviewsProp).length > 0
  );
  const [pdfPending, setPdfPending] = useState(
    () =>
      Object.keys(finalPdfs).length === 0 &&
      Object.keys(layerPreviewsProp).length === 0 &&
      Boolean(orderId)
  );

  useEffect(() => {
    setPdfDrawn(Object.keys(layerPreviewsProp).length > 0);
  }, [token, orderId]);

  useEffect(() => {
    if (!orderId) {
      setPdfPending(false);
      return;
    }
    const hasLayerPics =
      Object.keys(layerPreviewsProp).length > 0;
    if (hasLayerPics) {
      setDrivePdfs(finalPdfs);
      setLayerBySku(layerPreviewsProp);
      setPdfPending(false);
      return;
    }
    let cancelled = false;
    let attempt = 0;
    const maxAttempts = 6;
    let retryTimer: number | undefined;

    const run = () => {
      if (cancelled) return;
      setPdfPending(true);
      void fetch(
        `/api/notifications/final-artwork?token=${encodeURIComponent(token)}&order=${encodeURIComponent(orderId)}`
      )
        .then(async (res) => {
          const data = (await res.json()) as {
            skus?: SkuItem[];
            bySku?: Record<string, RespondFinalPdf>;
            layerPreviews?: Record<string, RespondLayerPreview>;
          };
          if (cancelled) return;
          if (res.ok && data.bySku) setDrivePdfs(data.bySku);
          if (res.ok && Array.isArray(data.skus) && data.skus.length > 0) {
            setDriveSkus(data.skus);
          }
          const layers = data.layerPreviews ?? {};
          if (res.ok && Object.keys(layers).length > 0) {
            setLayerBySku(layers);
            setPdfDrawn(true);
            setPdfPending(false);
            return true;
          }
          return false;
        })
        .catch(() => false)
        .then((done) => {
          if (cancelled || done) return;
          attempt += 1;
          if (attempt < maxAttempts) {
            retryTimer = window.setTimeout(run, attempt === 1 ? 4000 : 8000);
          } else {
            setPdfPending(false);
          }
        });
    };

    run();
    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [token, orderId]);

  const reviewSkus = driveSkus;
  const reviewPdfs = Object.keys(drivePdfs).length > 0 ? drivePdfs : finalPdfs;
  const hasLayerPics = Object.keys(layerBySku).length > 0;
  const proofWaiting = pdfPending && !hasLayerPics;

  const note = customerNote?.trim() || "";
  const hasSkus = reviewSkus.length > 0;
  const hasAssets = assets.length > 0;
  const hasRows = rows.length > 0;

  if (!hasSkus && !hasAssets && !hasRows && !note && !pdfPending) return null;

  return (
    <div className="space-y-2.5 rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {heading?.trim() || "Order details"}
      </p>

      {hasRows ? (
        <dl className="grid grid-cols-2 gap-1.5">
          {rows.map((row) => (
            <div
              key={row.label}
              className="min-w-0 overflow-hidden rounded-md border border-slate-100 bg-slate-50 px-2 py-1"
            >
              <dt className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">
                {row.label}
              </dt>
              <dd className="mt-0 min-w-0 leading-tight">
                <OrderRowValue label={row.label} value={row.value} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {hasSkus ? (
        <div>
          {note ? <CustomerNoteBlock note={note} /> : null}
          <div className="relative min-h-[16rem]">
            {proofWaiting ? (
              <div className="absolute inset-0 z-10 bg-white">
                <PdfLoadingBar />
              </div>
            ) : null}
            <div className={proofWaiting ? "invisible" : undefined}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            SKUs
          </p>
          <ul className="space-y-3">
            {reviewSkus.map((sku, index) => {
              const skuArt = pdfProofOnly
                ? []
                : collectSkuApprovalImages(sku.id, assets, skuImages);
              const multiImage = skuArt.length >= 2;
              const pdfPages = skuUi.pdfPageCountBySku?.[sku.id] ?? 0;
              const perImage =
                approvalImageSlotCount(
                  skuArt.length,
                  pdfPages,
                  finalPdfs[sku.id]?.page
                ) >= 2;
              const number = index + 1;
              const decision = skuUi.byId[sku.id];
              const resultBorder =
                skuUi.mode === "result" && decision === "approved"
                  ? "border-emerald-200 bg-emerald-50/70"
                  : skuUi.mode === "result" && decision === "rejected"
                    ? "border-red-200 bg-red-50/70"
                    : skuUi.mode === "choose" && decision === "approved"
                      ? "border-emerald-200 bg-white"
                      : skuUi.mode === "choose" && decision === "rejected"
                        ? "border-red-200 bg-white"
                        : "border-slate-100 bg-slate-50";
              return (
                <li
                  key={sku.id}
                  id={`${RESPOND_SKU_ANCHOR_PREFIX}${sku.id}`}
                  className={`scroll-mt-4 rounded-lg border p-4 ${resultBorder}`}
                >
                  {index === 0 && skuUi.mode === "choose" ? (
                    <p className="mb-3 text-sm leading-relaxed text-slate-600">
                      Your print proof is ready. Please Approve or Not
                      Approved each SKU. Each PDF page is one SKU. If a
                      page has several print layers, each layer is its own
                      picture — use the SEE LAYERS checkboxes.
                    </p>
                  ) : null}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        SKU {number}
                      </p>
                      <p className="mt-0.5 text-sm font-medium text-slate-800">
                        {sku.name.trim() || skuLabel(number)}
                      </p>
                      {sku.qty != null ? (
                        <p className="text-xs text-slate-500">Qty: {sku.qty}</p>
                      ) : null}
                    </div>
                    {perImage ? null : <SkuDecisionControls skuId={sku.id} />}
                  </div>
                  <SkuArtworkBlock
                    token={token}
                    orderId={orderId}
                    skuArt={skuArt}
                    multiImage={multiImage}
                    skuId={sku.id}
                    finalPdf={reviewPdfs[sku.id] ?? null}
                    pdfPending={false}
                    rollDirection={rollDirection}
                    labelWidthIn={labelWidthIn}
                    labelHeightIn={labelHeightIn}
                    layerPreview={layerBySku[sku.id] ?? null}
                    pdfProofOnly={pdfProofOnly}
                    preSignedLayerUrls={preSignedLayerUrls}
                    showPdfLoadingBar={!proofWaiting}
                    onPdfDrawn={
                      index === 0 ? () => setPdfDrawn(true) : undefined
                    }
                  />
                </li>
              );
            })}
          </ul>
            </div>
          </div>
        </div>
      ) : pdfPending ? (
        <PdfLoadingBar />
      ) : note ? (
        <CustomerNoteBlock note={note} />
      ) : null}

      {orderAssets.length > 0 ? (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Files &amp; artwork
          </p>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {orderAssets.map((asset) => (
              <li key={asset.id}>
                <AssetPreview token={token} asset={asset} />
                <p className="mt-1 truncate text-[11px] text-slate-500">
                  {asset.file_name}
                  {asset.size ? ` · ${formatFileSize(asset.size)}` : null}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
