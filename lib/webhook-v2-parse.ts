export type WebhookV2Payload = {
  schema_version: 2;
  event_id: string;
  event_type: string;
  crm_order_id: string;
  crm_order_number?: string;
  crm_created_at?: string;
  crm_updated_at: string;
  customer?: {
    crm_id?: string;
    name?: string;
    email?: string;
    phone?: string;
  };
  request_owner?: {
    crm_id?: string;
    name?: string;
    email?: string;
  };
  due_date?: string | null;
  rush?: boolean | string | number;
  is_rush?: boolean | string | number;
  rush_order?: boolean | string | number;
  rush_status?: boolean | string | number;
  line_items: Record<string, unknown>[];
  [key: string]: unknown;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function isCrmWebhookV2(body: unknown): boolean {
  return isRecord(body) && body.schema_version === 2;
}

export function validateWebhookV2(
  body: unknown
): { ok: true; payload: WebhookV2Payload } | { ok: false; error: string } {
  if (!isRecord(body)) return { ok: false, error: "Invalid JSON" };
  const eventId = asTrimmedString(body.event_id);
  const eventType = asTrimmedString(body.event_type);
  const crmOrderId = asTrimmedString(body.crm_order_id);
  const crmUpdatedAt = asTrimmedString(body.crm_updated_at);
  if (!eventId) return { ok: false, error: "event_id is required" };
  if (!eventType) return { ok: false, error: "event_type is required" };
  if (!crmOrderId) return { ok: false, error: "crm_order_id is required" };
  if (!crmUpdatedAt) return { ok: false, error: "crm_updated_at is required" };
  if (!Array.isArray(body.line_items) || body.line_items.length === 0) {
    return { ok: false, error: "line_items must be a non-empty array" };
  }
  return {
    ok: true,
    payload: body as WebhookV2Payload,
  };
}

export function isStaleCrmUpdate(
  existingIso: string | null | undefined,
  incomingIso: string
): boolean {
  if (!existingIso) return false;
  const existingMs = Date.parse(existingIso);
  const incomingMs = Date.parse(incomingIso);
  if (Number.isNaN(existingMs) || Number.isNaN(incomingMs)) return false;
  return existingMs > incomingMs;
}

export function overrideKeysOf(raw: unknown): Set<string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return new Set();
  return new Set(Object.keys(raw as Record<string, unknown>));
}
