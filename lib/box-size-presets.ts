export const FULFILLMENT_BOX_SIZE_PRESETS = [
  "6×6×6 in",
  "8×6×4 in",
  "10×8×6 in",
  "10×10×10 in",
  "12×10×8 in",
  "12×12×12 in",
  "16×12×10 in",
  "18×12×12 in",
  "20×16×12 in",
  "24×18×12 in",
] as const;

/** Sizes offered when telling a customer the order is ready. */
export const READY_TO_SHIP_BOX_SIZE_PRESETS = [
  "18×12×12 in",
  "6×6×6 in",
  "10×10×10 in",
  "14×14×14 in",
  "16×16×16 in",
  "18×18×18 in",
] as const;

export const CUSTOM_BOX_SIZE_VALUE = "__custom__";

export function formatCustomBoxSize(
  length: string,
  width: string,
  height: string
): string {
  const dimensions = [length, width, height].map((value) => value.trim());
  return dimensions.every(Boolean) ? `${dimensions.join("×")} in` : "";
}

export type PresetBoxDimensions = {
  length: string;
  width: string;
  height: string;
};

/** Length, width, and height from a preset label such as "18×12×12 in". */
export function presetBoxDimensions(label: string): PresetBoxDimensions | null {
  const match = /^(\d+(?:\.\d+)?)×(\d+(?:\.\d+)?)×(\d+(?:\.\d+)?)/.exec(
    label.trim()
  );
  if (!match) return null;
  return { length: match[1], width: match[2], height: match[3] };
}

type SizedBox = {
  length: string;
  width: string;
  height: string;
  weight: string;
};

/** Fill every box's length, width, and height from a preset. Weights stay. */
export function applyPresetDimensions<T extends SizedBox>(
  current: T[],
  presetLabel: string
): T[] | null {
  const dims = presetBoxDimensions(presetLabel);
  if (!dims) return null;
  return current.map((box) => ({ ...box, ...dims }));
}

/**
 * Grow or shrink the box list. Added boxes take the preset dimensions.
 * When a preset is selected, they also copy the last box's weight.
 */
export function resizeBoxDrafts<T extends SizedBox>(
  current: T[],
  count: number,
  presetLabel: string
): T[] {
  const safe = Math.min(20, Math.max(1, Math.floor(count) || 1));
  if (safe === current.length) return current;
  if (safe < current.length) return current.slice(0, safe);
  const dims = presetBoxDimensions(presetLabel);
  const added: T = {
    length: dims?.length ?? "",
    width: dims?.width ?? "",
    height: dims?.height ?? "",
    weight: dims ? (current[current.length - 1]?.weight ?? "") : "",
  } as T;
  return [
    ...current,
    ...Array.from({ length: safe - current.length }, () => ({ ...added })),
  ];
}
