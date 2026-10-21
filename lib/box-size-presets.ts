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

export const CUSTOM_BOX_SIZE_VALUE = "__custom__";

export function formatCustomBoxSize(
  length: string,
  width: string,
  height: string
): string {
  const dimensions = [length, width, height].map((value) => value.trim());
  return dimensions.every(Boolean) ? `${dimensions.join("×")} in` : "";
}
