/** Scan floor action buttons stored in fulfillment_settings.scan_column_config. */

export const MAX_SCAN_BUTTONS = 20;
export const MAX_SCAN_BUTTON_LABEL = 80;

export type ScanActionButton = {
  id: string;
  label: string;
  columnId: string | null;
};

export type ScanColumnConfigStored = {
  buttons: { id: string; label: string; column_id: string | null }[];
};

const LEGACY_BUTTONS: { id: string; label: string }[] = [
  { id: "received", label: "Received" },
  { id: "delivered", label: "Delivered" },
  { id: "shipped", label: "Shipped" },
  { id: "finished", label: "Finished" },
  { id: "finished_reviewed", label: "Finished & reviewed" },
];

export function defaultScanButtons(): ScanActionButton[] {
  return LEGACY_BUTTONS.map((b) => ({
    id: b.id,
    label: b.label,
    columnId: null,
  }));
}

export function newScanButton(label = "New action"): ScanActionButton {
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `btn_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return { id, label, columnId: null };
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function sanitizeId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim().slice(0, 64);
  return id || null;
}

function sanitizeLabel(value: unknown, fallback = "Action"): string {
  if (typeof value !== "string") return fallback;
  const label = value.trim().slice(0, MAX_SCAN_BUTTON_LABEL);
  return label || fallback;
}

function sanitizeColumnId(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return null;
  const id = value.trim();
  return id || null;
}

function parseButton(raw: unknown, index: number): ScanActionButton | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const id = sanitizeId(rec.id) ?? `btn_${index + 1}`;
  return {
    id,
    label: sanitizeLabel(rec.label ?? rec.name),
    columnId: sanitizeColumnId(rec.column_id ?? rec.columnId),
  };
}

function parseButtonsArray(raw: unknown): ScanActionButton[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const buttons: ScanActionButton[] = [];
  for (const item of raw) {
    if (buttons.length >= MAX_SCAN_BUTTONS) break;
    const button = parseButton(item, buttons.length);
    if (!button) continue;
    let id = button.id;
    if (seen.has(id)) id = `${id}_${buttons.length + 1}`;
    seen.add(id);
    buttons.push({ ...button, id });
  }
  return buttons;
}

function parseLegacyMap(raw: Record<string, unknown>): ScanActionButton[] {
  const extras: ScanActionButton[] = [];
  const used = new Set<string>();
  const buttons = LEGACY_BUTTONS.map((b) => {
    used.add(b.id);
    return {
      id: b.id,
      label: b.label,
      columnId: sanitizeColumnId(raw[b.id]),
    };
  });
  for (const [key, value] of Object.entries(raw)) {
    if (used.has(key) || key === "buttons") continue;
    if (typeof value !== "string" && value != null) continue;
    extras.push({
      id: sanitizeId(key) ?? key,
      label: sanitizeLabel(key, key),
      columnId: sanitizeColumnId(value),
    });
  }
  return [...buttons, ...extras].slice(0, MAX_SCAN_BUTTONS);
}

/**
 * Accepts:
 * - `{ buttons: [...] }` (current)
 * - `[{ id, label, column_id }]`
 * - `{ received: uuid, shipped: uuid, ... }` (legacy map)
 * - empty / invalid → default five buttons
 */
export function normalizeScanButtons(raw: unknown): ScanActionButton[] {
  if (Array.isArray(raw)) {
    return parseButtonsArray(raw) ?? defaultScanButtons();
  }
  const rec = asRecord(raw);
  if (!rec) return defaultScanButtons();
  if ("buttons" in rec) {
    const parsed = parseButtonsArray(rec.buttons);
    if (parsed) return parsed;
    return defaultScanButtons();
  }
  if (Object.keys(rec).length === 0) return defaultScanButtons();
  return parseLegacyMap(rec);
}

export function serializeScanButtons(
  buttons: ScanActionButton[]
): ScanColumnConfigStored {
  return {
    buttons: buttons.slice(0, MAX_SCAN_BUTTONS).map((b, i) => ({
      id: sanitizeId(b.id) ?? `btn_${i + 1}`,
      label: sanitizeLabel(b.label),
      column_id: sanitizeColumnId(b.columnId),
    })),
  };
}

export function findScanButton(
  buttons: ScanActionButton[],
  buttonId: string
): ScanActionButton | null {
  const id = buttonId.trim();
  if (!id) return null;
  return buttons.find((b) => b.id === id) ?? null;
}

export function moveScanButton(
  buttons: ScanActionButton[],
  index: number,
  direction: -1 | 1
): ScanActionButton[] {
  const next = index + direction;
  if (index < 0 || next < 0 || index >= buttons.length || next >= buttons.length) {
    return buttons;
  }
  const copy = [...buttons];
  const [item] = copy.splice(index, 1);
  copy.splice(next, 0, item);
  return copy;
}
