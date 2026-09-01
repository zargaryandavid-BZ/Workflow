import { cn } from "@/lib/utils";
import {
  sourceChannelDisplay,
  type SourceChannelKey,
} from "@/lib/source-channel";
import {
  AtSign,
  Globe,
  Mail,
  Megaphone,
  MessageSquare,
  Phone,
  type LucideIcon,
} from "lucide-react";

const SOURCE_CHANNEL_ICONS: Record<SourceChannelKey, LucideIcon> = {
  email: Mail,
  call: Phone,
  sms: MessageSquare,
  webform: Globe,
  ad_lead: Megaphone,
  ig_dm: AtSign,
};

type DesignSpecs = {
  design_source?: unknown;
  design_reference?: unknown;
  design_ready?: unknown;
  design_price?: unknown;
  design_sku_count?: unknown;
};

function readDesign(specs: unknown) {
  const s = (specs ?? {}) as DesignSpecs;
  const source = typeof s.design_source === "string" ? s.design_source : "";
  return {
    source,
    reference: typeof s.design_reference === "string" ? s.design_reference.trim() : "",
    ready: s.design_ready === true,
    price: typeof s.design_price === "string" ? s.design_price.trim() : "",
    skuCount: typeof s.design_sku_count === "string" ? s.design_sku_count.trim() : "",
  };
}

/** Short label + tone for the on-card flag. Null = no flag. */
function flagFor(source: string, ready: boolean) {
  if (source === "needs_design")
    return { label: "Needs design", tone: "bg-violet-100 text-violet-700 border-violet-300" };
  if (source === "files_coming")
    return { label: "Files coming", tone: "bg-amber-100 text-amber-800 border-amber-300" };
  if (source === "has_files" && !ready)
    return { label: "Design changes", tone: "bg-amber-100 text-amber-800 border-amber-300" };
  if (source === "has_files" && ready)
    return { label: "Print-ready", tone: "bg-emerald-100 text-emerald-700 border-emerald-300" };
  return null;
}

/** Compact flag chip for the board card. */
export function DesignFlagChip({
  specs,
  className,
}: {
  specs: unknown;
  className?: string;
}) {
  const { source, ready } = readDesign(specs);
  const flag = flagFor(source, ready);
  if (!flag) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-1.5 py-px text-[10px] font-semibold",
        flag.tone,
        className
      )}
      title="Design service"
    >
      {flag.label}
    </span>
  );
}

/** Small chip showing where the order originated (email / call / sms / ...). */
export function SourceChannelChip({
  specs,
  className,
}: {
  specs: unknown;
  className?: string;
}) {
  const s = (specs ?? {}) as { source_channel?: unknown };
  const info = sourceChannelDisplay(s.source_channel);
  if (!info) return null;
  const Icon = SOURCE_CHANNEL_ICONS[info.key];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border px-1.5 py-px text-[10px] font-semibold",
        info.tone,
        className
      )}
      title={`Order came in via ${info.label}`}
    >
      <Icon className="h-2.5 w-2.5" aria-hidden />
      {info.label}
    </span>
  );
}

/** Frozen "Design reference" block for the open card — what the designer reads first. */
export function DesignReferenceBlock({ specs }: { specs: unknown }) {
  const { source, reference, ready, skuCount } = readDesign(specs);
  if (!source && !reference) return null;
  const flag = flagFor(source, ready);
  const meta = [skuCount ? `${skuCount} SKU(s) to design` : ""]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-blue-800">
          Design reference
        </span>
        {flag ? (
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-1.5 py-px text-[10px] font-semibold",
              flag.tone
            )}
          >
            {flag.label}
          </span>
        ) : null}
      </div>
      {meta ? <div className="mt-1 text-[12px] font-medium text-slate-600">{meta}</div> : null}
      {reference ? (
        <div className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{reference}</div>
      ) : (
        <div className="mt-1 text-sm italic text-slate-400">No brief provided.</div>
      )}
    </div>
  );
}
