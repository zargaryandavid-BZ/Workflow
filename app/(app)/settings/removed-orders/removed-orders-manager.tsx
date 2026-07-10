"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { CardDetailModal } from "@/components/board/card-detail-modal";
import { formatDateTime } from "@/lib/utils";
import type {
  BoardColumn,
  CustomField,
  Designer,
  OrderWithRelations,
  Role,
} from "@/lib/types";
import type { OrderOwner } from "@/components/board/order-form-body";

interface RemovedOrdersManagerProps {
  orders: OrderWithRelations[];
  columns: BoardColumn[];
  owners: OrderOwner[];
  customFields: CustomField[];
  designers: Designer[];
  role: Role;
  removedByNameById: Record<string, string>;
}

export function RemovedOrdersManager({
  orders: initialOrders,
  columns,
  owners,
  customFields,
  designers,
  role,
  removedByNameById,
}: RemovedOrdersManagerProps) {
  const router = useRouter();
  const [orders, setOrders] = useState(initialOrders);
  const [viewOrderId, setViewOrderId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orderQuery, setOrderQuery] = useState("");
  const [columnFilter, setColumnFilter] = useState("");
  const [removedByFilter, setRemovedByFilter] = useState("");

  const columnNameById = new Map(columns.map((c) => [c.id, c.name]));

  const removedByOptions = useMemo(
    () =>
      Object.entries(removedByNameById)
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [removedByNameById]
  );

  const filtersActive =
    orderQuery.trim() !== "" || columnFilter !== "" || removedByFilter !== "";

  const filteredOrders = useMemo(() => {
    const q = orderQuery.trim().toLowerCase();
    return orders.filter((order) => {
      if (columnFilter && order.column_id !== columnFilter) return false;
      if (removedByFilter && order.removed_by !== removedByFilter) return false;
      if (!q) return true;

      const customerName = order.customer?.name ?? "";
      const email = order.customer?.email ?? "";
      const phone = order.customer?.phone ?? "";
      const searchable = [order.title, customerName, email, phone]
        .join(" ")
        .toLowerCase();
      return searchable.includes(q);
    });
  }, [orders, orderQuery, columnFilter, removedByFilter]);

  async function restoreOrder(orderId: string) {
    setRestoringId(orderId);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/restore`, {
        method: "POST",
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Failed to restore order");
        return;
      }
      setOrders((prev) => prev.filter((o) => o.id !== orderId));
      router.refresh();
    } finally {
      setRestoringId(null);
    }
  }

  if (orders.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
        No removed orders. Removed orders are hidden from the board and other
        staff.
      </div>
    );
  }

  return (
    <div>
      {error ? (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[10rem] flex-1 sm:w-56 sm:flex-none">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={orderQuery}
            onChange={(e) => setOrderQuery(e.target.value)}
            placeholder="Filter by order, customer, email, phone…"
            className="h-9 w-full pl-8"
            aria-label="Filter removed orders by order number, customer, email or phone"
          />
        </div>
        <Select
          value={columnFilter}
          onChange={(e) => setColumnFilter(e.target.value)}
          className="h-9 min-w-[8rem] max-w-[12rem] flex-1 truncate sm:w-44 sm:flex-none"
          aria-label="Filter by last column"
        >
          <option value="">All columns</option>
          {columns.map((column) => (
            <option key={column.id} value={column.id}>
              {column.name}
            </option>
          ))}
        </Select>
        <Select
          value={removedByFilter}
          onChange={(e) => setRemovedByFilter(e.target.value)}
          className="h-9 min-w-[8rem] max-w-[12rem] flex-1 truncate sm:w-44 sm:flex-none"
          aria-label="Filter by removed by"
        >
          <option value="">All people</option>
          {removedByOptions.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </Select>
        {filtersActive ? (
          <button
            type="button"
            onClick={() => {
              setOrderQuery("");
              setColumnFilter("");
              setRemovedByFilter("");
            }}
            className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md border border-slate-300 px-2.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </button>
        ) : null}
        <span className="shrink-0 whitespace-nowrap text-sm text-slate-500">
          {filtersActive
            ? `${filteredOrders.length} of ${orders.length}`
            : `${orders.length} removed`}
        </span>
      </div>

      {filteredOrders.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
          No removed orders match your filters.
        </div>
      ) : (
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2.5">Order</th>
              <th className="px-3 py-2.5">Last column</th>
              <th className="px-3 py-2.5">Removed</th>
              <th className="px-3 py-2.5">Removed by</th>
              <th className="px-3 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {filteredOrders.map((order) => (
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
                  {columnNameById.get(order.column_id) ?? "—"}
                </td>
                <td className="px-3 py-2.5 text-slate-600">
                  {order.removed_at ? formatDateTime(order.removed_at) : "—"}
                </td>
                <td className="px-3 py-2.5 text-slate-600">
                  {order.removed_by
                    ? (removedByNameById[order.removed_by] ?? "Admin")
                    : "—"}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => restoreOrder(order.id)}
                      disabled={restoringId === order.id}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {restoringId === order.id ? "Restoring…" : "Restore"}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      <p className="mt-4 flex items-start gap-2 text-xs text-slate-500">
        <Trash2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Removed orders stay in the database for admin review but are invisible to
        other employees on the board, customers page, and analytics.
      </p>

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
        onChanged={() => router.refresh()}
      />
    </div>
  );
}
