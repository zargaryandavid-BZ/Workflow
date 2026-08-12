"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Mail, Package, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  formatIdleDuration,
  parseColumnIdleConfig,
  type IdleUnit,
} from "@/lib/column-idle-config";
import type {
  AutomationRule,
  AutomationTrigger,
  BoardColumn,
  NotificationType,
} from "@/lib/types";

interface Props {
  initialRules: AutomationRule[];
  columns: BoardColumn[];
  productOptions: string[];
}

const TRIGGERS: { value: AutomationTrigger; label: string }[] = [
  { value: "on_enter_column", label: "When a job enters a column" },
  { value: "on_approval_result", label: "When a customer responds" },
  { value: "on_job_created", label: "When a job is created (by product)" },
  {
    value: "on_column_idle",
    label: "When a job sits too long in a column",
  },
];

function isNotifyRule(rule: AutomationRule) {
  return (rule.config as { action?: string })?.action === "notify";
}

function triggerLabel(rule: AutomationRule) {
  if (rule.trigger === "on_approval_result") {
    const result = (rule.config as { result?: string })?.result;
    return `On approval: ${result ?? "any"}`;
  }
  if (rule.trigger === "on_job_created") {
    const product = (rule.config as { product?: string })?.product;
    return product ? `On create: ${product}` : "On create (product)";
  }
  if (rule.trigger === "on_column_idle") {
    const cfg = parseColumnIdleConfig(rule.config);
    return cfg ? `Idle ≥ ${formatIdleDuration(cfg)}` : "Idle auto-move";
  }
  return "On enter column";
}

export function AutomationsManager({
  initialRules,
  columns,
  productOptions,
}: Props) {
  const router = useRouter();
  const [trigger, setTrigger] = useState<AutomationTrigger>("on_enter_column");
  const [fromColumn, setFromColumn] = useState("");
  const [toColumn, setToColumn] = useState("");
  const [result, setResult] = useState("approved");
  const [product, setProduct] = useState("");
  const [idleValue, setIdleValue] = useState("2");
  const [idleUnit, setIdleUnit] = useState<IdleUnit>("days");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const columnName = (id: string | null) =>
    columns.find((c) => c.id === id)?.name ?? "—";

  const notifyRules = initialRules.filter(isNotifyRule);
  const otherRules = initialRules.filter((r) => !isNotifyRule(r));

  const notifyColumns = columns.filter(
    (c) =>
      c.kind === "approval" ||
      c.kind === "exception" ||
      c.kind === "ready_to_ship"
  );

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (trigger === "on_job_created" && !product.trim()) {
      setError("Select a product");
      return;
    }
    if (trigger === "on_column_idle") {
      if (!fromColumn) {
        setError("Select the column where the card sits");
        return;
      }
      if (!toColumn) {
        setError("Select the destination column");
        return;
      }
      if (fromColumn === toColumn) {
        setError("From and destination columns must be different");
        return;
      }
      const n = Number(idleValue);
      if (!Number.isFinite(n) || n < 1) {
        setError("Enter a duration of at least 1");
        return;
      }
    }
    setLoading(true);
    const res = await fetch("/api/automations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trigger,
        fromColumn:
          trigger === "on_enter_column" || trigger === "on_column_idle"
            ? fromColumn || null
            : null,
        toColumn,
        config:
          trigger === "on_approval_result"
            ? { result }
            : trigger === "on_job_created"
              ? { product: product.trim() }
              : trigger === "on_column_idle"
                ? {
                    idle_value: Math.round(Number(idleValue)),
                    idle_unit: idleUnit,
                  }
                : {},
      }),
    });
    const json = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(json.error ?? "Failed");
      return;
    }
    setToColumn("");
    setFromColumn("");
    setProduct("");
    setIdleValue("2");
    setIdleUnit("days");
    router.refresh();
  }

  async function toggle(rule: AutomationRule) {
    await fetch(`/api/automations/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !rule.enabled }),
    });
    router.refresh();
  }

  async function remove(id: string) {
    await fetch(`/api/automations/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">
            Customer notifications
          </h2>
          <p className="text-sm text-slate-500">
            When a job is dropped into one of these columns, notifications run
            automatically — email/SMS when enabled, or manual follow-up when
            disabled. Choose where the card moves after they respond.
          </p>
        </div>

        {notifyColumns.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-400">
            No approval, exception, or ready-to-ship columns yet. Add one on the
            Columns page to enable notifications.
          </p>
        ) : (
          <div className="space-y-3">
            {notifyColumns.map((col) => {
              const type: NotificationType =
                col.kind === "approval"
                  ? "customer_approval"
                  : col.kind === "ready_to_ship"
                    ? "ready_to_ship"
                    : "missing_info";
              const rule = notifyRules.find((r) => r.from_column === col.id);
              return (
                <NotifyColumnRow
                  key={col.id}
                  column={col}
                  type={type}
                  rule={rule}
                  columns={columns}
                  onChanged={() => router.refresh()}
                />
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">
            Movement rules
          </h2>
          <p className="text-sm text-slate-500">
            Rules run automatically as jobs flow through the pipeline. Route new
            jobs by product on create, move cards when they enter a column, after
            a customer approval response, or when a card sits too long in a
            column.
          </p>
        </div>

        <form
          onSubmit={add}
          className="space-y-4 rounded-lg border border-slate-200 bg-white p-4"
        >
          <div>
            <Label htmlFor="a-trigger">Trigger</Label>
            <Select
              id="a-trigger"
              value={trigger}
              onChange={(e) => setTrigger(e.target.value as AutomationTrigger)}
            >
              {TRIGGERS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {trigger === "on_enter_column" || trigger === "on_column_idle" ? (
              <div>
                <Label htmlFor="a-from">
                  {trigger === "on_column_idle"
                    ? "Sit in column"
                    : "From column"}
                </Label>
                <Select
                  id="a-from"
                  required={trigger === "on_column_idle"}
                  value={fromColumn}
                  onChange={(e) => setFromColumn(e.target.value)}
                >
                  <option value="">
                    {trigger === "on_column_idle"
                      ? "Select column…"
                      : "Any column"}
                  </option>
                  {columns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
            ) : trigger === "on_job_created" ? (
              <div>
                <Label htmlFor="a-product">Product</Label>
                <Select
                  id="a-product"
                  required
                  value={product}
                  onChange={(e) => setProduct(e.target.value)}
                >
                  <option value="">Select product…</option>
                  {productOptions.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
              </div>
            ) : (
              <div>
                <Label htmlFor="a-result">Customer response</Label>
                <Select
                  id="a-result"
                  value={result}
                  onChange={(e) => setResult(e.target.value)}
                >
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </Select>
              </div>
            )}
            <div>
              <Label htmlFor="a-to">Move to column</Label>
              <Select
                id="a-to"
                required
                value={toColumn}
                onChange={(e) => setToColumn(e.target.value)}
              >
                <option value="">Select column…</option>
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {trigger === "on_column_idle" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="a-idle-value">Max time in column</Label>
                <Input
                  id="a-idle-value"
                  type="number"
                  min={1}
                  max={365}
                  required
                  value={idleValue}
                  onChange={(e) => setIdleValue(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="a-idle-unit">Unit</Label>
                <Select
                  id="a-idle-unit"
                  value={idleUnit}
                  onChange={(e) => setIdleUnit(e.target.value as IdleUnit)}
                >
                  <option value="days">Calendar days</option>
                  <option value="working_days">Working days</option>
                  <option value="hours">Hours</option>
                </Select>
              </div>
              <p className="text-xs text-slate-500 sm:col-span-2">
                After a card enters the “sit in” column, if it stays there for
                this long it is moved automatically to the destination. Timing
                starts from when the card entered the column.
              </p>
            </div>
          ) : null}

          {trigger === "on_job_created" ? (
            <p className="text-xs text-slate-500">
              Applies when a job is created manually or via webhook. Matching
              products are routed to the target column automatically (overrides
              the default first column).
            </p>
          ) : null}
          {error ? (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={loading}>
            {loading ? "Adding…" : "Add rule"}
          </Button>
        </form>

        <div className="rounded-lg border border-slate-200 bg-white">
          {otherRules.length === 0 ? (
            <p className="p-4 text-sm text-slate-400">No movement rules.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {otherRules.map((rule) => (
                <li key={rule.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-3 text-sm text-slate-700">
                      <Badge className="bg-violet-100 text-violet-700">
                        {triggerLabel(rule)}
                      </Badge>
                      <span className="flex items-center gap-1.5 text-slate-500">
                        {rule.trigger === "on_enter_column" ||
                        rule.trigger === "on_column_idle"
                          ? columnName(rule.from_column)
                          : rule.trigger === "on_job_created"
                            ? ((rule.config as { product?: string }).product ??
                              "Product")
                            : null}
                        <ArrowRight className="h-4 w-4 shrink-0" />
                        <span className="font-medium text-slate-700">
                          {columnName(rule.to_column)}
                        </span>
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {rule.trigger === "on_column_idle" ? (
                        <button
                          type="button"
                          onClick={() =>
                            setEditingId((id) =>
                              id === rule.id ? null : rule.id
                            )
                          }
                          className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          aria-label="Edit rule"
                          title="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => toggle(rule)}
                        className={
                          rule.enabled
                            ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700"
                            : "rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500"
                        }
                      >
                        {rule.enabled ? "Enabled" : "Disabled"}
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(rule.id)}
                        className="rounded p-1.5 text-slate-400 hover:bg-red-100 hover:text-red-600"
                        aria-label="Delete rule"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  {editingId === rule.id &&
                  rule.trigger === "on_column_idle" ? (
                    <IdleRuleEditor
                      rule={rule}
                      columns={columns}
                      onDone={() => {
                        setEditingId(null);
                        router.refresh();
                      }}
                      onCancel={() => setEditingId(null)}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function IdleRuleEditor({
  rule,
  columns,
  onDone,
  onCancel,
}: {
  rule: AutomationRule;
  columns: BoardColumn[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const cfg = parseColumnIdleConfig(rule.config);
  const [fromColumn, setFromColumn] = useState(rule.from_column ?? "");
  const [toColumn, setToColumn] = useState(rule.to_column ?? "");
  const [idleValue, setIdleValue] = useState(String(cfg?.idle_value ?? 2));
  const [idleUnit, setIdleUnit] = useState<IdleUnit>(cfg?.idle_unit ?? "days");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!fromColumn || !toColumn || fromColumn === toColumn) {
      setError("Choose two different columns");
      return;
    }
    const n = Number(idleValue);
    if (!Number.isFinite(n) || n < 1) {
      setError("Duration must be at least 1");
      return;
    }
    setSaving(true);
    const res = await fetch(`/api/automations/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromColumn,
        toColumn,
        config: {
          idle_value: Math.round(n),
          idle_unit: idleUnit,
        },
      }),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError((json as { error?: string }).error ?? "Save failed");
      return;
    }
    onDone();
  }

  return (
    <form
      onSubmit={save}
      className="mt-3 grid grid-cols-1 gap-3 rounded-md border border-slate-100 bg-slate-50/80 p-3 sm:grid-cols-2"
    >
      <div>
        <Label className="text-xs">Sit in column</Label>
        <Select
          className="mt-1"
          value={fromColumn}
          onChange={(e) => setFromColumn(e.target.value)}
        >
          {columns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label className="text-xs">Move to column</Label>
        <Select
          className="mt-1"
          value={toColumn}
          onChange={(e) => setToColumn(e.target.value)}
        >
          {columns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label className="text-xs">Max time</Label>
        <Input
          className="mt-1"
          type="number"
          min={1}
          max={365}
          value={idleValue}
          onChange={(e) => setIdleValue(e.target.value)}
        />
      </div>
      <div>
        <Label className="text-xs">Unit</Label>
        <Select
          className="mt-1"
          value={idleUnit}
          onChange={(e) => setIdleUnit(e.target.value as IdleUnit)}
        >
          <option value="days">Calendar days</option>
          <option value="working_days">Working days</option>
          <option value="hours">Hours</option>
        </Select>
      </div>
      {error ? (
        <p className="text-xs text-red-600 sm:col-span-2">{error}</p>
      ) : null}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={saving} className="h-8 text-xs">
          {saving ? "Saving…" : "Save changes"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="h-8 text-xs"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}


function NotifyColumnRow({
  column,
  type,
  rule,
  columns,
  onChanged,
}: {
  column: BoardColumn;
  type: NotificationType;
  rule: AutomationRule | undefined;
  columns: BoardColumn[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const enabled = rule?.enabled ?? false;

  async function setEnabled(next: boolean) {
    setBusy(true);
    if (!rule) {
      // Create a new notify rule for this column.
      await fetch("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trigger: "on_enter_column",
          fromColumn: column.id,
          toColumn: null,
          config: { action: "notify", notify_type: type },
        }),
      });
    } else {
      await fetch(`/api/automations/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
    }
    setBusy(false);
    onChanged();
  }

  async function setTarget(toColumn: string) {
    if (!rule) return;
    setBusy(true);
    await fetch(`/api/automations/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toColumn: toColumn || null }),
    });
    setBusy(false);
    onChanged();
  }

  async function setRejectedTarget(rejectedToColumn: string) {
    if (!rule) return;
    setBusy(true);
    await fetch(`/api/automations/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rejectedToColumn: rejectedToColumn || null }),
    });
    setBusy(false);
    onChanged();
  }

  const rejectedTarget =
    (rule?.config as { rejected_to_column?: string | null } | undefined)
      ?.rejected_to_column ?? "";

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
        <span
          className={
            type === "customer_approval"
              ? "flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-700"
              : type === "ready_to_ship"
                ? "flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700"
                : "flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-700"
          }
        >
          {type === "ready_to_ship" ? (
            <Package className="h-4 w-4" />
          ) : (
            <Mail className="h-4 w-4" />
          )}
        </span>
          <div>
            <p className="text-sm font-medium text-slate-800">{column.name}</p>
            <p className="text-xs text-slate-500">
              {type === "customer_approval"
                ? "Send a proof approval request"
                : type === "ready_to_ship"
                  ? "Notify customer their order is ready"
                  : "Request missing information"}
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => setEnabled(!enabled)}
          className={
            enabled
              ? "rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700 disabled:opacity-60"
              : "rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500 disabled:opacity-60"
          }
        >
          {enabled ? "Enabled" : "Disabled"}
        </button>
      </div>

      {enabled && type === "ready_to_ship" ? (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="text-xs text-slate-500">
            When a job is dropped here, a confirmation popup will appear so you
            can notify the customer via email or SMS that their order is ready.
            For multi-part orders, sending waits until all parts are in this
            column — one link shows every part.
          </p>
        </div>
      ) : null}

      {enabled && type === "missing_info" ? (
        <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
          <div>
            <Label htmlFor={`target-${column.id}`}>
              When the customer submits info, move the card to
            </Label>
            <Select
              id={`target-${column.id}`}
              value={rule?.to_column ?? ""}
              disabled={busy}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">Leave in place</option>
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      ) : null}

      {enabled && type === "customer_approval" ? (
        <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
          <div>
            <Label htmlFor={`approved-target-${column.id}`}>
              When the customer approves, move the card to
            </Label>
            <Select
              id={`approved-target-${column.id}`}
              value={rule?.to_column ?? ""}
              disabled={busy}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">Leave in place</option>
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor={`rejected-target-${column.id}`}>
              When the customer requests changes, move the card to
            </Label>
            <Select
              id={`rejected-target-${column.id}`}
              value={rejectedTarget}
              disabled={busy}
              onChange={(e) => setRejectedTarget(e.target.value)}
            >
              <option value="">Leave in place</option>
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      ) : null}
    </div>
  );
}
