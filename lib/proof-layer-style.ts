export type ProofLayerKind = "fill" | "solid-line" | "dashed-line" | "safe-zone";

export type ProofLayerStyle = {
  label: string;
  color: string;
  kind: ProofLayerKind;
  stroke?: string;
};

export const PROOF_LAYER_STYLES: ProofLayerStyle[] = [
  { label: "White layer", color: "#ffffff", kind: "fill", stroke: "#94a3b8" },
  { label: "UV layer", color: "#e11d8c", kind: "fill" },
  { label: "Foil layer", color: "#d4a017", kind: "fill" },
  { label: "Cast & Cure", color: "#06b6d4", kind: "fill" },
  { label: "Cut line", color: "#ec4899", kind: "solid-line" },
  { label: "Perforation", color: "#22c55e", kind: "dashed-line" },
  { label: "Safe zone", color: "#2563eb", kind: "safe-zone" },
];

const BY_LABEL = Object.fromEntries(
  PROOF_LAYER_STYLES.map((s) => [s.label, s])
) as Record<string, ProofLayerStyle>;

/**
 * Map an Acrobat OCG name (Die, UV, White, …) to the customer legend style.
 */
export function proofLayerStyleForName(name: string): ProofLayerStyle | null {
  const n = name.trim().toLowerCase().replace(/\s+/g, " ");
  if (!n) return null;
  if (/\bwhite\b/.test(n)) return BY_LABEL["White layer"]!;
  if (/\buv\b|scodix|raised\s*uv/.test(n)) return BY_LABEL["UV layer"]!;
  if (/\bfoil\b|gold|silver/.test(n)) return BY_LABEL["Foil layer"]!;
  if (/cast\s*[&+]\s*cure|cast\s+and\s+cure|\bc\s*&\s*c\b/.test(n)) {
    return BY_LABEL["Cast & Cure"]!;
  }
  if (/\bperf/.test(n)) return BY_LABEL["Perforation"]!;
  if (/\bsafe\b/.test(n)) return BY_LABEL["Safe zone"]!;
  if (/\bcut\b|die\s*line|dieline|\bdie\b/.test(n)) return BY_LABEL["Cut line"]!;
  return null;
}
