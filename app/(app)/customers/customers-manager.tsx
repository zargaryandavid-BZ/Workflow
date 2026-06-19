"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Mail, Pencil, Phone } from "lucide-react";
import { CardDetailModal } from "@/components/board/card-detail-modal";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { formatDate } from "@/lib/utils";
import type {
  BoardColumn,
  CustomField,
  CustomerOrderSummary,
  CustomerWithStats,
  Designer,
  Role,
} from "@/lib/types";
import type { OrderOwner } from "@/components/board/order-form-body";

function customerToForm(c: CustomerWithStats) {
  return {
    name: c.name ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
    company: c.company ?? "",
  };
}

export function CustomersManager({
  customers,
  ordersByCustomer,
  customFields,
  owners,
  columns,
  designers,
  role,
}: {
  customers: CustomerWithStats[];
  ordersByCustomer: Record<string, CustomerOrderSummary[]>;
  customFields: CustomField[];
  owners: OrderOwner[];
  columns: BoardColumn[];
  designers: Designer[];
  role: Role;
}) {
  const router = useRouter();
  const isAdmin = role === "admin";
  const [selected, setSelected] = useState<CustomerWithStats | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", company: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewOrderId, setViewOrderId] = useState<string | null>(null);

  const selectedOrders = selected ? (ordersByCustomer[selected.id] ?? []) : [];

  useEffect(() => {
    if (selected) {
      setForm(customerToForm(selected));
      setEditing(false);
      setError(null);
    }
  }, [selected]);

  function openCustomer(c: CustomerWithStats) {
    setSelected(c);
  }

  function closeModal() {
    setSelected(null);
    setEditing(false);
    setError(null);
  }

  async function saveCustomer() {
    if (!selected) return;
    setSaving(true);
    setError(null);

    const res = await fetch(`/api/customers/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        company: form.company.trim() || null,
      }),
    });

    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
      customer?: CustomerWithStats;
    };

    setSaving(false);

    if (!res.ok) {
      setError(json.error ?? "Failed to save customer");
      return;
    }

    if (json.customer) {
      setSelected({
        ...selected,
        ...json.customer,
        order_count: selected.order_count,
        last_order_at: selected.last_order_at,
      });
    }

    setEditing(false);
    router.refresh();
  }

  return (
    <div>
      <div className="rounded-lg border border-slate-200 bg-white">
        {customers.length === 0 ? (
          <p className="p-4 text-sm text-slate-400">
            No customers yet. They will appear here when orders include a
            customer name and contact.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {customers.map((c) => {
              const contact = c.email ?? c.phone;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => openCustomer(c)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800">
                        {c.name}
                      </p>
                      {contact ? (
                        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-500">
                          {c.email ? (
                            <Mail className="h-3.5 w-3.5 shrink-0" />
                          ) : (
                            <Phone className="h-3.5 w-3.5 shrink-0" />
                          )}
                          {contact}
                        </p>
                      ) : null}
                      <p className="mt-1 text-xs text-slate-400">
                        {c.order_count}{" "}
                        {c.order_count === 1 ? "order" : "orders"}
                        {c.last_order_at
                          ? ` · Last order: ${formatDate(c.last_order_at)}`
                          : ""}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Modal
        open={selected !== null}
        onClose={closeModal}
        title={selected?.name ?? "Customer"}
        className="max-w-lg"
        headerAction={
          isAdmin && selected && !editing ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </button>
          ) : null
        }
        footer={
          editing ? (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  if (selected) setForm(customerToForm(selected));
                  setEditing(false);
                  setError(null);
                }}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="button" onClick={saveCustomer} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </>
          ) : null
        }
      >
        {selected ? (
          <div className="space-y-4">
            {editing ? (
              <div className="space-y-3">
                <div>
                  <Label htmlFor="customer-name">Name</Label>
                  <Input
                    id="customer-name"
                    value={form.name}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, name: e.target.value }))
                    }
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="customer-email">Email</Label>
                  <Input
                    id="customer-email"
                    type="email"
                    value={form.email}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, email: e.target.value }))
                    }
                    placeholder="hello@example.com"
                  />
                </div>
                <div>
                  <Label htmlFor="customer-phone">Phone</Label>
                  <Input
                    id="customer-phone"
                    type="tel"
                    value={form.phone}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, phone: e.target.value }))
                    }
                    placeholder="+1 310 555 0100"
                  />
                </div>
                <div>
                  <Label htmlFor="customer-company">Company</Label>
                  <Input
                    id="customer-company"
                    value={form.company}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, company: e.target.value }))
                    }
                  />
                </div>
                <p className="text-xs text-slate-500">
                  At least one of email or phone is required.
                </p>
                {error ? (
                  <p className="text-sm text-red-600">{error}</p>
                ) : null}
              </div>
            ) : (
              <div className="text-sm text-slate-600">
                {selected.email ? (
                  <p className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-slate-400" />
                    {selected.email}
                  </p>
                ) : null}
                {selected.phone ? (
                  <p className="mt-1 flex items-center gap-2">
                    <Phone className="h-4 w-4 text-slate-400" />
                    {selected.phone}
                  </p>
                ) : null}
                {selected.company ? (
                  <p className="mt-1 text-slate-600">{selected.company}</p>
                ) : null}
              </div>
            )}

            {!editing ? (
              <div>
                <p className="mb-2 text-sm font-semibold text-slate-700">
                  Order history
                </p>
                {selectedOrders.length === 0 ? (
                  <p className="text-sm text-slate-400">No orders linked yet.</p>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-slate-200">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                          <th className="px-3 py-2">Order</th>
                          <th className="px-3 py-2">Date</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="w-8 px-2 py-2" aria-hidden />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {selectedOrders.map((order) => (
                          <tr key={order.id} className="hover:bg-slate-50">
                            <td className="px-3 py-2.5">
                              <button
                                type="button"
                                onClick={() => setViewOrderId(order.id)}
                                className="text-left font-medium text-[var(--primary)] hover:underline"
                              >
                                {order.title}
                              </button>
                            </td>
                            <td className="px-3 py-2.5 text-slate-600">
                              {formatDate(order.created_at)}
                            </td>
                            <td className="px-3 py-2.5 text-slate-600">
                              {order.column_name ?? "—"}
                            </td>
                            <td className="px-2 py-2.5 text-slate-300">
                              <ChevronRight className="h-4 w-4" />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <CardDetailModal
        orderId={viewOrderId}
        open={viewOrderId !== null}
        onClose={() => setViewOrderId(null)}
        customFields={customFields}
        owners={owners}
        columns={columns}
        designers={designers}
        role={role}
        mode="view"
        onChanged={() => {}}
      />
    </div>
  );
}
