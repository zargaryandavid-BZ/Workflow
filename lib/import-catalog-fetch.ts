import {
  parseCatalogPayload,
  type CatalogOptionLists,
} from "@/lib/import-catalog";

export const DEFAULT_CRM_CATALOG_URL =
  process.env.CRM_CATALOG_URL ||
  "https://prod-bazaar-crm.vercel.app/api/catalog";

/** CRM public catalog pages at 200 products; follow next_cursor until done. */
export const MAX_CATALOG_PAGES = 20;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function catalogPageCursor(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const raw = payload.next_cursor;
  if (typeof raw !== "string") return null;
  const cursor = raw.trim();
  if (!cursor || cursor.toLowerCase() === "null") return null;
  return cursor;
}

function productDedupeKey(item: unknown): string {
  if (!isRecord(item)) return JSON.stringify(item);
  const id = typeof item.id === "string" ? item.id.trim() : "";
  if (id) return `id:${id}`;
  const slug = typeof item.slug === "string" ? item.slug.trim() : "";
  if (slug) return `slug:${slug}`;
  const name = typeof item.name === "string" ? item.name.trim() : "";
  if (name) return `name:${name.toLowerCase()}`;
  return JSON.stringify(item);
}

/** Combine paginated CRM catalog responses into one products list. */
export function mergeCatalogPages(pages: unknown[]): unknown {
  if (pages.length === 0) return {};
  const first = pages[0];
  if (!isRecord(first) || !Array.isArray(first.products)) {
    return pages[pages.length - 1] ?? first;
  }

  const seen = new Set<string>();
  const products: unknown[] = [];
  for (const page of pages) {
    if (!isRecord(page) || !Array.isArray(page.products)) continue;
    for (const item of page.products) {
      const key = productDedupeKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      products.push(item);
    }
  }

  const last = pages[pages.length - 1];
  return {
    ...(isRecord(last) ? last : first),
    ...first,
    products,
    count: products.length,
    next_cursor: null,
  };
}

export function catalogUrlWithCursor(base: URL, cursor: string): URL {
  const next = new URL(base.toString());
  next.searchParams.delete("next_cursor");
  next.searchParams.set("cursor", cursor);
  return next;
}

function catalogHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (process.env.CATALOG_FEED_TOKEN) {
    headers.authorization = `Bearer ${process.env.CATALOG_FEED_TOKEN}`;
  }
  return headers;
}

async function fetchCatalogPage(url: URL): Promise<unknown> {
  const res = await fetch(url.toString(), {
    headers: catalogHeaders(),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Catalog request failed (${res.status})`);
  }
  return res.json();
}

/** Fetch raw CRM catalog JSON (v1 or v2), following next_cursor pages. */
export async function fetchCatalogJson(rawUrl?: string | null): Promise<unknown> {
  const urlText =
    typeof rawUrl === "string" && rawUrl.trim()
      ? rawUrl.trim()
      : DEFAULT_CRM_CATALOG_URL;
  const catalogUrl = assertAllowedCatalogUrl(urlText);

  const pages: unknown[] = [];
  let pageUrl = catalogUrl;
  const seenCursors = new Set<string>();

  for (let i = 0; i < MAX_CATALOG_PAGES; i++) {
    const page = await fetchCatalogPage(pageUrl);
    pages.push(page);
    const cursor = catalogPageCursor(page);
    if (!cursor || seenCursors.has(cursor)) break;
    seenCursors.add(cursor);
    pageUrl = catalogUrlWithCursor(catalogUrl, cursor);
  }

  return mergeCatalogPages(pages);
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
