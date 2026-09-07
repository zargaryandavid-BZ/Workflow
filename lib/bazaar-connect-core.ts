/**
 * Pure handshake helpers (no @/ imports) so node:test can load them.
 */

import { timingSafeEqual } from "crypto";
import {
  parseBazaarPortalInboundKeys,
  serializeBazaarPortalInboundKeys,
} from "./bazaar-portal-keys.ts";

export const BAZAAR_CONNECT_HEADER = "x-bazaar-connect-secret";

export type ConnectMode = "send_receive" | "receive_only";

export type ConnectNeedField = {
  id: string;
  label: string;
  type: "text" | "select" | "phone" | "email" | "hidden";
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  help?: string;
};

export class BazaarConnectError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "BazaarConnectError";
    this.status = status;
    this.code = code;
  }
}

export function connectJsonError(err: BazaarConnectError): {
  status: number;
  body: { ok: false; error: string };
} {
  return { status: err.status, body: { ok: false, error: err.code } };
}

function secretsEqual(provided: string, stored: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(stored);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function isAllowedBazaarConnectUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === "https:") return true;
    if (
      u.protocol === "http:" &&
      (u.hostname === "localhost" || u.hostname === "127.0.0.1")
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function parseConnectIntent(body: unknown): "workflow" {
  const intent =
    body && typeof body === "object"
      ? (body as { intent?: unknown }).intent
      : undefined;
  if (intent !== "workflow") {
    throw new BazaarConnectError(400, "invalid_intent");
  }
  return "workflow";
}

export function parseConnectMode(body: unknown): ConnectMode {
  const mode =
    body && typeof body === "object"
      ? (body as { mode?: unknown }).mode
      : undefined;
  if (mode !== "send_receive" && mode !== "receive_only") {
    throw new BazaarConnectError(400, "invalid_mode");
  }
  return mode;
}

export function parseBrokerId(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const raw = (body as { brokerId?: unknown }).brokerId;
  return typeof raw === "string" ? raw.trim() : "";
}

export function partnerLabelFromBody(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const raw = (body as { partnerLabel?: unknown }).partnerLabel;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  const company = (body as { company?: unknown }).company;
  if (!company || typeof company !== "object") return "";
  const name = (company as { name?: unknown }).name;
  return typeof name === "string" ? name.trim() : "";
}

export function answersTenantId(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const answers = (body as { answers?: unknown }).answers;
  if (!answers || typeof answers !== "object") return "";
  const id = (answers as { tenantId?: unknown }).tenantId;
  return typeof id === "string" ? id.trim() : "";
}

export type TenantResolve =
  | { kind: "tenant"; tenantId: string }
  | { kind: "picker"; tenants: Array<{ id: string; name: string }> }
  | { kind: "unauthorized" };

export function resolveConnectTenant(args: {
  providedSecret: string;
  tenantSecrets: Array<{ tenantId: string; secret: string | null | undefined }>;
  envSecret: string | null | undefined;
  tenants: Array<{ id: string; name: string }>;
}): TenantResolve {
  const provided = args.providedSecret.trim();
  if (!provided) return { kind: "unauthorized" };

  const matched: string[] = [];
  for (const row of args.tenantSecrets) {
    const stored = (row.secret ?? "").trim();
    if (!stored) continue;
    if (secretsEqual(provided, stored)) matched.push(row.tenantId);
  }
  if (matched.length === 1) {
    return { kind: "tenant", tenantId: matched[0]! };
  }
  if (matched.length > 1) {
    return { kind: "unauthorized" };
  }

  const env = (args.envSecret ?? "").trim();
  if (!env || !secretsEqual(provided, env)) {
    return { kind: "unauthorized" };
  }

  if (args.tenants.length === 1) {
    return { kind: "tenant", tenantId: args.tenants[0]!.id };
  }
  if (args.tenants.length > 1) {
    return { kind: "picker", tenants: args.tenants };
  }
  return { kind: "unauthorized" };
}

export function upsertPartnerKeyMap(
  raw: unknown,
  brokerId: string,
  osk: string,
  label: string,
  mode?: "send_receive" | "receive_only"
): Record<string, { osk: string; label: string; mode?: "send_receive" | "receive_only" }> {
  const { keys, labels, modes } = parseBazaarPortalInboundKeys(raw);
  keys[brokerId] = osk;
  if (label) labels[brokerId] = label;
  else delete labels[brokerId];
  if (mode) modes[brokerId] = mode;
  const serialized = serializeBazaarPortalInboundKeys(
    Object.entries(keys).map(([id, key]) => ({
      brokerId: id,
      osk: key,
      label: labels[id] ?? "",
      mode: id === brokerId ? mode ?? modes[id] : modes[id],
    }))
  );
  if (!serialized) {
    throw new BazaarConnectError(400, "invalid_inbound_key");
  }
  return serialized;
}

export function removePartnerKey(
  raw: unknown,
  brokerId: string
): {
  next: Record<string, { osk: string; label: string; mode?: "send_receive" | "receive_only" }>;
  empty: boolean;
} {
  const { keys, labels, modes } = parseBazaarPortalInboundKeys(raw);
  delete keys[brokerId];
  delete labels[brokerId];
  delete modes[brokerId];
  const serialized =
    serializeBazaarPortalInboundKeys(
      Object.entries(keys).map(([id, key]) => ({
        brokerId: id,
        osk: key,
        label: labels[id] ?? "",
        mode: modes[id],
      }))
    ) ?? {};
  return { next: serialized, empty: Object.keys(serialized).length === 0 };
}
