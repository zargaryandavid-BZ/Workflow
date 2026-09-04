"use client";

import { Suspense, useState } from "react";
import dynamic from "next/dynamic";
import { Check, Download, FileText, X } from "lucide-react";
import {
  collectSkuApprovalImages,
  isRespondImageAsset,
  respondAssetUrl,
  respondFinalPdfUrl,
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
import { useSkuDecision } from "@/components/respond/sku-decision-context";
import { OnRollPreview } from "@/components/respond/on-roll-preview";
import { RollDirectionThumb } from "@/components/board/roll-direction-select";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { PdfLoadingBar } from "@/components/pdf/pdf-loading-bar";

const PdfOcgFromUrl = dynamic(
  () =>
    import("@/components/pdf/pdf-ocg-from-url").then((m) => m.PdfOcgFromUrl),
  { ssr: false }
);

function PdfPreviewLoading({ fileName }: { fileName: string }) {
  return (
    <div className="flex min-h-[16rem] flex-col overflow-hidden rounded-md border border-slate-200 bg-white">
      <div className="shrink-0 border-b border-slate-100 px-3 py-2">
        <span className="min-w-0 truncate text-sm font-medium text-slate-600">
          {fileName}
        </span>
      </div>
      <PdfLoadingBar />
    </div>
  );
}

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
    if (!decision) return null;
    const approved = decision === "approved";
    return (
      <span
        className={`inline-flex w-full items-center justify-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
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

  if (skuUi.mode !== "choose" || !skuUi.onImageChange) return null;

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => skuUi.onImageChange?.(skuId, assetId, "approved")}
        className={`inline-flex w-full items-center justify-center gap-1 whitespace-nowrap rounded-lg border px-2 py-1 text-[11px] font-medium ${
          decision === "approved"
            ? "border-emerald-400 bg-emerald-50 text-emerald-800"
            : "border-emerald-200 bg-white text-emerald-700 hover:border-emerald-400 hover:bg-emerald-50"
        }`}
      >
        <Check className="h-3 w-3 shrink-0" />
        Approve
      </button>
      <button
        type="button"
        onClick={() => skuUi.onImageChange?.(skuId, assetId, "rejected")}
        className={`inline-flex w-full items-center justify-center gap-1 whitespace-nowrap rounded-lg border px-2 py-1 text-[11px] font-medium ${
          decision === "rejected"
            ? "border-red-400 bg-red-50 text-red-800"
            : "border-red-200 bg-white text-red-700 hover:border-red-400 hover:bg-red-50"
        }`}
      >
        <X className="h-3 w-3 shrink-0" />
        Not approved
      </button>
    </div>
  );
}

function SkuDecisionControls({ skuId }: { skuId: string }) {
  const skuUi = useSkuDecision();
  const decision = skuUi.byId[skuId];

  if (skuUi.mode === "result") {
    if (!decision) return null;
    const approved = decision === "approved";
    return (
      <span
        className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
          approved
            ? "bg-emerald-100 text-emerald-800"
            : "bg-red-100 text-red-800"
        }`}
      >
        {approved ? (
          <Check className="h-3 w-3" />
        ) : (
          <X className="h-3 w-3" />
        )}
        {approved ? "Approved" : "Not approved"}
      </span>
    );
  }

  if (skuUi.mode !== "choose" || !skuUi.onChange) return null;

  return (
    <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row">
      <label
        className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium ${
          decision === "approved"
            ? "border-emerald-300 bg-emerald-50 text-emerald-800"
            : "border-slate-200 bg-white text-slate-600"
        }`}
      >
        <input
          type="checkbox"
          className="h-3.5 w-3.5 accent-emerald-600"
          checked={decision === "approved"}
          onChange={() => skuUi.onChange?.(skuId, "approved")}
        />
        Approve
      </label>
      <label
        className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium ${
          decision === "rejected"
            ? "border-red-300 bg-red-50 text-red-800"
            : "border-slate-200 bg-white text-slate-600"
        }`}
      >
        <input
          type="checkbox"
          className="h-3.5 w-3.5 accent-red-600"
          checked={decision === "rejected"}
          onChange={() => skuUi.onChange?.(skuId, "rejected")}
        />
        Not approved
      </label>
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
  rollDirection,
}: {
  token: string;
  orderId?: string;
  skuArt: SkuApprovalImageRef[];
  multiImage: boolean;
  skuId: string;
  finalPdf: RespondFinalPdf | null;
  rollDirection: ReturnType<typeof rollDirectionFromRespondRows>;
}) {
  const canShowPdf = Boolean(finalPdf && orderId);
  const pdfOn = canShowPdf;
  const [photoOnRoll, setPhotoOnRoll] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const skuUi = useSkuDecision();
  const pdfPages = skuUi.pdfPageCountBySku?.[skuId] ?? 0;
  const perImage =
    approvalImageSlotCount(skuArt.length, pdfPages, finalPdf?.page) >= 2;

  if (skuArt.length === 0 && !canShowPdf) return null;

  return (
    <div className="mt-2">
      {pdfOn && finalPdf && orderId ? (
        <Suspense fallback={<PdfPreviewLoading fileName={finalPdf.fileName} />}>
          <PdfOcgFromUrl
            src={respondFinalPdfUrl(token, orderId, finalPdf.fileId)}
            fileName={finalPdf.fileName}
            page={finalPdf.page}
            layout={finalPdf.page != null ? "single" : "grid"}
            rollDirection={rollDirection}
            onPageCount={(n) =>
              skuUi.setPdfPageCount?.(
                skuId,
                finalPdf.page != null ? 1 : n
              )
            }
            renderPageActions={
              finalPdf.page == null && (perImage || pdfPages > 1)
                ? (page) => (
                    <ImageDecisionControls
                      skuId={skuId}
                      assetId={`pdfpage:${page}`}
                    />
                  )
                : undefined
            }
          />
        </Suspense>
      ) : null}
      {skuArt.length > 0 && !pdfOn ? (
        <>
          <p className="mb-2 mt-3 text-[10px] font-medium uppercase tracking-wide text-slate-400">
            Artwork
          </p>
          <ul
            className={`grid gap-2 ${
              multiImage
                ? "grid-cols-2 sm:grid-cols-3"
                : "grid-cols-1 sm:grid-cols-2"
            }`}
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
                      className="block w-full overflow-hidden rounded-md border border-slate-200 bg-slate-50"
                      title="Open large view"
                    >
                      <img
                        src={href}
                        alt={img.file_name}
                        className={
                          multiImage
                            ? "aspect-square w-full object-cover"
                            : "h-[28rem] w-full object-contain"
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

export function OrderReview({
  token,
  rows,
  skus,
  assets,
  skuImages = {},
  heading,
  orderId,
  finalPdfs = {},
}: OrderReviewProps) {
  const skuUi = useSkuDecision();
  const orderAssets: RespondOrderAsset[] = assets.filter((a) => !a.sku_key);
  const rollDirection = rollDirectionFromRespondRows(rows);

  const hasSkus = skus.length > 0;
  const hasAssets = assets.length > 0;
  const hasRows = rows.length > 0;

  if (!hasSkus && !hasAssets && !hasRows) return null;

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
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            SKUs
          </p>
          <ul className="space-y-3">
            {skus.map((sku, index) => {
              const skuArt = collectSkuApprovalImages(sku.id, assets, skuImages);
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
                  className={`rounded-lg border p-4 ${resultBorder}`}
                >
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
                    finalPdf={finalPdfs[sku.id] ?? null}
                    rollDirection={rollDirection}
                  />
                </li>
              );
            })}
          </ul>
        </div>
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
