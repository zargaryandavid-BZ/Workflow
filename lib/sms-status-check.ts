/**
 * Client "START" / "CHECK" status line over SMS (pure helpers — no I/O).
 *
 * Conversation:
 *   client: START (or CHECK)
 *   us:     menu (1 = orders under this phone number, 2 = by job ticket number)
 *   client: 1  → open orders for the customer with this phone (latest 5)
 *   client: 2  → "Send us your job ticket number"
 *   client: 15683 → status of that job (any phone may ask)
 *
 *   client: 3  → FedEx tracking for orders under this phone
 *   client: 4  → open proof-approval links for orders under this phone
 * Shortcuts that skip the menu: "CHECK 1", "CHECK 2 15683", "CHECK 15683", "CHECK 3", "CHECK 4" (same with START).
 * Anything else while the menu is open → "Command not found" (the text still reaches the card).
 * The step the client is on rides in a Twilio SMS cookie (Twilio keeps
 * cookies per phone pair for up to 4 hours), so no table is needed.
 */

export type SmsCheckState = "menu" | "job";

export const SMS_CHECK_COOKIE = "pp_sms_check";
/** How long a menu / "send your job number" step stays open. */
export const SMS_CHECK_STATE_TTL_SECONDS = 15 * 60;
export const SMS_CHECK_MAX_ORDERS = 5;
/** A job ticket number can cover several board cards (15683-1, -2, -3…). */
export const SMS_CHECK_MAX_JOB_PARTS = 10;
/** Tracking / proof links per reply (links are long — keep the text short). */
export const SMS_CHECK_MAX_LINKS = 3;

export type SmsCheckAction =
  | { kind: "menu" }
  | { kind: "by_phone" }
  /** 3 — FedEx tracking for orders under this phone. */
  | { kind: "tracking" }
  /** 4 — open proof-approval links for orders under this phone. */
  | { kind: "proof" }
  | { kind: "ask_job" }
  | { kind: "job"; jobNumber: string }
  | { kind: "bad_job" }
  /** Not part of the CHECK flow — handle the message as a normal client reply. */
  /** Inside the menu but not 1 / 2 — reply "Command not found", then treat the text as a normal reply. */
  | { kind: "unknown" }
  | { kind: "none" };

/** Words that open the menu. START is also Twilio's re-subscribe keyword (Twilio sends its own reply too). */
const CHECK_RE = /^(?:check|start)\b[\s:.\-#]*(.*)$/i;

/** Job ticket number as typed by the client → safe lookup token (`#15683-2` → `15683-2`), or null. */
export function normalizeJobNumber(raw: string): string | null {
  const t = raw
    .trim()
    .replace(/^#/, "")
    .replace(/\s+/g, "")
    .toUpperCase();
  if (!t || t.length > 32) return null;
  if (!/^[A-Z0-9-]+$/.test(t)) return null;
  if (!/\d/.test(t)) return null;
  return t;
}

/** Read the CHECK step from the Cookie header Twilio sends back. */
export function readSmsCheckState(cookieHeader: string | null | undefined): SmsCheckState | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === SMS_CHECK_COOKIE) {
      const v = rest.join("=").trim();
      return v === "menu" || v === "job" ? v : null;
    }
  }
  return null;
}

/** Set-Cookie value for the next step (null clears it). */
export function smsCheckStateCookie(state: SmsCheckState | null): string {
  return state
    ? `${SMS_CHECK_COOKIE}=${state}; Max-Age=${SMS_CHECK_STATE_TTL_SECONDS}; Path=/`
    : `${SMS_CHECK_COOKIE}=; Max-Age=0; Path=/`;
}

/** Decide what an inbound text means given the open CHECK step (if any). */
export function parseSmsCheck(body: string, state: SmsCheckState | null): SmsCheckAction {
  const text = body.trim();
  const check = CHECK_RE.exec(text);
  if (check) {
    const rest = check[1].trim();
    if (!rest) return { kind: "menu" };
    if (/^1$/.test(rest)) return { kind: "by_phone" };
    if (/^3$/.test(rest)) return { kind: "tracking" };
    if (/^4$/.test(rest)) return { kind: "proof" };
    const two = /^2\b[\s:.\-#]*(.*)$/.exec(rest);
    if (two) {
      const job = two[1].trim();
      if (!job) return { kind: "ask_job" };
      const n = normalizeJobNumber(job);
      return n ? { kind: "job", jobNumber: n } : { kind: "bad_job" };
    }
    const n = normalizeJobNumber(rest);
    return n ? { kind: "job", jobNumber: n } : { kind: "menu" };
  }

  if (state === "menu") {
    if (/^1\.?$/.test(text)) return { kind: "by_phone" };
    if (/^2\.?$/.test(text)) return { kind: "ask_job" };
    if (/^3\.?$/.test(text)) return { kind: "tracking" };
    if (/^4\.?$/.test(text)) return { kind: "proof" };
    return { kind: "unknown" };
  }
  if (state === "job") {
    const n = normalizeJobNumber(text);
    return n ? { kind: "job", jobNumber: n } : { kind: "bad_job" };
  }
  return { kind: "none" };
}

/**
 * Client-facing status for a workflow column. Internal column names
 * (designer names, Hold, Prepress, …) are never sent to clients.
 */
export function clientStatusForColumn(columnName: string | null | undefined): string {
  const n = (columnName ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}/:\s.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!n) return "In progress";
  if (n.startsWith("finished")) return "Completed";
  if (n.includes("shipped customer")) return "Shipped";
  if (n.includes("not picked up") || n.includes("pickup")) return "Ready for pickup";
  if (n.includes("ready to ship") || n.includes("to be shipped")) return "Ready to ship";
  if (n.includes("waiting approval") || n.includes("approval")) return "Waiting for your approval";
  if (n.includes("missing info") || n.includes("changes")) return "Waiting for information from you";
  if (
    n.includes("production") ||
    n.includes("finishing") ||
    n.includes("converting") ||
    n.includes("outsource") ||
    n.includes("boyd") ||
    n.includes("application") ||
    n.includes("apparel")
  ) {
    return "In production";
  }
  if (n.includes("prepress") || n.includes("pre-press") || n.includes("ready for prod")) {
    return "Preparing for production";
  }
  return "In design";
}

/** Shipped / finished orders are left out of the "my open orders" reply. */
export function isClosedClientStatus(status: string): boolean {
  return status === "Completed" || status === "Shipped";
}

export type SmsCheckOrderLine = { number: string; status: string };

export const SMS_CHECK_UNKNOWN_TEXT =
  "Command not found. Text START or CHECK for the order status menu.";

export const SMS_CHECK_MENU_TEXT = [
  "Order status:",
  "Reply 1 to get the orders under this phone number.",
  "Reply 2 to check by job ticket number.",
  "Reply 3 for tracking numbers.",
  "Reply 4 to get your proof approval link.",
].join("\n");

export const SMS_CHECK_ASK_JOB_TEXT = "Please send us your job ticket number (for example 15683-2).";

export const SMS_CHECK_NOT_FOUND_TEXT =
  "We do not have any jobs with this number. Please send us another code.";

export const SMS_CHECK_NO_PHONE_ORDERS_TEXT =
  "We could not find open orders under this phone number. Reply 2 to check by job ticket number.";

function orderLines(lines: SmsCheckOrderLine[]): string {
  return lines.map((l) => `#${l.number} — ${l.status}`).join("\n");
}

export type SmsCheckTrackingLine = { number: string; trackingNumber: string; url: string };
export type SmsCheckLinkLine = { number: string; url: string };

export const SMS_CHECK_NO_TRACKING_TEXT =
  "We have no tracking numbers for orders under this phone number yet. Reply 1 or 2 to check your order status.";

export const SMS_CHECK_NO_PROOF_TEXT =
  "There are no proofs waiting for your approval under this phone number. Reply 1 or 2 to check your order status.";

export function smsCheckTrackingText(lines: SmsCheckTrackingLine[]): string {
  if (lines.length === 0) return SMS_CHECK_NO_TRACKING_TEXT;
  return [
    "Tracking:",
    ...lines.map((l) => `#${l.number} — FedEx ${l.trackingNumber}\n${l.url}`),
  ].join("\n");
}

export function smsCheckProofText(lines: SmsCheckLinkLine[]): string {
  if (lines.length === 0) return SMS_CHECK_NO_PROOF_TEXT;
  const head = lines.length === 1 ? "Your proof is ready to approve:" : "Your proofs are ready to approve:";
  return [head, ...lines.map((l) => `#${l.number}: ${l.url}`)].join("\n");
}

export function smsCheckPhoneOrdersText(lines: SmsCheckOrderLine[]): string {
  if (lines.length === 0) return SMS_CHECK_NO_PHONE_ORDERS_TEXT;
  const head = lines.length === 1 ? "Your open order:" : "Your open orders:";
  return `${head}\n${orderLines(lines)}`;
}

export function smsCheckJobText(lines: SmsCheckOrderLine[]): string {
  if (lines.length === 0) return SMS_CHECK_NOT_FOUND_TEXT;
  return `Job status:\n${orderLines(lines)}`;
}

/** Board titles that belong to a job number: `15683` → 15683, 15683-1, 15683-2…; `15683-2` → exactly that. */
export function titleMatchesJobNumber(
  order: { title: string; webhookOrderNumber?: string | null; crmOrderNumber?: string | null },
  job: string
): boolean {
  const j = job.toUpperCase();
  const t = order.title.trim().toUpperCase();
  if (t === j || t.startsWith(`${j}-`)) return true;
  const w = (order.webhookOrderNumber ?? "").trim().toUpperCase();
  if (w && w === j) return true;
  const crm = (order.crmOrderNumber ?? "").trim().toUpperCase();
  if (crm && (crm === j || crm.endsWith(`-${j}`))) return true;
  return false;
}

/** TwiML reply body (XML-escaped). Empty text → no reply. */
export function twimlMessage(text: string | null): string {
  if (!text) return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
  const safe = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
}
