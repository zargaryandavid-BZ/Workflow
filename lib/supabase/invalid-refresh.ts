/** Stale cookies after logout / token rotation. */
export function isInvalidRefreshTokenError(
  error: { message?: string; code?: string } | null | undefined
): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  const code = (error.code ?? "").toLowerCase();
  return (
    code.includes("refresh_token") ||
    msg.includes("invalid refresh token") ||
    msg.includes("refresh token not found")
  );
}
