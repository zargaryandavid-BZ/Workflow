"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Input, Label, Select } from "@/components/ui/input";
import { uniqueOptions } from "@/lib/field-links";
import {
  formatMultiSelectValue,
  isMultiSelectField,
  parseMultiSelectValue,
} from "@/lib/multi-select-fields";
import { cn } from "@/lib/utils";
import type { CustomField } from "@/lib/types";

export function CustomFieldInput({
  field,
  value,
  onChange,
  readOnly = false,
  label,
}: {
  field: CustomField;
  value: unknown;
  onChange: (value: unknown) => void;
  readOnly?: boolean;
  /** Display label; defaults to field.name */
  label?: string;
}) {
  const displayName = label ?? field.name;

  if (field.field_type === "checkbox") {
    return (
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={Boolean(value)}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300"
        />
        {displayName}
        {field.required ? <span className="text-red-500">*</span> : null}
      </label>
    );
  }

  const selectOptions = uniqueOptions(field.options);

  if (field.field_type === "select" && isMultiSelectField(field)) {
    return (
      <MultiSelectField
        label={displayName}
        required={field.required}
        options={selectOptions}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
      />
    );
  }

  return (
    <div>
      <Label>
        {displayName}
        {field.required ? <span className="ml-0.5 text-red-500">*</span> : null}
      </Label>
      {field.field_type === "select" ? (
        <Select
          value={(value as string) ?? ""}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">—</option>
          {selectOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </Select>
      ) : (
        <Input
          type={
            field.field_type === "number"
              ? "number"
              : field.field_type === "date"
                ? "date"
                : "text"
          }
          readOnly={readOnly}
          className={readOnly ? "bg-slate-50" : undefined}
          value={(value as string) ?? ""}
          onChange={(e) =>
            onChange(
              field.field_type === "number"
                ? e.target.value === ""
                  ? null
                  : Number(e.target.value)
                : e.target.value
            )
          }
        />
      )}
    </div>
  );
}

function MultiSelectField({
  label,
  required,
  options,
  value,
  onChange,
  readOnly,
}: {
  label: string;
  required?: boolean;
  options: string[];
  value: unknown;
  onChange: (value: unknown) => void;
  readOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = parseMultiSelectValue(value, options);

  // Keep orphan values (from webhook) visible even if not in catalog options.
  const allOptions = uniqueOptions([
    ...options,
    ...selected.filter((s) => !options.includes(s)),
  ]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle(option: string) {
    const next = selected.some((s) => s === option)
      ? selected.filter((s) => s !== option)
      : [...selected, option];
    onChange(formatMultiSelectValue(next) || null);
  }

  const summary =
    selected.length === 0
      ? "—"
      : selected.length <= 2
        ? selected.join(", ")
        : `${selected.length} selected`;

  return (
    <div ref={rootRef} className="relative">
      <Label>
        {label}
        {required ? <span className="ml-0.5 text-red-500">*</span> : null}
      </Label>
      <button
        type="button"
        disabled={readOnly}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-10 w-full items-center justify-between rounded-md border border-slate-300 bg-white px-3 text-left text-sm text-slate-900",
          "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30",
          readOnly && "cursor-not-allowed bg-slate-50 text-slate-500",
          selected.length === 0 && "text-slate-400"
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{summary}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-slate-400 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && !readOnly ? (
        <div className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50",
              selected.length === 0
                ? "bg-blue-50 font-medium text-[var(--primary)]"
                : "text-slate-600"
            )}
          >
            <span className="flex h-4 w-4 items-center justify-center">
              {selected.length === 0 ? <Check className="h-3.5 w-3.5" /> : null}
            </span>
            —
          </button>
          {allOptions.map((opt) => {
            const checked = selected.includes(opt);
            return (
              <button
                key={opt}
                type="button"
                role="option"
                aria-selected={checked}
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
                <span className="truncate">{opt}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
