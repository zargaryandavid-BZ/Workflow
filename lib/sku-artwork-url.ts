import type { Asset } from "@/lib/types";

const BUCKET = "order-assets";
/** Long enough for Pulse to fetch after paste. */
export const SKU_LINK_SIGNED_URL_TTL_SEC = 60 * 60 * 24 * 7;

function isExternalHttpUrl(url: string | null | undefined): boolean {
  const trimmed = url?.trim();
  return Boolean(
    trimmed &&
      (trimmed.startsWith("http://") || trimmed.startsWith("https://"))
  );
}

export function artworkUrlFromAsset(
  asset: Asset | undefined,
  signedUrlByPath: Map<string, string>
): string {
  if (!asset) return "";
  const external = asset.external_url?.trim();
  if (external && isExternalHttpUrl(external)) return external;
  const path = asset.storage_path?.trim();
  if (path) return signedUrlByPath.get(path) ?? "";
  return "";
}

export async function signedUrlsForAssets(
  assets: Asset[],
  signPaths: (paths: string[]) => Promise<Map<string, string>>
): Promise<Map<string, string>> {
  const paths = [
    ...new Set(
      assets
        .map((a) => a.storage_path?.trim())
        .filter((p): p is string => Boolean(p))
    ),
  ];
  if (paths.length === 0) return new Map();
  return signPaths(paths);
}

export function serializeSkusForJobTicketLink(
  skus: { id: string; name: string; qty: number | null }[],
  assetsBySkuKey: Map<string, Asset>,
  signedUrlByPath: Map<string, string>
): string {
  return skus
    .filter((s) => s.name.trim())
    .map((s) => {
      const img = artworkUrlFromAsset(assetsBySkuKey.get(s.id), signedUrlByPath);
      return `${s.name.trim()}|${s.qty ?? ""}|${img}`;
    })
    .join("|");
}

export { BUCKET };
