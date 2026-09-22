/**
 * Build app URLs for admin-generated Auth emails.
 *
 * `generateLink().properties.action_link` hits Supabase `/auth/v1/verify`.
 * Mail scanners (Safe Links, etc.) GET that URL and burn the one-time token
 * before the teammate opens the message. Linking to our app with
 * `token_hash` + client `verifyOtp` keeps the token unused until they land.
 */

export type AuthEmailLinkType =
  | "recovery"
  | "invite"
  | "signup"
  | "magiclink"
  | "email";

export function appOriginFromEnv(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
    /\/$/,
    ""
  );
}

export function hashedTokenFromGenerateLink(properties: {
  hashed_token?: string | null;
} | null | undefined): string | null {
  return properties?.hashed_token?.trim() || null;
}

export function buildAppAuthVerifyUrl(args: {
  origin: string;
  path: string;
  hashedToken: string;
  type: AuthEmailLinkType;
  extra?: Record<string, string | null | undefined>;
}): string {
  const origin = args.origin.replace(/\/$/, "");
  const path = args.path.startsWith("/") ? args.path : `/${args.path}`;
  const url = new URL(path, `${origin}/`);
  url.searchParams.set("token_hash", args.hashedToken);
  url.searchParams.set("type", args.type);
  for (const [key, value] of Object.entries(args.extra ?? {})) {
    if (value?.trim()) url.searchParams.set(key, value.trim());
  }
  return url.toString();
}

/** Turn generateLink `redirectTo` + hashed_token into an email URL on our app. */
export function appAuthUrlFromRedirect(args: {
  redirectTo: string;
  hashedToken: string;
  type: AuthEmailLinkType;
}): string {
  const dest = new URL(args.redirectTo);
  const extra: Record<string, string> = {};
  dest.searchParams.forEach((value, key) => {
    if (key === "token_hash" || key === "type") return;
    extra[key] = value;
  });
  return buildAppAuthVerifyUrl({
    origin: dest.origin,
    path: dest.pathname,
    hashedToken: args.hashedToken,
    type: args.type,
    extra,
  });
}
