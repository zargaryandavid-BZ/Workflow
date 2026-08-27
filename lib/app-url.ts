/** Deployed origin used in SMS/email when local NEXT_PUBLIC_APP_URL is localhost. */
export const DEFAULT_PUBLIC_APP_ORIGIN = "https://workflow-rho-one.vercel.app";

function stripSlash(url: string): string {
  return url.replace(/\/$/, "");
}

export function configuredAppUrl(): string {
  return stripSlash(process.env.NEXT_PUBLIC_APP_URL ?? "");
}

export function isLocalhostOrigin(url: string): boolean {
  const raw = url.trim();
  if (!raw) return true;
  try {
    const { hostname } = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return true;
  }
}

/**
 * Base URL for customer-facing links (approval, shipping, short links).
 * Never returns localhost — phones cannot open it.
 */
export function appOrigin(): string {
  const fromEnv = configuredAppUrl();
  if (fromEnv && !isLocalhostOrigin(fromEnv)) return fromEnv;
  const customer = stripSlash(
    process.env.NEXT_PUBLIC_CUSTOMER_APP_URL ?? DEFAULT_PUBLIC_APP_ORIGIN
  );
  return customer || DEFAULT_PUBLIC_APP_ORIGIN;
}

export function isPublicAppUrl(url?: string): boolean {
  return !isLocalhostOrigin(url ?? appOrigin());
}
