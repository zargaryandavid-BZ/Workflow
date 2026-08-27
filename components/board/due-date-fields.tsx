"use client";

import { useEffect, useState } from "react";
import { Input, Label, Select } from "@/components/ui/input";
import {
  DEFAULT_PROCESSING_DAYS,
  afterApprovalLabel,
  type DueDateMode,
} from "@/lib/due-date";
import { localDateInputValue } from "@/lib/utils";

export interface DueDateFieldsProps {
  idPrefix: string;
  mode: DueDateMode;
  onModeChange: (mode: DueDateMode) => void;
  dueDate: string;
  onDueDateChange: (value: string) => void;
  processingDays: number;
  onProcessingDaysChange: (days: number) => void;
  /** When after-approval was already materialized, show the calendar date too. */
  materializedDueDate?: string | null;
  minDueDate?: string;
  readOnly?: boolean;
  error?: string | null;
  /** Informational CRM / pending-approval label (not a validation error). */
  hint?: string | null;
  /** Show required marker (create-order / quote creation). */
  required?: boolean;
}

export function DueDateFields({
  idPrefix,
  mode,
  onModeChange,
  dueDate,
  onDueDateChange,
  processingDays,
  onProcessingDaysChange,
  materializedDueDate = null,
  minDueDate,
  readOnly = false,
  error = null,
  hint = null,
  required = false,
}: DueDateFieldsProps) {
  const days =
    Number.isFinite(processingDays) && processingDays >= 1
      ? processingDays
      : DEFAULT_PROCESSING_DAYS;
  // Local text state so the field can be CLEARED while typing (the old code
  // snapped an empty box straight back to the default, so you couldn't delete it).
  const [daysText, setDaysText] = useState(String(days));
  useEffect(() => {
    if (Number(daysText) !== processingDays) {
      setDaysText(
        Number.isFinite(processingDays) && processingDays >= 1
          ? String(Math.floor(processingDays))
          : ""
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processingDays]);
  const showMaterialized =
    mode === "after_approval" && Boolean(materializedDueDate?.trim());

  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={`${idPrefix}-due-mode`}>
        Due date
        {required ? <span className="ml-0.5 text-red-500">*</span> : null}
      </Label>
      <div className="grid min-w-0 grid-cols-2 items-center gap-2">
        <Select
          id={`${idPrefix}-due-mode`}
          value={mode}
          disabled={readOnly}
          onChange={(e) =>
            onModeChange(
              e.target.value === "after_approval" ? "after_approval" : "fixed"
            )
          }
          className={
            readOnly ? "min-w-0 bg-slate-50" : "min-w-0"
          }
        >
          <option value="fixed">Fixed date</option>
          <option value="after_approval">After Approval</option>
        </Select>

        {mode === "fixed" ? (
          <Input
            id={`${idPrefix}-due`}
            type="date"
            min={readOnly ? undefined : (minDueDate ?? localDateInputValue())}
            readOnly={readOnly}
            value={dueDate}
            onChange={(e) => onDueDateChange(e.target.value)}
            aria-invalid={error ? true : undefined}
            className={
              error
                ? "min-w-0 border-red-400 focus:border-red-500 focus:ring-red-500/30"
                : readOnly
                  ? "min-w-0 bg-slate-50"
                  : "min-w-0"
            }
          />
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <Input
              id={`${idPrefix}-due-days`}
              type="number"
              min={1}
              max={90}
              readOnly={readOnly}
              value={daysText}
              onChange={(e) => {
                const raw = e.target.value;
                // Allow empty / partial input so the box can be cleared and retyped.
                if (raw !== "" && !/^\d{1,2}$/.test(raw)) return;
                setDaysText(raw);
                const n = Number(raw);
                if (Number.isFinite(n) && n >= 1 && n <= 90) {
                  onProcessingDaysChange(Math.floor(n));
                }
              }}
              onBlur={() => {
                const n = Number(daysText);
                if (!(Number.isFinite(n) && n >= 1)) {
                  setDaysText(String(DEFAULT_PROCESSING_DAYS));
                  onProcessingDaysChange(DEFAULT_PROCESSING_DAYS);
                }
              }}
              className={`w-16 shrink-0 ${readOnly ? "bg-slate-50" : ""}`}
            />
            <span className="shrink-0 text-sm text-slate-600">wd</span>
          </div>
        )}
      </div>

      {mode === "after_approval" ? (
        <p className="break-words text-xs text-sky-700">
          {hint?.trim() || afterApprovalLabel(days)}
        </p>
      ) : null}
      {showMaterialized ? (
        <p className="text-xs text-slate-600">
          Calendar due:{" "}
          <span className="font-medium text-slate-800">
            {materializedDueDate}
          </span>
        </p>
      ) : null}

      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
