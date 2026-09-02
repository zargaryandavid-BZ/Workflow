import { Layers } from "lucide-react";
import type { ProofLayerStyle } from "@/lib/proof-layer-style";
import { proofLayerStyleForName } from "@/lib/proof-layer-style";

export function ProofLayerSwatch({
  style,
}: {
  style: ProofLayerStyle;
}) {
  if (style.kind === "fill") {
    return (
      <span
        className="h-3.5 w-3.5 shrink-0 rounded-[3px] border"
        style={{
          backgroundColor: style.color,
          borderColor: style.stroke ?? "rgba(15, 23, 42, 0.12)",
        }}
        aria-hidden
      />
    );
  }

  if (style.kind === "solid-line") {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        className="shrink-0"
        aria-hidden
      >
        <line
          x1="1"
          y1="8"
          x2="15"
          y2="8"
          stroke={style.color}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (style.kind === "dashed-line") {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        className="shrink-0"
        aria-hidden
      >
        <line
          x1="1"
          y1="8"
          x2="15"
          y2="8"
          stroke={style.color}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray="3 2.5"
        />
      </svg>
    );
  }

  return (
    <svg
      width="14"
      height="14"
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
        stroke={style.color}
        strokeWidth="1.6"
        strokeDasharray="2.5 2"
        rx="1"
      />
    </svg>
  );
}

export function ProofLayerNameIcon({ name }: { name: string }) {
  const style = proofLayerStyleForName(name);
  if (!style) {
    return <Layers className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />;
  }
  return <ProofLayerSwatch style={style} />;
}
