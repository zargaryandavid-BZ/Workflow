"use client";

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Plus, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PRIMARY_CONTACT_ID,
  buildNotifyDestinations,
  type CustomerContact,
  type NotifyContact,
  type NotifyDestinations,
} from "@/lib/customer-contacts";
import { cn } from "@/lib/utils";

export { PRIMARY_CONTACT_ID, buildNotifyDestinations };

export function useCompanyContacts(opts: {
  customerId: string | null | undefined;
  primary: NotifyContact;
}): {
  extra: CustomerContact[];
  all: NotifyContact[];
  selectedIds: Set<string>;
  toggle: (id: string) => void;
  destinations: NotifyDestinations;
  adding: boolean;
  setAdding: (v: boolean) => void;
  addForm: { name: string; email: string; phone: string };
  setAddForm: Dispatch<
    SetStateAction<{ name: string; email: string; phone: string }>
  >;
  saveAdd: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  error: string | null;
  loading: boolean;
} {
  const { customerId, primary } = opts;
  const [extra, setExtra] = useState<CustomerContact[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set([PRIMARY_CONTACT_ID])
  );
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", email: "", phone: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!customerId) {
      setExtra([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/customers/${customerId}/contacts`);
        const data = (await res.json().catch(() => ({}))) as {
          contacts?: CustomerContact[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "Could not load company contacts.");
          return;
        }
        const list = data.contacts ?? [];
        setExtra(list);
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.add(PRIMARY_CONTACT_ID);
          for (const c of list) next.add(c.id);
          return next;
        });
      } catch {
        if (!cancelled) setError("Could not load company contacts.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  const all = useMemo<NotifyContact[]>(
    () => [
      {
        id: PRIMARY_CONTACT_ID,
        name: primary.name,
        email: primary.email,
        phone: primary.phone,
      },
      ...extra,
    ],
    [primary.name, primary.email, primary.phone, extra]
  );

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size <= 1) return prev;
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const destinations = useMemo(
    () => buildNotifyDestinations(all, selectedIds),
    [all, selectedIds]
  );

  async function saveAdd() {
    if (!customerId) {
      setError("Link a customer to this order first.");
      return;
    }
    setError(null);
    const res = await fetch(`/api/customers/${customerId}/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(addForm),
    });
    const data = (await res.json().catch(() => ({}))) as {
      contact?: CustomerContact;
      error?: string;
    };
    if (!res.ok || !data.contact) {
      setError(data.error ?? "Could not add contact.");
      return;
    }
    setExtra((prev) => [...prev, data.contact!]);
    setSelectedIds((prev) => new Set(prev).add(data.contact!.id));
    setAddForm({ name: "", email: "", phone: "" });
    setAdding(false);
  }

  async function remove(id: string) {
    if (!customerId) return;
    setError(null);
    const res = await fetch(`/api/customers/${customerId}/contacts/${id}`, {
      method: "DELETE",
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(data.error ?? "Could not remove contact.");
      return;
    }
    setExtra((prev) => prev.filter((c) => c.id !== id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      if (next.size === 0) next.add(PRIMARY_CONTACT_ID);
      return next;
    });
  }

  return {
    extra,
    all,
    selectedIds,
    toggle,
    destinations,
    adding,
    setAdding,
    addForm,
    setAddForm,
    saveAdd,
    remove,
    error,
    loading,
  };
}

export function CompanyContactsPicker({
  companyName,
  customerId,
  contacts,
  compact = false,
}: {
  companyName: string | null | undefined;
  customerId: string | null | undefined;
  contacts: ReturnType<typeof useCompanyContacts>;
  compact?: boolean;
}) {
  const label = companyName?.trim() || "This company";

  return (
    <div className={cn("space-y-2", compact && "space-y-1.5")}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
          <Users className="h-4 w-4 text-slate-400" />
          Company contacts
        </p>
        {customerId ? (
          <button
            type="button"
            onClick={() => contacts.setAdding(true)}
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800"
          >
            <Plus className="h-3.5 w-3.5" />
            Add contact
          </button>
        ) : (
          <p className="text-xs text-slate-400">Link a customer to add more</p>
        )}
      </div>
      <p className="text-xs text-slate-500">
        Associated with {label}. Check everyone who should get this request.
      </p>
      {contacts.loading ? (
        <p className="text-xs text-slate-400">Loading contacts…</p>
      ) : null}
      <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
        {contacts.all.map((c) => {
          const checked = contacts.selectedIds.has(c.id);
          const detail = [c.email, c.phone].filter(Boolean).join(" · ");
          return (
            <li
              key={c.id}
              className="flex items-start gap-2 px-2.5 py-1.5 text-sm"
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={checked}
                onChange={() => contacts.toggle(c.id)}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-800">
                  {c.name || "Contact"}
                  {c.id === PRIMARY_CONTACT_ID ? (
                    <span className="ml-1.5 text-xs font-normal text-slate-400">
                      primary
                    </span>
                  ) : null}
                </p>
                {detail ? (
                  <p className="truncate text-xs text-slate-500">{detail}</p>
                ) : (
                  <p className="text-xs text-amber-700">No email or phone</p>
                )}
              </div>
              {c.id !== PRIMARY_CONTACT_ID ? (
                <button
                  type="button"
                  onClick={() => void contacts.remove(c.id)}
                  className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                  aria-label={`Remove ${c.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {contacts.adding ? (
        <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2.5">
          <Input
            placeholder="Name"
            value={contacts.addForm.name}
            onChange={(e) =>
              contacts.setAddForm((f) => ({ ...f, name: e.target.value }))
            }
          />
          <Input
            type="email"
            placeholder="Email"
            value={contacts.addForm.email}
            onChange={(e) =>
              contacts.setAddForm((f) => ({ ...f, email: e.target.value }))
            }
          />
          <Input
            type="tel"
            placeholder="Phone"
            value={contacts.addForm.phone}
            onChange={(e) =>
              contacts.setAddForm((f) => ({ ...f, phone: e.target.value }))
            }
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => contacts.setAdding(false)}
            >
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={() => void contacts.saveAdd()}>
              Save contact
            </Button>
          </div>
        </div>
      ) : null}
      {contacts.error ? (
        <p className="text-xs text-red-600">{contacts.error}</p>
      ) : null}
    </div>
  );
}
