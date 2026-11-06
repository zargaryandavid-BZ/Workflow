"use client";

import { useEffect, useState } from "react";
import { Mail, Pencil, Phone, Trash2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import type { DieManufacturer } from "@/lib/die-manufacturers";
import { formatPhoneDisplay } from "@/lib/sms-phone";

type Draft = {
  full_name: string;
  contact_name: string;
  email: string;
  phone: string;
  contact_name_2: string;
  email_2: string;
  phone_2: string;
};

const EMPTY: Draft = {
  full_name: "",
  contact_name: "",
  email: "",
  phone: "",
  contact_name_2: "",
  email_2: "",
  phone_2: "",
};

function ContactLine({
  name,
  email,
  phone,
}: {
  name: string | null;
  email: string | null;
  phone: string | null;
}) {
  if (!name && !email && !phone) return null;
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-600">
      {name ? (
        <span className="inline-flex items-center gap-1">
          <User className="h-3 w-3 text-slate-400" /> {name}
        </span>
      ) : null}
      {email ? (
        <a href={`mailto:${email}`} className="inline-flex items-center gap-1 hover:text-blue-700">
          <Mail className="h-3 w-3 text-slate-400" /> {email}
        </a>
      ) : null}
      {phone ? (
        <a href={`tel:${phone}`} className="inline-flex items-center gap-1 hover:text-blue-700">
          <Phone className="h-3 w-3 text-slate-400" /> {formatPhoneDisplay(phone)}
        </a>
      ) : null}
    </p>
  );
}

/**
 * Die manufacturers: the shops that get die orders. Every contact here
 * (main + second) is emailed / texted when an order goes out.
 */
export function DieManufacturersManager({
  initial,
  migrationRequired,
  onChanged,
  search = "",
}: {
  initial: DieManufacturer[];
  /** Filter the list (company, contact, email, phone). */
  search?: string;
  migrationRequired?: boolean;
  /** The list changed (refresh other places that pick a manufacturer). */
  onChanged?: () => void;
}) {
  const [rows, setRows] = useState(initial);
  const [editingId, setEditingId] = useState<string | "new">("new");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showSecond, setShowSecond] = useState(false);

  useEffect(() => setRows(initial), [initial]);

  const isEditing = editingId !== "new";
  const q = search.trim().toLowerCase();
  const shown = q
    ? rows.filter((row) =>
        [
          row.full_name,
          row.contact_name,
          row.email,
          row.phone,
          row.contact_name_2,
          row.email_2,
          row.phone_2,
        ].some((v) => v?.toLowerCase().includes(q))
      )
    : rows;

  function field(key: keyof Draft) {
    return {
      value: draft[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        setDraft((d) => ({ ...d, [key]: e.target.value })),
    };
  }

  function startEdit(row: DieManufacturer) {
    setEditingId(row.id);
    setDraft({
      full_name: row.full_name,
      contact_name: row.contact_name ?? "",
      email: row.email,
      phone: row.phone ?? "",
      contact_name_2: row.contact_name_2 ?? "",
      email_2: row.email_2 ?? "",
      phone_2: row.phone_2 ?? "",
    });
    setShowSecond(Boolean(row.contact_name_2 || row.email_2 || row.phone_2));
    setError(null);
    setNotice(null);
  }

  function cancel() {
    setEditingId("new");
    setDraft(EMPTY);
    setError(null);
  }

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const isNew = editingId === "new";
      const url = isNew
        ? "/api/settings/die-manufacturers"
        : `/api/settings/die-manufacturers/${editingId}`;
      const res = await fetch(url, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const json = (await res.json()) as {
        error?: string;
        warning?: string | null;
        manufacturer?: DieManufacturer;
      };
      if (!res.ok) throw new Error(json.error ?? "Failed to save");
      if (!json.manufacturer) throw new Error("Failed to save");
      setRows((prev) => {
        const next = isNew
          ? [...prev, json.manufacturer!]
          : prev.map((r) => (r.id === json.manufacturer!.id ? json.manufacturer! : r));
        return next.sort((a, b) => a.full_name.localeCompare(b.full_name));
      });
      setNotice(
        json.warning ??
          (isNew ? `Added ${json.manufacturer.full_name}.` : `Saved ${json.manufacturer.full_name}.`)
      );
      cancel();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: DieManufacturer) {
    if (!window.confirm(`Remove ${row.full_name}? Requests already sent to them are kept.`)) return;
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/settings/die-manufacturers/${row.id}`, {
      method: "DELETE",
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(json.error ?? "Failed to delete");
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    if (editingId === row.id) cancel();
    setNotice(`Removed ${row.full_name}.`);
    onChanged?.();
  }

  if (migrationRequired) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Run migration 0085_die_manufacturers.sql in Supabase, then reload.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <form
        onSubmit={(e) => void save(e)}
        className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
      >
        {/* One line: company · contact · email · phone · button. */}
        <div className="grid items-end gap-2 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1.3fr_1fr_auto]">
          <div>
            <Label htmlFor="die-mfg-name">{isEditing ? "Company name * (editing)" : "Company name *"}</Label>
            <Input id="die-mfg-name" className="mt-1" placeholder="Company name" autoComplete="organization" {...field("full_name")} />
          </div>
          <div>
            <Label htmlFor="die-mfg-contact">Contact name</Label>
            <Input id="die-mfg-contact" className="mt-1" placeholder="Contact name" autoComplete="name" {...field("contact_name")} />
          </div>
          <div>
            <Label htmlFor="die-mfg-email">Email *</Label>
            <Input id="die-mfg-email" className="mt-1" type="email" placeholder="email@company.com" {...field("email")} />
          </div>
          <div>
            <Label htmlFor="die-mfg-phone">Phone</Label>
            <Input id="die-mfg-phone" className="mt-1" type="tel" placeholder="Phone" {...field("phone")} />
          </div>
          <div className="flex gap-2">
            {isEditing ? (
              <Button type="button" variant="secondary" onClick={cancel}>
                Cancel
              </Button>
            ) : null}
            <Button type="submit" disabled={saving} className="whitespace-nowrap">
              {saving ? "Saving…" : isEditing ? "Save" : "Add manufacturer"}
            </Button>
          </div>
        </div>
        {showSecond ? (
          <div className="grid items-end gap-2 sm:grid-cols-3 lg:grid-cols-[1.2fr_1fr_1.3fr_1fr_auto]">
            <p className="self-center text-xs font-semibold uppercase tracking-wide text-slate-500">
              Second contact
            </p>
            <Input aria-label="Second contact name" placeholder="Contact name" {...field("contact_name_2")} />
            <Input aria-label="Second contact email" type="email" placeholder="email@company.com" {...field("email_2")} />
            <Input aria-label="Second contact phone" type="tel" placeholder="Phone" {...field("phone_2")} />
            <span className="hidden lg:block lg:w-[9.5rem]" />
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setShowSecond((v) => !v)}
            className="text-xs font-semibold text-blue-700 hover:underline"
          >
            {showSecond ? "− Hide second contact" : "+ Second contact"}
          </button>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <p className="text-xs text-slate-500">Every contact gets the die order email and text.</p>
        </div>
      </form>

      {notice ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          No die manufacturers yet. Add a company above, then pick it when you order a die.
        </p>
      ) : shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          No manufacturers match “{search.trim()}”.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
          {shown.map((row) => (
            <li
              key={row.id}
              className={
                editingId === row.id
                  ? "flex items-start justify-between gap-3 bg-blue-50/50 px-4 py-3"
                  : "flex items-start justify-between gap-3 px-4 py-3"
              }
            >
              <div className="min-w-0 space-y-1">
                <p className="truncate text-sm font-semibold text-slate-800">{row.full_name}</p>
                <ContactLine name={row.contact_name} email={row.email} phone={row.phone} />
                <ContactLine name={row.contact_name_2} email={row.email_2} phone={row.phone_2} />
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  onClick={() => startEdit(row)}
                  aria-label={`Edit ${row.full_name}`}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  onClick={() => void remove(row)}
                  aria-label={`Delete ${row.full_name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
