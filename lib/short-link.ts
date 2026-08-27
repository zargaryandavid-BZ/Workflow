import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { appOrigin } from "./app-url";

export { appOrigin };

/** Unambiguous alphabet (no 0/O, 1/I/l). */
export const SHORT_LINK_ALPHABET =
  "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export const SHORT_LINK_CODE_LENGTH = 7;

type Client = SupabaseClient;

export function randomShortCode(
  length = SHORT_LINK_CODE_LENGTH
): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += SHORT_LINK_ALPHABET[bytes[i]! % SHORT_LINK_ALPHABET.length];
  }
  return out;
}

/** Path only (`/respond/…`). Rejects protocol-relative or off-site targets. */
export function normalizeTargetPath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  if (trimmed.includes("://")) return null;
  return trimmed;
}

export function shortLinkUrl(code: string): string {
  return `${appOrigin()}/l/${code}`;
}

export function absoluteCustomerUrl(targetPath: string): string {
  const path = normalizeTargetPath(targetPath) ?? targetPath;
  return `${appOrigin()}${path}`;
}

/**
 * Returns a short `/l/{code}` URL for SMS/email.
 * Reuses an existing code for the same tenant + path so reminders stay stable.
 * Falls back to the long URL if the short_links table is not migrated yet.
 */
export async function ensureShortCustomerUrl(
  client: Client,
  tenantId: string,
  targetPath: string
): Promise<string> {
  const path = normalizeTargetPath(targetPath);
  if (!path) return absoluteCustomerUrl(targetPath);

  const { data: existing, error: readError } = await client
    .from("short_links")
    .select("code")
    .eq("tenant_id", tenantId)
    .eq("target_path", path)
    .maybeSingle();

  if (readError) {
    return absoluteCustomerUrl(path);
  }
  if (typeof existing?.code === "string" && existing.code.trim()) {
    return shortLinkUrl(existing.code.trim());
  }

  for (let attempt = 0; attempt < 6; attempt++) {
    const code = randomShortCode();
    const { data: inserted, error } = await client
      .from("short_links")
      .insert({ tenant_id: tenantId, code, target_path: path })
      .select("code")
      .maybeSingle();

    if (!error && typeof inserted?.code === "string") {
      return shortLinkUrl(inserted.code);
    }

    const message = error?.message ?? "";
    const codeConflict =
      message.includes("short_links_code_key") ||
      message.includes("short_links_code");
    const pathConflict =
      message.includes("short_links_tenant_path_key") ||
      message.includes("target_path");

    if (pathConflict) {
      const { data: again } = await client
        .from("short_links")
        .select("code")
        .eq("tenant_id", tenantId)
        .eq("target_path", path)
        .maybeSingle();
      if (typeof again?.code === "string" && again.code.trim()) {
        return shortLinkUrl(again.code.trim());
      }
    }

    if (codeConflict) continue;
    return absoluteCustomerUrl(path);
  }

  return absoluteCustomerUrl(path);
}
