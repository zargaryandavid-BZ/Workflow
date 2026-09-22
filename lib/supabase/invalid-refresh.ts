/** Stale cookies after logout / token rotation. */
export function isInvalidRefreshTokenError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const rec = error as { message?: unknown; code?: unknown; name?: unknown };
  const msg = String(rec.message ?? "").toLowerCase();
  const code = String(rec.code ?? "").toLowerCase();
  return (
    code.includes("refresh_token") ||
    msg.includes("invalid refresh token") ||
    msg.includes("refresh token not found")
  );
}
