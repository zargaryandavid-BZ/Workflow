import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

const ACCOUNTS_URL = "https://api.instantly.ai/api/v2/accounts?limit=100";

export interface InstantlyAccount {
  email: string;
  status?: number;
  setup_pending?: boolean;
}

let cachedAccounts: InstantlyAccount[] | null = null;
let cacheExpiresAt = 0;

function apiKey() {
  return process.env.INSTANTLY_API_KEY?.trim() ?? "";
}

/** Strip display-name wrappers: `Name <email@x.com>` → `email@x.com` */
export function normalizeEaccount(raw: string): string {
  const value = raw.trim();
  const match = value.match(/<([^>]+)>/);
  return (match ? match[1] : value).trim().toLowerCase();
}

export async function listInstantlyAccounts(
  force = false
): Promise<InstantlyAccount[]> {
  const key = apiKey();
  if (!key) return [];

  const now = Date.now();
  if (!force && cachedAccounts && cacheExpiresAt > now) {
    return cachedAccounts;
  }

  try {
    const res = await fetchWithTimeout(ACCOUNTS_URL, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return cachedAccounts ?? [];

    const json = (await res.json()) as { items?: InstantlyAccount[] };
    cachedAccounts = json.items ?? [];
    cacheExpiresAt = now + 5 * 60 * 1000;
    return cachedAccounts;
  } catch {
    return cachedAccounts ?? [];
  }
}

/**
 * Resolves which Instantly `eaccount` to send from.
 * Must exactly match an email connected in the Instantly workspace.
 */
export async function resolveInstantlyEaccount(
  preferred?: string | null
): Promise<{ eaccount: string | null; available: string[] }> {
  const accounts = await listInstantlyAccounts();
  const available = accounts
    .filter((a) => a.email && !a.setup_pending)
    .map((a) => a.email.toLowerCase());

  if (available.length === 0) {
    return { eaccount: null, available: [] };
  }

  const want = preferred ? normalizeEaccount(preferred) : "";
  if (want && available.includes(want)) {
    return { eaccount: want, available };
  }

  // Same local-part, different TLD (e.g. invites@bazaarprinting.com → orders@bazaarprinting.co)
  if (want) {
    const local = want.split("@")[0];
    const byLocal = available.find((e) => e.startsWith(`${local}@`));
    if (byLocal) return { eaccount: byLocal, available };
  }

  const preferredLocals = ["orders", "team", "info", "sales", "notifications"];
  for (const local of preferredLocals) {
    const hit = available.find((e) => e.startsWith(`${local}@`));
    if (hit) return { eaccount: hit, available };
  }

  return { eaccount: available[0], available };
}

export function instantlyAccountError(
  configured: string | undefined,
  available: string[]
): string {
  const sample = available.slice(0, 4).join(", ");
  if (available.length === 0) {
    return "No email accounts connected in Instantly. Add a sender in the Instantly dashboard.";
  }
  return `Email account not found (${configured ?? "unset"}). Set INSTANTLY_FROM_EMAIL to a connected account, e.g. ${sample}.`;
}

export const INSTANTLY_ERROR_MESSAGES: Record<string, string> = {
  ACC_NOT_FOUND: "Email account not found",
  ACC_AUTH_ERROR: "Instantly could not authenticate the sender account",
  ACC_UNKNOWN_ERROR: "Instantly sender account error",
};
