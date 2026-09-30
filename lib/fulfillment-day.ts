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

/**
 * Build a Multi-item box name.
 * Format: BX{N}{MMDDYY} where N = daily counter (1, 2, 3…)
 * Example: BX1092926 = box 1 on Sep 29, 2026
 */
export function multiitemBoxName(
  boxNumber: number,
  date: Date = new Date()
): string {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const yy = String(date.getFullYear()).slice(-2);
  return `BX${boxNumber}${mm}${dd}${yy}`;
}

/** UTC calendar date `YYYY-MM-DD` for multi-item box daily counters. */
export function utcBoxDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function multiitemBoxNameFromIsoDate(
  boxNumber: number,
  isoDate: string
): string {
  const [y, m, d] = isoDate.split("-");
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (!year || !month || !day) return `BX${boxNumber}`;
  return multiitemBoxName(boxNumber, new Date(year, month - 1, day));
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

type SavedMultiitemDayBox = {
  status: string;
  saved_at?: string | null;
  savedAt?: string | null;
  box_date?: string | null;
  boxDate?: string | null;
};

export function savedMultiitemDayKey(box: SavedMultiitemDayBox): string {
  if (box.status !== "saved") return "";
  const savedAt = box.saved_at ?? box.savedAt;
  if (savedAt) {
    const key = localDayKey(savedAt);
    if (key) return key;
  }
  const date = (box.box_date ?? box.boxDate)?.slice(0, 10) ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

/** Newest-first days that have saved multi-item boxes. */
export function savedMultiitemDayKeys(boxes: SavedMultiitemDayBox[]): string[] {
  const keys = new Set<string>();
  for (const box of boxes) {
    const key = savedMultiitemDayKey(box);
    if (key) keys.add(key);
  }
  return [...keys].sort().reverse();
}

/**
 * `null` day = open boxes being packed today.
 * A YYYY-MM-DD day = boxes saved that local date.
 */
export function boxesForSavedMultiitemDay<T extends SavedMultiitemDayBox>(
  boxes: T[],
  day: string | null
): T[] {
  if (day === null) {
    return boxes.filter((b) => b.status === "open");
  }
  return boxes.filter((b) => savedMultiitemDayKey(b) === day);
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
