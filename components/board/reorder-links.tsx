"use client";

import { ExternalLink, RotateCcw } from "lucide-react";
import { reorderLinksFromSpecs } from "@/lib/reorder-source";

/**
 * "Reorder of #X" box on an open REORDER card: the original order's approval
 * page, Final production files and designer folder (owner rule 2026-10-14 —
 * staff can always refer back to what the customer approved). Renders nothing
 * for non-reorder cards, so every other card looks exactly as before.
 */
export function ReorderLinksBlock({ specs }: { specs: unknown }) {
  const s = (specs ?? {}) as Record<string, unknown>;
  if (s.is_reorder !== true) return null;
  const ref = typeof s.reorder_of === "string" ? s.reorder_of.trim() : "";
  const links = reorderLinksFromSpecs(s);
  if (!ref && links.length === 0) return null;
  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-violet-800">
        <RotateCcw className="h-3 w-3" aria-hidden />
        {ref ? `Reorder of #${ref}` : "Reorder"}
      </div>
      {links.length > 0 ? (
        <ul className="mt-1.5 space-y-1">
          {links.map((l) => (
            <li key={`${l.kind}:${l.url}`}>
              <a
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm font-medium text-violet-700 hover:underline"
              >
                {l.label}
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-1 text-sm italic text-slate-500">
          Original order&apos;s links were not found — check order #{ref}.
        </div>
      )}
    </div>
  );
}
