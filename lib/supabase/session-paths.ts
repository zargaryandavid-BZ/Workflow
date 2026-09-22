/** Customer/token pages — never wait on staff session refresh. */
export const PUBLIC_PATHS = [
  "/login",
  "/signup",
  "/set-password",
  "/approve",
  "/respond",
  "/shipping",
  "/warehouse-confirm",
  "/die",
  "/l",
  "/auth",
];

/** Still refresh/clear cookies here so a dead refresh token doesn't overlay login. */
const SESSION_COOKIE_PUBLIC_PATHS = ["/login", "/signup"];

const PUBLIC_API_PREFIXES = [
  "/api/webhook/",
  "/api/public/",
  "/api/notifications/respond",
  "/api/notifications/upload",
  "/api/notifications/asset",
  "/api/notifications/final-artwork",
  "/api/approvals/decide",
  "/api/shipping/",
  "/api/warehouse-confirm/",
  "/api/die/",
  "/api/webhooks/",
  "/api/auth/",
  "/api/admin/bazaar-connect/",
];

export function isPublicPage(path: string): boolean {
  return PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

export function isPublicApi(path: string): boolean {
  return PUBLIC_API_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(prefix)
  );
}

function isSessionCookiePublicPath(path: string): boolean {
  return SESSION_COOKIE_PUBLIC_PATHS.some(
    (p) => path === p || path.startsWith(`${p}/`)
  );
}

/** Skip getUser() — expired cookies must not block customer token pages. */
export function skipSupabaseSessionUpdate(path: string): boolean {
  if (path === "/api/pdf-worker") return true;
  if (isPublicApi(path)) return true;
  if (isSessionCookiePublicPath(path)) return false;
  return isPublicPage(path);
}
