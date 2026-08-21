/** Customer-facing key for proof overlay colors (layers vs technical lines). */

type LegendKind = "fill" | "solid-line" | "dashed-line" | "safe-zone";

type LegendItem = {
  label: string;
  color: string;
  kind: LegendKind;
  /** Extra outline so a white/light swatch stays visible on white. */
  stroke?: string;
};

const ITEMS: LegendItem[] = [
  { label: "White layer", color: "#ffffff", kind: "fill", stroke: "#94a3b8" },
  { label: "UV layer", color: "#e11d8c", kind: "fill" },
  { label: "Foil layer", color: "#d4a017", kind: "fill" },
  { label: "Cast & Cure", color: "#06b6d4", kind: "fill" },
  { label: "Cut line", color: "#ec4899", kind: "solid-line" },
  { label: "Perforation", color: "#22c55e", kind: "dashed-line" },
  { label: "Safe zone", color: "#2563eb", kind: "safe-zone" },
];

function LegendIcon({ item }: { item: LegendItem }) {
  if (item.kind === "fill") {
    return (
      <span
        className="h-4 w-4 shrink-0 rounded-[3px] border"
        style={{
          backgroundColor: item.color,
          borderColor: item.stroke ?? "rgba(15, 23, 42, 0.12)",
        }}
        aria-hidden
      />
    );
  }

  if (item.kind === "solid-line") {
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        className="shrink-0"
        aria-hidden
      >
        <line
          x1="1"
          y1="8"
          x2="15"
          y2="8"
          stroke={item.color}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (item.kind === "dashed-line") {
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        className="shrink-0"
        aria-hidden
      >
        <line
          x1="1"
          y1="8"
          x2="15"
          y2="8"
          stroke={item.color}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray="3 2.5"
        />
      </svg>
    );
  }

  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      className="shrink-0"
      aria-hidden
    >
      <rect
        x="1.5"
        y="1.5"
        width="13"
        height="13"
        fill="none"
        stroke={item.color}
        strokeWidth="1.6"
        strokeDasharray="2.5 2"
        rx="1"
      />
    </svg>
  );
}

export function ProofLayerLegend() {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        Layers &amp; line colors
      </p>
      <ul className="grid grid-cols-3 gap-x-2 gap-y-2.5">
        {ITEMS.map((item) => (
          <li key={item.label} className="flex min-w-0 items-center gap-1.5">
            <LegendIcon item={item} />
            <span className="truncate text-[11px] font-medium leading-tight text-slate-700">
              {item.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
