"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Input, Label, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  formatBooleanDisplay,
  formatDimensionsDisplay,
  formatMultiSelectDisplay,
  formatSelectDisplay,
  parseDimensionsValue,
} from "@/lib/connected-specs";
import type { CrmSpecOption, CrmSpecType } from "@/lib/types";

export type SpecEditValue = {
  display_value: string;
  value: unknown;
};

const DIMENSION_UNITS = ["in", "mm", "cm", "ft"];

export function ConnectedSpecInputs({
  specType,
  label,
  options = [],
  value,
  onChange,
  id,
}: {
  specType: CrmSpecType;
  label?: string;
  options?: CrmSpecOption[];
  value: unknown;
  onChange: (next: SpecEditValue) => void;
  id?: string;
}) {
  if (specType === "boolean") {
    const checked = value === true || value === "true" || value === "Yes";
    return (
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) =>
            onChange({
              display_value: formatBooleanDisplay(e.target.checked),
              value: e.target.checked,
            })
          }
          className="h-4 w-4 rounded border-slate-300"
        />
        {label ?? "Yes"}
      </label>
    );
  }

  if (specType === "select") {
    const current =
      value && typeof value === "object" && !Array.isArray(value)
        ? String(
            (value as { option_id?: string }).option_id ??
              (value as { label?: string }).label ??
              ""
          )
        : String(value ?? "");
    return (
      <div>
        {label ? <Label htmlFor={id}>{label}</Label> : null}
        <Select
          id={id}
          value={current}
          onChange={(e) => {
            const opt = options.find(
              (o) => o.option_id === e.target.value || o.label === e.target.value
            );
            onChange({
              display_value: opt?.label ?? e.target.value,
              value: opt
                ? { option_id: opt.option_id, label: opt.label }
                : e.target.value,
            });
          }}
        >
          <option value="">—</option>
          {options.map((o) => (
            <option key={o.option_id} value={o.option_id}>
              {o.label}
            </option>
          ))}
          {current &&
          !options.some((o) => o.option_id === current || o.label === current) ? (
            <option value={current}>{formatSelectDisplay(value, options)}</option>
          ) : null}
        </Select>
      </div>
    );
  }

  if (specType === "multi_select") {
    return (
      <MultiSelectSpec
        id={id}
        label={label}
        options={options}
        value={value}
        onChange={onChange}
      />
    );
  }

  if (specType === "dimensions") {
    const dims = parseDimensionsValue(value);
    const width = dims.width ?? "";
    const height = dims.height ?? "";
    const unit = dims.unit || "in";
    function emit(
      nextW: string | number,
      nextH: string | number,
      nextUnit: string
    ) {
      const w = nextW === "" ? null : Number(nextW);
      const h = nextH === "" ? null : Number(nextH);
      onChange({
        display_value: formatDimensionsDisplay(nextW, nextH, nextUnit),
        value: { width: w, height: h, unit: nextUnit },
      });
    }
    return (
      <div>
        {label ? <Label>{label}</Label> : null}
        <div className="flex items-center gap-2">
          <Input
            id={id}
            type="number"
            inputMode="decimal"
            placeholder="W"
            value={width === null || width === undefined ? "" : String(width)}
            onChange={(e) => emit(e.target.value, height, unit)}
            className="w-24"
          />
          <span className="text-slate-400">×</span>
          <Input
            type="number"
            inputMode="decimal"
            placeholder="H"
            value={height === null || height === undefined ? "" : String(height)}
            onChange={(e) => emit(width, e.target.value, unit)}
            className="w-24"
          />
          <Select
            value={unit}
            onChange={(e) => emit(width, height, e.target.value)}
            className="w-20"
          >
            {DIMENSION_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </Select>
        </div>
      </div>
    );
  }

  if (specType === "number") {
    const current = value == null || value === "" ? "" : String(value);
    return (
      <div>
        {label ? <Label htmlFor={id}>{label}</Label> : null}
        <Input
          id={id}
          type="number"
          value={current}
          onChange={(e) => {
            const raw = e.target.value;
            onChange({
              display_value: raw,
              value: raw === "" ? null : Number(raw),
            });
          }}
        />
      </div>
    );
  }

  const current = value == null ? "" : String(value);
  return (
    <div>
      {label ? <Label htmlFor={id}>{label}</Label> : null}
      <Input
        id={id}
        type="text"
        value={current}
        onChange={(e) =>
          onChange({ display_value: e.target.value, value: e.target.value })
        }
      />
    </div>
  );
}

function MultiSelectSpec({
  id,
  label,
  options,
  value,
  onChange,
}: {
  id?: string;
  label?: string;
  options: CrmSpecOption[];
  value: unknown;
  onChange: (next: SpecEditValue) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedIds: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") selectedIds.push(item);
      else if (item && typeof item === "object") {
        const rec = item as { option_id?: string; label?: string };
        if (rec.option_id) selectedIds.push(rec.option_id);
        else if (rec.label) selectedIds.push(rec.label);
      }
    }
  } else if (typeof value === "string" && value.trim()) {
    selectedIds.push(
      ...value
        .split(/[,;|]/)
        .map((s) => s.trim())
        .filter(Boolean)
    );
  }

  function toggle(option: CrmSpecOption) {
    const has = selectedIds.some(
      (id) => id === option.option_id || id === option.label
    );
    const nextOpts = has
      ? options.filter(
          (o) =>
            selectedIds.includes(o.option_id) || selectedIds.includes(o.label)
        ).filter((o) => o.option_id !== option.option_id)
      : [
          ...options.filter(
            (o) =>
              selectedIds.includes(o.option_id) || selectedIds.includes(o.label)
          ),
          option,
        ];
    onChange({
      display_value: formatMultiSelectDisplay(nextOpts, options),
      value: nextOpts.map((o) => ({ option_id: o.option_id, label: o.label })),
    });
  }

  const summary = formatMultiSelectDisplay(value, options) || "—";

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative">
      {label ? <Label htmlFor={id}>{label}</Label> : null}
      <button
        id={id}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-10 w-full items-center justify-between rounded-md border border-slate-300 bg-white px-3 text-left text-sm text-slate-900",
          "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
        )}
      >
        <span className="truncate">{summary}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
      </button>
      {open ? (
        <div className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          {options.map((opt) => {
            const checked = selectedIds.some(
              (id) => id === opt.option_id || id === opt.label
            );
            return (
              <button
                key={opt.option_id}
                type="button"
                onClick={() => toggle(opt)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50",
                  checked
                    ? "bg-blue-50 font-medium text-[var(--primary)]"
                    : "text-slate-700"
                )}
              >
                <span
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    checked
                      ? "border-blue-500 bg-blue-500 text-white"
                      : "border-slate-300 bg-white"
                  )}
                >
                  {checked ? <Check className="h-3 w-3" /> : null}
                </span>
                <span className="truncate">{opt.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
