"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Sparkles, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { CustomField, CustomFieldType } from "@/lib/types";

const TYPES: { value: CustomFieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "select", label: "Dropdown" },
  { value: "date", label: "Date" },
  { value: "checkbox", label: "Checkbox" },
];

export function FieldsManager({
  initialFields,
}: {
  initialFields: CustomField[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [fieldType, setFieldType] = useState<CustomFieldType>("text");
  const [optionsText, setOptionsText] = useState("");
  const [required, setRequired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<CustomField | null>(null);

  async function seedDefaults() {
    setError(null);
    setMessage(null);
    setSeeding(true);
    const res = await fetch("/api/custom-fields/seed-defaults", {
      method: "POST",
    });
    const json = await res.json();
    setSeeding(false);
    if (!res.ok) {
      setError(json.error ?? "Failed to add defaults");
      return;
    }
    setMessage(
      json.added > 0
        ? `Added ${json.added} default print field${json.added === 1 ? "" : "s"}.`
        : "All default print fields are already present."
    );
    router.refresh();
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await fetch("/api/custom-fields", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        fieldType,
        required,
        options:
          fieldType === "select"
            ? optionsText
                .split(",")
                .map((o) => o.trim())
                .filter(Boolean)
            : [],
      }),
    });
    const json = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(json.error ?? "Failed");
      return;
    }
    setName("");
    setOptionsText("");
    setFieldType("text");
    setRequired(false);
    router.refresh();
  }

  async function toggleRequired(field: CustomField) {
    await fetch(`/api/custom-fields/${field.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ required: !field.required }),
    });
    router.refresh();
  }

  async function remove(id: string) {
    await fetch(`/api/custom-fields/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
        <div>
          <p className="text-sm font-medium text-slate-700">
            Print production defaults
          </p>
          <p className="text-xs text-slate-500">
            Add the standard intake fields (Product, Materials, Lamination, SKU
            details, etc.). Existing fields are kept.
          </p>
        </div>
        <Button
          variant="outline"
          type="button"
          onClick={seedDefaults}
          disabled={seeding}
          className="shrink-0 whitespace-nowrap"
        >
          <Sparkles className="h-4 w-4 shrink-0" />
          {seeding ? "Adding…" : "Add defaults"}
        </Button>
      </div>

      {message ? (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </p>
      ) : null}

      <form
        onSubmit={add}
        className="space-y-4 rounded-lg border border-slate-200 bg-white p-4"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="f-name">Field name</Label>
            <Input
              id="f-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Pantone color"
            />
          </div>
          <div>
            <Label htmlFor="f-type">Type</Label>
            <Select
              id="f-type"
              value={fieldType}
              onChange={(e) => setFieldType(e.target.value as CustomFieldType)}
            >
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {fieldType === "select" ? (
          <div>
            <Label htmlFor="f-options">Options (comma separated)</Label>
            <Input
              id="f-options"
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
              placeholder="Matte, Gloss, Soft-touch"
            />
          </div>
        ) : null}
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Required for new jobs
        </label>
        {error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={loading}>
          {loading ? "Adding…" : "Add field"}
        </Button>
      </form>

      <div className="rounded-lg border border-slate-200 bg-white">
        {initialFields.length === 0 ? (
          <p className="p-4 text-sm text-slate-400">No custom fields yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {initialFields.map((field) => (
              <li
                key={field.id}
                className="flex items-center justify-between px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-slate-800">
                    {field.name}
                    {field.required ? (
                      <span className="ml-1 text-red-500" title="Required">
                        *
                      </span>
                    ) : null}
                  </p>
                  <div className="mt-0.5 flex items-center gap-2">
                    <Badge className="bg-slate-100 text-slate-600">
                      {field.field_type}
                    </Badge>
                    {field.field_type === "select" &&
                    field.options.length > 0 ? (
                      <span className="text-xs text-slate-400">
                        {field.options.join(", ")}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-500">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={() => toggleRequired(field)}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    Required
                  </label>
                  <button
                    onClick={() => setEditing(field)}
                    className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    aria-label="Edit field"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => remove(field.id)}
                    className="rounded p-1.5 text-slate-400 hover:bg-red-100 hover:text-red-600"
                    aria-label="Delete field"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing ? (
        <FieldEditor
          field={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function FieldEditor({
  field,
  onClose,
  onSaved,
}: {
  field: CustomField;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(field.name);
  const [fieldType, setFieldType] = useState<CustomFieldType>(field.field_type);
  const [optionsText, setOptionsText] = useState(field.options.join(", "));
  const [required, setRequired] = useState(field.required);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await fetch(`/api/custom-fields/${field.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        fieldType,
        required,
        options:
          fieldType === "select"
            ? optionsText
                .split(",")
                .map((o) => o.trim())
                .filter(Boolean)
            : [],
      }),
    });
    const json = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(json.error ?? "Failed to save");
      return;
    }
    onSaved();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit field"
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="field-edit-form" disabled={loading}>
            {loading ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <form id="field-edit-form" onSubmit={save} className="space-y-4">
        <div>
          <Label htmlFor="fe-name">Field name</Label>
          <Input
            id="fe-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Pantone color"
          />
        </div>
        <div>
          <Label htmlFor="fe-type">Type</Label>
          <Select
            id="fe-type"
            value={fieldType}
            onChange={(e) => setFieldType(e.target.value as CustomFieldType)}
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </div>
        {fieldType === "select" ? (
          <div>
            <Label htmlFor="fe-options">Options (comma separated)</Label>
            <Input
              id="fe-options"
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
              placeholder="Matte, Gloss, Soft-touch"
            />
          </div>
        ) : null}
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Required for new jobs
        </label>
        {error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
