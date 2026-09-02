/** Customer-facing key for proof overlay colors (layers vs technical lines). */

import { PROOF_LAYER_STYLES } from "@/lib/proof-layer-style";
import { ProofLayerSwatch } from "@/components/respond/proof-layer-icon";

export function ProofLayerLegend() {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        Layers &amp; line colors
      </p>
      <ul className="grid grid-cols-3 gap-x-2 gap-y-2.5">
        {PROOF_LAYER_STYLES.map((item) => (
          <li key={item.label} className="flex min-w-0 items-center gap-1.5">
            <ProofLayerSwatch style={item} />
            <span className="truncate text-[11px] font-medium leading-tight text-slate-700">
              {item.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
