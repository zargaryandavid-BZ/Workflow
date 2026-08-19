"use client";

import { useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ConnectedSpecInputs,
  type SpecEditValue,
} from "@/components/board/connected-spec-inputs";
import { getDisplaySpecs, isConnectedOrder } from "@/lib/connected-specs";
import { findSpecOptions } from "@/lib/crm-catalog-v2";
import { useCatalogCache } from "@/lib/use-catalog-cache";
import type { CrmSnapshot, Order, UserSpecOverride } from "@/lib/types";

export function ConnectedSpecsSection({
  order,
  onOrderPatch,
}: {
  order: Pick<Order, "id" | "integration_mode" | "crm_snapshot" | "user_overrides">;
  onOrderPatch: (patch: {
    user_overrides?: Record<string, UserSpecOverride> | null;
  }) => void;
}) {
  const catalog = useCatalogCache();
  const specs = useMemo(() => getDisplaySpecs(order), [order]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<SpecEditValue | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isConnectedOrder(order)) return null;

  const lineItem = (order.crm_snapshot as CrmSnapshot | null)?.line_items?.[0];
  const productId = lineItem?.product_id;
  const productName = lineItem?.product_name;

  async function save(key: string, next: SpecEditValue) {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/orders/${order.id}/spec-override`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key,
        display_value: next.display_value,
        value: next.value,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
      order?: { user_overrides?: Record<string, UserSpecOverride> | null };
    };
    setSaving(false);
    if (!res.ok) {
      setError(json.error ?? "Failed to save spec");
      return;
    }
    onOrderPatch({
      user_overrides:
        json.order?.user_overrides ?? {
          ...(order.user_overrides ?? {}),
          [key]: { display_value: next.display_value, value: next.value },
        },
    });
    setEditingKey(null);
    setDraft(null);
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
      <p className="text-sm font-semibold text-slate-700">
        Product Specifications — from CRM
      </p>
      {specs.length === 0 ? (
        <p className="text-sm text-slate-500">No specifications listed.</p>
      ) : (
        <div className="space-y-2">
          {specs.map((spec) => {
            const editing = editingKey === spec.key;
            const options = findSpecOptions(
              catalog,
              productId,
              productName,
              spec.key
            );
            return (
              <div
                key={spec.key}
                className="group rounded-lg border border-transparent px-1 py-1 hover:border-slate-200 hover:bg-white"
              >
                {editing ? (
                  <div className="space-y-2">
                    <ConnectedSpecInputs
                      specType={spec.type}
                      label={spec.label}
                      options={options}
                      value={draft?.value ?? spec.value}
                      onChange={setDraft}
                    />
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={saving || !draft}
                        onClick={() => {
                          if (draft) void save(spec.key, draft);
                        }}
                      >
                        {saving ? "Saving…" : "Save"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={saving}
                        onClick={() => {
                          setEditingKey(null);
                          setDraft(null);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-500">
                        {spec.label}
                      </p>
                      <p className="text-sm text-slate-900">
                        {spec.display_value}
                        {spec.overridden ? (
                          <Pencil
                            className="ml-1 inline h-3 w-3 text-amber-600"
                            aria-label="Edited in Workflow"
                          />
                        ) : null}
                      </p>
                    </div>
                    <button
                      type="button"
                      title="Edit spec"
                      onClick={() => {
                        setEditingKey(spec.key);
                        setDraft({
                          display_value: spec.display_value ?? "",
                          value: spec.value,
                        });
                      }}
                      className="rounded-md p-1 text-slate-400 opacity-0 transition-opacity hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
