import type { DailyPriorityBucket, PressType, ProductionStage } from "@/lib/types";

export const PRESS_OPTIONS: PressType[] = ["6K", "15K"];

export const PRESS_LABELS: Record<PressType, string> = {
  "6K": "6K",
  "15K": "15K",
};

/** 5-step shop-floor status, in the order a job normally moves through them. */
export const PRODUCTION_STAGE_OPTIONS: ProductionStage[] = [
  "printing",
  "lamination",
  "uv",
  "cutting",
  "folding",
];

export const PRODUCTION_STAGE_LABELS: Record<ProductionStage, string> = {
  printing: "Printing",
  lamination: "Lamination",
  uv: "UV",
  cutting: "Cutting",
  folding: "Folding",
};

/** Compact chip colors — one per stage so staff can tell them apart at a glance. */
export const PRODUCTION_STAGE_STYLES: Record<ProductionStage, string> = {
  printing: "bg-blue-100 text-blue-700 border border-blue-200",
  lamination: "bg-purple-100 text-purple-700 border border-purple-200",
  uv: "bg-amber-100 text-amber-700 border border-amber-200",
  cutting: "bg-orange-100 text-orange-700 border border-orange-200",
  folding: "bg-emerald-100 text-emerald-700 border border-emerald-200",
};

export const DAILY_PRIORITY_BUCKET_OPTIONS: DailyPriorityBucket[] = ["today", "tomorrow"];

export const DAILY_PRIORITY_BUCKET_LABELS: Record<DailyPriorityBucket, string> = {
  today: "Today",
  tomorrow: "Tomorrow",
};
