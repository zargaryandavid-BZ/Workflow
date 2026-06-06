"use client";

import { Input, Label, Select } from "@/components/ui/input";
import type { CustomField } from "@/lib/types";

export function CustomFieldInput({
  field,
  value,
  onChange,
  readOnly = false,
}: {
  field: CustomField;
  value: unknown;
  onChange: (value: unknown) => void;
  readOnly?: boolean;
}) {
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
        {field.name}
        {field.required ? <span className="text-red-500">*</span> : null}
      </label>
    );
  }

  return (
    <div>
      <Label>
        {field.name}
        {field.required ? <span className="ml-0.5 text-red-500">*</span> : null}
      </Label>
      {field.field_type === "select" ? (
        <Select
          value={(value as string) ?? ""}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">—</option>
          {field.options.map((opt) => (
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
