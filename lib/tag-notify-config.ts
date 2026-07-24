/** Shared (client + server) tag notification recipient config. */

export type TagNotifyRecipient = "customer" | "designer" | "owner" | "custom";

export const TAG_NOTIFY_RECIPIENTS: {
  value: TagNotifyRecipient;
  label: string;
}[] = [
  { value: "customer", label: "Customer" },
  { value: "designer", label: "Designer" },
  { value: "owner", label: "Owner" },
  { value: "custom", label: "Custom email / phone" },
];

const RECIPIENT_SET = new Set<string>(
  TAG_NOTIFY_RECIPIENTS.map((r) => r.value)
);

export function normalizeTagNotifyRecipients(
  raw: unknown
): TagNotifyRecipient[] {
  if (!Array.isArray(raw)) return [];
  const out: TagNotifyRecipient[] = [];
  for (const item of raw) {
    if (typeof item === "string" && RECIPIENT_SET.has(item)) {
      out.push(item as TagNotifyRecipient);
    }
  }
  return [...new Set(out)];
}
