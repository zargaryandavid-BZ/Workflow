"use client";

import { Label } from "@/components/ui/input";
import {
  DEFAULT_APPLICATION_DAYS,
  productionDateFromDueDate,
} from "@/lib/order-application";
import { dateInputValue, formatDate } from "@/lib/utils";

/** Shown when Product-box Application checkbox is ON (no duplicate checkbox). */
export function ApplicationFields({
  idPrefix,
  applicationDays,
  onApplicationDaysChange,
  dueDate,
  readOnly = false,
}: {
  idPrefix: string;
  applicationDays: number;
  onApplicationDaysChange: (days: number) => void;
  /** Absolute due date (YYYY-MM-DD) used to compute production date. */
  dueDate: string;
  readOnly?: boolean;
}) {
  const days = Math.max(1, Math.floor(applicationDays || DEFAULT_APPLICATION_DAYS));
  const productionDate = productionDateFromDueDate(
    dateInputValue(dueDate) || null,
    days
  );

  return (
    <div className="flex items-start gap-3">
      <div className="w-16 shrink-0">
        <Label htmlFor={`${idPrefix}-application-days`}>Days</Label>
        <input
          id={`${idPrefix}-application-days`}
          type="number"
          min={1}
          step={1}
          value={days}
          disabled={readOnly}
          onChange={(e) => {
            const n = Math.floor(Number(e.target.value));
            onApplicationDaysChange(
              Number.isFinite(n) && n >= 1 ? n : DEFAULT_APPLICATION_DAYS
            );
          }}
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-1.5 py-1.5 text-center text-sm tabular-nums text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300 disabled:bg-slate-50"
          title="Application days"
          aria-label="Application days"
        />
      </div>
      <div className="min-w-0 flex-1">
        <Label htmlFor={`${idPrefix}-production-date`}>Production date</Label>
        <input
          id={`${idPrefix}-production-date`}
          type="text"
          readOnly
          value={
            productionDate ? formatDate(productionDate) : "Set due date first"
          }
          className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700"
          title={`Due date − ${days} working day${days === 1 ? "" : "s"} (Mon–Sat)`}
        />
      </div>
    </div>
  );
}
