import { Download, FileText } from "lucide-react";
import {
  isRespondImageAsset,
  respondAssetUrl,
  respondSkuImageUrl,
  type RespondOrderAsset,
  type RespondOrderRow,
  type RespondSkuImage,
} from "@/lib/respond-order";
import { formatFileSize } from "@/lib/respond-page";
import type { SkuItem } from "@/lib/skus";

interface OrderReviewProps {
  token: string;
  rows: RespondOrderRow[];
  skus: SkuItem[];
  assets: RespondOrderAsset[];
  /** Gallery images from order_sku_images, keyed by sku_id. */
  skuImages?: Record<string, RespondSkuImage[]>;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function OrderRowValue({ value }: { value: string }) {
  const trimmed = value.trim();
  if (isHttpUrl(trimmed)) {
    return (
      <a
        href={trimmed}
        target="_blank"
        rel="noreferrer"
        title={trimmed}
        className="block min-w-0 truncate text-sm font-medium text-blue-600 underline decoration-blue-600/30 underline-offset-2 hover:decoration-blue-600"
      >
        {trimmed}
      </a>
    );
  }
  return (
    <span className="block min-w-0 break-words whitespace-pre-wrap text-sm font-medium text-slate-800">
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

  if (isImage) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="block overflow-hidden rounded-md border border-slate-200 bg-slate-50"
      >
        <img
          src={href}
          alt={asset.file_name}
          className="h-56 w-full object-contain"
        />
      </a>
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

export function OrderReview({
  token,
  rows,
  skus,
  assets,
  skuImages = {},
}: OrderReviewProps) {
  const assetsBySku = new Map<string, RespondOrderAsset>();
  const orderAssets: RespondOrderAsset[] = [];
  for (const asset of assets) {
    if (asset.sku_key) assetsBySku.set(asset.sku_key, asset);
    else orderAssets.push(asset);
  }

  const hasSkus = skus.length > 0;
  const hasAssets = assets.length > 0;
  const hasRows = rows.length > 0;

  if (!hasSkus && !hasAssets && !hasRows) return null;

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        Order details
      </p>

      {hasRows ? (
        <dl className="grid grid-cols-2 gap-2">
          {rows.map((row) => (
            <div
              key={row.label}
              className="min-w-0 overflow-hidden rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
            >
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {row.label}
              </dt>
              <dd className="mt-0.5 min-w-0">
                <OrderRowValue value={row.value} />
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
              const artwork = assetsBySku.get(sku.id);
              const galleryImages = skuImages[sku.id] ?? [];
              const hasArtwork = Boolean(artwork) || galleryImages.length > 0;
              return (
                <li
                  key={sku.id}
                  className="rounded-lg border border-slate-100 bg-slate-50 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800">
                        {sku.name.trim() || `SKU ${index + 1}`}
                      </p>
                      {sku.qty != null ? (
                        <p className="text-xs text-slate-500">Qty: {sku.qty}</p>
                      ) : null}
                    </div>
                  </div>
                  {hasArtwork ? (
                    <div className="mt-2">
                      <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                        Artwork
                      </p>
                      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {artwork ? (
                          <li>
                            <AssetPreview token={token} asset={artwork} />
                            <p className="mt-1 truncate text-[11px] text-slate-500">
                              {artwork.file_name}
                              {artwork.size
                                ? ` · ${formatFileSize(artwork.size)}`
                                : null}
                            </p>
                          </li>
                        ) : null}
                        {galleryImages.map((img) => {
                          const href = respondSkuImageUrl(token, img.id);
                          const isImage = isRespondImageAsset(
                            img.file_name,
                            img.mime_type
                          );
                          return (
                            <li key={img.id}>
                              {isImage ? (
                                <a
                                  href={href}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="block overflow-hidden rounded-md border border-slate-200 bg-slate-50"
                                >
                                  <img
                                    src={href}
                                    alt={img.file_name}
                                    className="h-56 w-full object-contain"
                                  />
                                </a>
                              ) : (
                                <a
                                  href={href}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                                >
                                  <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                                  <span className="min-w-0 truncate">
                                    {img.file_name}
                                  </span>
                                  <Download className="ml-auto h-4 w-4 shrink-0 text-slate-400" />
                                </a>
                              )}
                              <p className="mt-1 truncate text-[11px] text-slate-500">
                                {img.file_name}
                                {img.file_size
                                  ? ` · ${formatFileSize(img.file_size)}`
                                  : null}
                              </p>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}
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
