import {
  parseCatalogPayload,
  type CatalogOptionLists,
} from "@/lib/import-catalog";

export const DEFAULT_CRM_CATALOG_URL =
  process.env.CRM_CATALOG_URL ||
  "https://prod-bazaar-crm.vercel.app/api/catalog";

function defaultCatalogHost(): string {
  try {
    return new URL(DEFAULT_CRM_CATALOG_URL).hostname.toLowerCase();
  } catch {
    return "prod-bazaar-crm.vercel.app";
  }
}

/** Allow known CRM host + localhost (dev). Reject arbitrary SSRF targets. */
export function assertAllowedCatalogUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Invalid catalog URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Catalog URL must be http or https");
  }
  const host = parsed.hostname.toLowerCase();
  const allowed = new Set([
    defaultCatalogHost(),
    "localhost",
    "127.0.0.1",
  ]);
  try {
    if (process.env.CRM_CATALOG_URL) {
      allowed.add(new URL(process.env.CRM_CATALOG_URL).hostname.toLowerCase());
    }
  } catch {
    /* ignore */
  }
  if (!allowed.has(host)) {
    throw new Error(
      `Catalog host not allowed. Use your CRM catalog URL (e.g. ${defaultCatalogHost()}) or leave blank for the default.`
    );
  }
  return parsed;
}

/** Fetch raw CRM catalog JSON (v1 or v2). Caller validates schema. */
export async function fetchCatalogJson(rawUrl?: string | null): Promise<unknown> {
  const urlText =
    typeof rawUrl === "string" && rawUrl.trim()
      ? rawUrl.trim()
      : DEFAULT_CRM_CATALOG_URL;
  const catalogUrl = assertAllowedCatalogUrl(urlText);

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (process.env.CATALOG_FEED_TOKEN) {
    headers.authorization = `Bearer ${process.env.CATALOG_FEED_TOKEN}`;
  }

  const res = await fetch(catalogUrl.toString(), {
    headers,
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Catalog request failed (${res.status})`);
  }
  return res.json();
}

export async function fetchCatalogLists(
  rawUrl?: string | null
): Promise<CatalogOptionLists> {
  const urlText =
    typeof rawUrl === "string" && rawUrl.trim()
      ? rawUrl.trim()
      : DEFAULT_CRM_CATALOG_URL;
  const catalogJson = await fetchCatalogJson(urlText);
  const lists = parseCatalogPayload(catalogJson);
  if (
    lists.categories.length === 0 &&
    lists.products.length === 0 &&
    lists.materials.length === 0
  ) {
    throw new Error("Catalog contained no categories, products, or materials");
  }
  return lists;
}
