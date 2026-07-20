"use client";

import {
  resolveWebhookSourceStyle,
  type WebhookSourceStyles,
} from "@/lib/webhook-source-styles";

interface Props {
  webhookSource: string | null | undefined;
  sourceStyles: WebhookSourceStyles | null | undefined;
  /** Shared parent order title (same on every multi-item card). */
  orderTitle?: string | null;
  className?: string;
}

/** Small colored source label above the customer name — optionally `Source | Order Title`. */
export function WebhookSourceLabel({
  webhookSource,
  sourceStyles,
  orderTitle,
  className,
}: Props) {
  const style =
    webhookSource == null
      ? { label: "Manual", color: "#64748b" }
      : resolveWebhookSourceStyle(webhookSource, sourceStyles);
  if (!style) return null;

  const title = orderTitle?.trim() || null;
  const titleAttr = title
    ? `Card source: ${style.label} · ${title}`
    : `Card source: ${style.label}`;

  return (
    <span
      className={
        className ??
        "mb-0.5 flex min-w-0 items-baseline gap-1 text-[10px] font-semibold leading-tight tracking-wide"
      }
      title={titleAttr}
    >
      <span className="shrink-0 uppercase" style={{ color: style.color }}>
        {style.label}
      </span>
      {title ? (
        <>
          <span className="shrink-0 font-normal text-slate-400">|</span>
          <span className="min-w-0 truncate font-medium normal-case tracking-normal text-slate-500">
            {title}
          </span>
        </>
      ) : null}
    </span>
  );
}
