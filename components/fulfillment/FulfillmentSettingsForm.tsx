"use client";

import { useState } from "react";

interface Column {
  id: string;
  name: string;
}

interface Settings {
  send_column_id: string | null;
  receive_column_id: string | null;
  counted_column_id: string | null;
  missing_column_id: string | null;
}

interface Props {
  columns: Column[];
  initialSettings: Settings;
}

function ColumnSelect({
  label,
  hint,
  value,
  onChange,
  columns,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  columns: Column[];
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700">{label}</label>
      {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
      <select
        className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">— None —</option>
        {columns.map((col) => (
          <option key={col.id} value={col.id}>
            {col.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export function FulfillmentSettingsForm({ columns, initialSettings }: Props) {
  const [sendColumnId, setSendColumnId] = useState(
    initialSettings.send_column_id ?? ""
  );
  const [receiveColumnId, setReceiveColumnId] = useState(
    initialSettings.receive_column_id ?? ""
  );
  const [countedColumnId, setCountedColumnId] = useState(
    initialSettings.counted_column_id ?? ""
  );
  const [missingColumnId, setMissingColumnId] = useState(
    initialSettings.missing_column_id ?? ""
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/fulfillment/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          send_column_id: sendColumnId || null,
          receive_column_id: receiveColumnId || null,
          counted_column_id: countedColumnId || null,
          missing_column_id: missingColumnId || null,
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Failed to save");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <ColumnSelect
        label="When delivered, move orders to:"
        value={sendColumnId}
        onChange={setSendColumnId}
        columns={columns}
      />
      <ColumnSelect
        label="Order received"
        hint="Checked in, not counted yet — applies to the whole box"
        value={receiveColumnId}
        onChange={setReceiveColumnId}
        columns={columns}
      />
      <ColumnSelect
        label="Order counted and approved"
        hint="Qty matches and the jobs in the box are good"
        value={countedColumnId}
        onChange={setCountedColumnId}
        columns={columns}
      />
      <ColumnSelect
        label="Missing/wrong info"
        hint="Short qty, damage, or bad paperwork on this box"
        value={missingColumnId}
        onChange={setMissingColumnId}
        columns={columns}
      />

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={saving}
        className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? "Saving…" : saved ? "Saved!" : "Save Settings"}
      </button>
    </form>
  );
}
