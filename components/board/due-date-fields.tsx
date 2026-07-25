"use client";

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
}: DueDateFieldsProps) {
  const days =
    Number.isFinite(processingDays) && processingDays >= 1
      ? processingDays
      : DEFAULT_PROCESSING_DAYS;
  const showMaterialized =
    mode === "after_approval" && Boolean(materializedDueDate?.trim());

  return (
    <div className="space-y-2">
      <Label htmlFor={`${idPrefix}-due-mode`}>Due date</Label>
      <Select
        id={`${idPrefix}-due-mode`}
        value={mode}
        disabled={readOnly}
        onChange={(e) =>
          onModeChange(
            e.target.value === "after_approval" ? "after_approval" : "fixed"
          )
        }
        className={readOnly ? "bg-slate-50" : undefined}
      >
        <option value="fixed">Fixed date</option>
        <option value="after_approval">Working days after approval</option>
      </Select>

      {mode === "fixed" ? (
        <div>
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
                ? "border-red-400 focus:border-red-500 focus:ring-red-500/30"
                : readOnly
                  ? "bg-slate-50"
                  : undefined
            }
          />
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Input
              id={`${idPrefix}-due-days`}
              type="number"
              min={1}
              max={90}
              readOnly={readOnly}
              value={days}
              onChange={(e) => {
                const n = Number(e.target.value);
                onProcessingDaysChange(
                  Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_PROCESSING_DAYS
                );
              }}
              className={`w-24 ${readOnly ? "bg-slate-50" : ""}`}
            />
            <span className="text-sm text-slate-600">working days</span>
          </div>
          <p className="text-xs text-sky-700">
            {hint?.trim() || afterApprovalLabel(days)}
          </p>
          {showMaterialized ? (
            <p className="text-xs text-slate-600">
              Calendar due:{" "}
              <span className="font-medium text-slate-800">
                {materializedDueDate}
              </span>
            </p>
          ) : null}
        </div>
      )}

      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
