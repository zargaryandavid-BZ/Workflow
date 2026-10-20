"use client";

import { Input, Select } from "@/components/ui/input";
import {
  MAX_LABELS_PER_ROLL_KEY,
  MIN_LABELS_PER_ROLL_KEY,
  QTY_PER_ROLL_KEY,
  QTY_PER_ROLL_MODE_KEY,
  QTY_PER_ROLL_MODES,
  ROLL_DISPLAY_LABELS,
  rollValuesFromSpecs,
  rollValuesProblem,
  type RollKey,
} from "@/lib/roll-options";

/**
 * "Labels per roll" on roll-label cards — the portal / CRM keys
 * (QTY_PER_ROLL, QTY_PER_ROLL_MODE, MIN_LABELS_PER_ROLL, MAX_LABELS_PER_ROLL).
 * Values land in specs.spec_selections + spec_display on Save.
 */
export function LabelsPerRollSection({
  specs,
  onChange,
  readOnly = false,
  orderQty = null,
  staffEditedAt = null,
  idPrefix,
}: {
  specs: Record<string, unknown> | null | undefined;
  onChange?: (key: RollKey, value: string) => void;
  readOnly?: boolean;
  orderQty?: number | null;
  staffEditedAt?: string | null;
  idPrefix: string;
}) {
  const values = rollValuesFromSpecs(specs);
  const problem = rollValuesProblem(values, orderQty);
  const disabled = readOnly || !onChange;
  const mode = values.QTY_PER_ROLL_MODE;
  const knownMode = (QTY_PER_ROLL_MODES as readonly string[]).includes(mode);

  const countInput = (key: RollKey, placeholder: string) => (
    <label className="block" htmlFor={`${idPrefix}-${key}`}>
      <span className="mb-1 block text-xs font-medium text-slate-600">
        {ROLL_DISPLAY_LABELS[key]}
      </span>
      <Input
        id={`${idPrefix}-${key}`}
        inputMode="numeric"
        value={values[key]}
        onChange={(e) => onChange?.(key, e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
    </label>
  );

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="mb-2 text-sm font-semibold text-slate-700">Labels per roll</p>
      {staffEditedAt ? (
        <p className="mb-2 text-xs text-slate-400">
          Edited by staff — CRM / portal updates keep these values unless the
          source sends different roll values.
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {countInput(QTY_PER_ROLL_KEY, "e.g. 1000")}
        <label className="block" htmlFor={`${idPrefix}-${QTY_PER_ROLL_MODE_KEY}`}>
          <span className="mb-1 block text-xs font-medium text-slate-600">
            {ROLL_DISPLAY_LABELS.QTY_PER_ROLL_MODE}
          </span>
          <Select
            id={`${idPrefix}-${QTY_PER_ROLL_MODE_KEY}`}
            value={mode}
            onChange={(e) => onChange?.(QTY_PER_ROLL_MODE_KEY, e.target.value)}
            disabled={disabled}
          >
            <option value="">—</option>
            {!knownMode && mode ? <option value={mode}>{mode}</option> : null}
            {QTY_PER_ROLL_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </label>
        {countInput(MIN_LABELS_PER_ROLL_KEY, "optional")}
        {countInput(MAX_LABELS_PER_ROLL_KEY, "optional")}
      </div>
      {problem ? <p className="mt-2 text-xs text-amber-700">{problem}</p> : null}
    </div>
  );
}
