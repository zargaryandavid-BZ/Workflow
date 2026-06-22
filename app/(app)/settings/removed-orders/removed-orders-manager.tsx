"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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

  const columnNameById = new Map(columns.map((c) => [c.id, c.name]));

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
            {orders.map((order) => (
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
