"use client";

import { useState } from "react";
import { ChevronRight, Mail, Phone } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { formatDate } from "@/lib/utils";
import type {
  CustomerOrderSummary,
  CustomerWithStats,
} from "@/lib/types";

export function CustomersManager({
  customers,
  ordersByCustomer,
}: {
  customers: CustomerWithStats[];
  ordersByCustomer: Record<string, CustomerOrderSummary[]>;
}) {
  const [selected, setSelected] = useState<CustomerWithStats | null>(null);

  const selectedOrders = selected ? (ordersByCustomer[selected.id] ?? []) : [];

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
                    onClick={() => setSelected(c)}
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
        onClose={() => setSelected(null)}
        title={selected?.name ?? "Customer"}
        className="max-w-lg"
      >
        {selected ? (
          <div className="space-y-4">
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
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold text-slate-700">
                Order history
              </p>
              {selectedOrders.length === 0 ? (
                <p className="text-sm text-slate-400">No orders linked yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {selectedOrders.map((order) => (
                    <li key={order.id} className="px-3 py-2.5">
                      <p className="text-sm font-medium text-slate-800">
                        {order.title}
                      </p>
                      <p className="text-xs text-slate-400">
                        {formatDate(order.created_at)}
                        {order.column_name
                          ? ` · ${order.column_name}`
                          : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
