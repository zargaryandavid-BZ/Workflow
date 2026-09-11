"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";

type ClientFedExAccountRow = {
  customer_id: string;
  customer_name: string;
  company: string | null;
  account_masked: string;
};

type SearchHit = {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
};

export function ClientFedexAccountsPanel() {
  const [accounts, setAccounts] = useState<ClientFedExAccountRow[]>([]);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [customerLabel, setCustomerLabel] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const res = await fetch("/api/shipping-settings/client-fedex");
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSetupError(
        typeof json.error === "string" ? json.error : "Could not load accounts"
      );
      return;
    }
    setSetupError(
      typeof json.setupError === "string" ? json.setupError : null
    );
    setAccounts((json.accounts ?? []) as ClientFedExAccountRow[]);
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      void (async () => {
        const params = new URLSearchParams({ q: q.trim() });
        const res = await fetch(`/api/customers/search?${params}`);
        const json = await res.json().catch(() => ({}));
        setHits((json.customers ?? []) as SearchHit[]);
      })();
    }, 250);
    return () => window.clearTimeout(t);
  }, [q]);

  async function addAccount() {
    setError(null);
    setMessage(null);
    setSaving(true);
    const res = await fetch("/api/shipping-settings/client-fedex", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_id: customerId,
        account_number: accountNumber,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(typeof json.error === "string" ? json.error : "Could not add");
      return;
    }
    setOpen(false);
    setCustomerId("");
    setCustomerLabel("");
    setAccountNumber("");
    setQ("");
    setMessage("Client FedEx account saved. Their cards show a FedEx label.");
    await load();
  }

  async function removeAccount(id: string) {
    setError(null);
    const res = await fetch(
      `/api/shipping-settings/client-fedex?customer_id=${encodeURIComponent(id)}`,
      { method: "DELETE" }
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(typeof json.error === "string" ? json.error : "Could not remove");
      return;
    }
    await load();
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-800">
            Client FedEx accounts
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Save a customer&apos;s own FedEx account. We check with FedEx that
            the number exists, then show a FedEx label on their cards so staff
            ship on the client account. Details appear on the order Shipping
            tab.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="shrink-0"
          onClick={() => {
            setOpen(true);
            setError(null);
          }}
          disabled={Boolean(setupError)}
        >
          <Plus className="h-4 w-4" />
          Add FedEx account
        </Button>
      </div>

      {setupError ? (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {setupError}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </p>
      ) : null}

      {accounts.length === 0 && !setupError ? (
        <p className="mt-4 text-sm text-slate-500">
          No client FedEx accounts yet.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-100">
          {accounts.map((row) => (
            <li
              key={row.customer_id}
              className="flex items-center justify-between gap-3 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">
                  {row.customer_name}
                  {row.company ? (
                    <span className="font-normal text-slate-500">
                      {" "}
                      · {row.company}
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-slate-500">
                  FedEx {row.account_masked}
                </p>
              </div>
              <button
                type="button"
                className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                title="Remove"
                onClick={() => void removeAccount(row.customer_id)}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-medium text-slate-800">
            Add client FedEx number
          </p>
          <label className="block text-sm text-slate-600">
            Customer
            <input
              value={customerLabel || q}
              onChange={(e) => {
                setCustomerId("");
                setCustomerLabel("");
                setQ(e.target.value);
              }}
              placeholder="Search by customer name"
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
            />
          </label>
          {hits.length > 0 && !customerId ? (
            <ul className="overflow-hidden rounded-md border border-slate-200 bg-white">
              {hits.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                    onClick={() => {
                      setCustomerId(hit.id);
                      setCustomerLabel(hit.name);
                      setQ("");
                      setHits([]);
                    }}
                  >
                    {hit.name}
                    {hit.company ? (
                      <span className="text-slate-500"> · {hit.company}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <label className="block text-sm text-slate-600">
            FedEx account number
            <input
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              placeholder="Account number"
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={saving || !customerId || !accountNumber.trim()}
              onClick={() => void addAccount()}
            >
              <Truck className="h-4 w-4" />
              {saving ? "Checking FedEx…" : "Verify and add"}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
