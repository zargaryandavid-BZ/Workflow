"use client";

import { useState } from "react";
import { ChevronRight, Mail, Phone } from "lucide-react";
import { CardDetailModal } from "@/components/board/card-detail-modal";
import { Modal } from "@/components/ui/modal";
import { formatDate } from "@/lib/utils";
import type {
  BoardColumn,
  CustomField,
  CustomerOrderSummary,
  CustomerWithStats,
  Designer,
  Role,
} from "@/lib/types";

export function CustomersManager({
  customers,
  ordersByCustomer,
  customFields,
  columns,
  designers,
  role,
}: {
  customers: CustomerWithStats[];
  ordersByCustomer: Record<string, CustomerOrderSummary[]>;
  customFields: CustomField[];
  columns: BoardColumn[];
  designers: Designer[];
  role: Role;
}) {
  const [selected, setSelected] = useState<CustomerWithStats | null>(null);
  const [viewOrderId, setViewOrderId] = useState<string | null>(null);

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
          </div>
        ) : null}
      </Modal>

      <CardDetailModal
        orderId={viewOrderId}
        open={viewOrderId !== null}
        onClose={() => setViewOrderId(null)}
        customFields={customFields}
        columns={columns}
        designers={designers}
        role={role}
        mode="view"
        onChanged={() => {}}
      />
    </div>
  );
}
