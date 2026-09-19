/** Local calendar day for fulfillment Send/Received date chips. */

export function localDayKey(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function localDayLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Local date and time, e.g. `Sep 18, 4:20 PM`. */
export function fulfillmentDateTimeLabel(value: Date | string | null | undefined): string {
  if (value == null || value === "") return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ddmmyy(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}${mm}${yy}`;
}

/** `180926_1` — packing/send day + box number (no leading zero on the number). */
export function fulfillmentBoxLabel(
  box: {
    box_number: string;
    created_at?: string | null;
    sent_at?: string | null;
    received_at?: string | null;
  },
  now: Date = new Date()
): string {
  const n = Number(box.box_number);
  const num = Number.isFinite(n) && n >= 1 ? String(n) : box.box_number;
  const when = box.sent_at || box.received_at || box.created_at || now;
  const date = ddmmyy(when);
  return date ? `${date}_${num}` : num;
}

type ReceiveDayBox = {
  status: string;
  received_at: string | null;
};

/** Newest-first days that have checked-in boxes. */
export function receivedDayKeys(boxes: ReceiveDayBox[]): string[] {
  const keys = new Set<string>();
  for (const box of boxes) {
    if (box.status !== "received" || !box.received_at) continue;
    const key = localDayKey(box.received_at);
    if (key) keys.add(key);
  }
  return [...keys].sort().reverse();
}

/**
 * `null` day = delivered boxes waiting to check in.
 * A YYYY-MM-DD day = boxes received that local date.
 */
export function boxesForReceiveDay<T extends ReceiveDayBox>(
  boxes: T[],
  day: string | null
): T[] {
  if (day === null) {
    return boxes.filter((b) => b.status === "sent");
  }
  return boxes.filter(
    (b) =>
      b.status === "received" &&
      b.received_at != null &&
      localDayKey(b.received_at) === day
  );
}
