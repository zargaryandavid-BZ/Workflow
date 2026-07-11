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

/** Small colored source label above customer name. Hidden for manual cards. */
export function WebhookSourceLabel({
  webhookSource,
  sourceStyles,
  className,
}: Props) {
  const style = resolveWebhookSourceStyle(webhookSource, sourceStyles);
  if (!style) return null;

  return (
    <span
      className={
        className ??
        "mb-0.5 block truncate text-[10px] font-semibold uppercase tracking-wide leading-tight"
      }
      style={{ color: style.color }}
      title={style.label}
    >
      {style.label}
    </span>
  );
}
