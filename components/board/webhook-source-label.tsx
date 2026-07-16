"use client";

import {
  resolveWebhookSourceStyle,
  type WebhookSourceStyles,
} from "@/lib/webhook-source-styles";

interface Props {
  webhookSource: string | null | undefined;
  sourceStyles: WebhookSourceStyles | null | undefined;
  className?: string;
}

/** Small colored source label above the customer name. */
export function WebhookSourceLabel({
  webhookSource,
  sourceStyles,
  className,
}: Props) {
  const style =
    webhookSource == null
      ? { label: "Manual", color: "#64748b" }
      : resolveWebhookSourceStyle(webhookSource, sourceStyles);
  if (!style) return null;

  return (
    <span
      className={
        className ??
        "mb-0.5 block truncate text-[10px] font-semibold uppercase tracking-wide leading-tight"
      }
      style={{ color: style.color }}
      title={`Card source: ${style.label}`}
    >
      {style.label}
    </span>
  );
}
