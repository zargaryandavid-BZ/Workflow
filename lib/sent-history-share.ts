import { createHmac, timingSafeEqual } from "node:crypto";

/** Share links for Scan → Sent history stay valid this long. */
export const SENT_HISTORY_SHARE_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(`sent-history:${payload}`).digest());
}

/** Signed, expiring token naming the tenant whose Sent history is shared. */
export function createSentHistoryShareToken(
  tenantId: string,
  secret: string,
  now: number = Date.now(),
  days: number = SENT_HISTORY_SHARE_DAYS
): string {
  const payload = b64url(JSON.stringify({ t: tenantId, e: now + days * DAY_MS }));
  return `${payload}.${sign(payload, secret)}`;
}

/** Tenant id when the token is genuine and not expired, else null. */
export function verifySentHistoryShareToken(
  token: string,
  secret: string,
  now: number = Date.now()
): string | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined || !secret) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      t?: unknown;
      e?: unknown;
    };
    if (typeof data.t !== "string" || typeof data.e !== "number") return null;
    return data.e > now ? data.t : null;
  } catch {
    return null;
  }
}
