"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { type DieManufacturer } from "@/lib/die-manufacturers";
import { dieRequestAlert, type DieRequest } from "@/lib/die-request";
import {
  DIES_MIGRATION_HINT,
  DIE_SHAPES,
  DIE_SHAPE_LABEL,
  DIE_SHOP_STATUSES,
  DIE_SHOP_STATUS_LABEL,
  DIE_TYPES,
  DIE_TYPE_LABEL,
  dieQrPath,
  dieShowsInLibrary,
  parseDieCodeInput,
  type DieShape,
  type DieShopStatus,
  type DieType,
  type Die,
} from "@/lib/dies";
import { cn, formatDate } from "@/lib/utils";
import { DieRequestCard } from "@/components/die/die-request-card";
import { DieFormModal } from "@/components/die/die-form-modal";
import { DieLibraryTable } from "@/components/die/die-library-table";
import { DieRequestModal } from "@/components/die/die-request-modal";
import { DieManufacturersManager } from "@/components/die/die-manufacturers-manager";

type DieOrderTab = "dies" | "requests" | "manufacturers";

export function DieOrderClient({
  requests,
  manufacturers,
  dies,
  diesMigrationMissing,
  manufacturersMigrationMissing = false,
}: {
  requests: DieRequest[];
  manufacturers: DieManufacturer[];
  dies: Die[];
  diesMigrationMissing: boolean;
  manufacturersMigrationMissing?: boolean;
}) {
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const [formDie, setFormDie] = useState<Die | "new" | null>(null);
  const [formRequest, setFormRequest] = useState<DieRequest | null>(null);
  const [search, setSearch] = useState("");
  const [reorderDie, setReorderDie] = useState<Die | null>(null);
  const [statusFilter, setStatusFilter] = useState<DieShopStatus | "">("");
  const [typeFilter, setTypeFilter] = useState<DieType | "">("");
  const [shapeFilter, setShapeFilter] = useState<DieShape | "">("");
  const [tab, setTabState] = useState<DieOrderTab>("dies");

  // Remember the last tab on this device.
  useEffect(() => {
    try {
      // ?tab=manufacturers (old Settings link) wins over the remembered tab.
      const fromUrl = new URLSearchParams(window.location.search).get("tab");
      const saved = fromUrl ?? localStorage.getItem("die-order-tab");
      if (saved === "requests" || saved === "manufacturers") setTabState(saved);
    } catch {
      /* ignore */
    }
  }, []);
  function setTab(next: DieOrderTab) {
    setTabState(next);
    // Drop ?tab= so a refresh reopens the tab you chose.
    if (window.location.search.includes("tab=")) {
      window.history.replaceState(null, "", window.location.pathname);
    }
    try {
      localStorage.setItem("die-order-tab", next);
    } catch {
      /* ignore */
    }
  }
  const waitingCount = requests.filter((r) => r.status === "quoted").length;

  const alarms = useMemo(
    () =>
      requests
        .map((req) => ({ req, alert: dieRequestAlert(req) }))
        .filter(
          (row): row is { req: DieRequest; alert: NonNullable<ReturnType<typeof dieRequestAlert>> } =>
            Boolean(row.alert)
        ),
    [requests]
  );

  const requestCountByDie = useMemo(() => {
    const out: Record<string, number> = {};
    for (const req of requests) {
      if (req.die_id) out[req.die_id] = (out[req.die_id] ?? 0) + 1;
    }
    return out;
  }, [requests]);

  const dieCodeById = useMemo(
    () => Object.fromEntries(dies.map((d) => [d.id, d.template_code])),
    [dies]
  );
  const dieById = useMemo(
    () => new Map(dies.map((die) => [die.id, die])),
    [dies]
  );

  // Dies ordered from a manufacturer show here once their request is received.
  const libraryDies = useMemo(() => dies.filter((d) => dieShowsInLibrary(d)), [dies]);

  const shownDies = useMemo(() => {
    const q = search.trim().toLowerCase();
    return libraryDies.filter((d) => {
      if (statusFilter && d.shop_status !== statusFilter) return false;
      if (typeFilter && d.die_type !== typeFilter) return false;
      if (shapeFilter && d.shape !== shapeFilter) return false;
      if (!q) return true;
      return [
        d.name,
        d.template_code,
        d.order_title,
        d.customer_name,
        d.manufacturer_name,
        d.location,
        d.pacdora_template_name,
        DIE_TYPE_LABEL[d.die_type],
      ].some((v) => v?.toLowerCase().includes(q));
    });
  }, [libraryDies, search, shapeFilter, statusFilter, typeFilter]);

  const shownRequests = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return requests;
    return requests.filter((request) => {
      const die = request.die_id ? dieById.get(request.die_id) : null;
      return [
        request.order_title,
        request.customer_name,
        request.product_name,
        die?.name,
        die?.template_code,
      ].some((value) => value?.toLowerCase().includes(q));
    });
  }, [dieById, requests, search]);

  return (
    <div className="space-y-5">
      {alarms.length > 0 ? (
        <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-red-800">
            <AlertTriangle className="h-4 w-4" />
            Die due date alarms
          </p>
          <ul className="space-y-1 text-sm text-red-800">
            {alarms.map(({ req, alert }) => (
              <li key={req.id}>
                {req.order_title ?? "Order"} — {alert.label} (
                {formatDate(alert.confirmedDueDate)})
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {notice ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <label className="relative min-w-64 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            aria-label="Search dies and requests"
            className="h-11 w-full pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              // Scanning a die QR (or typing DIE-00007) + Enter opens that die.
              if (e.key !== "Enter") return;
              const code = parseDieCodeInput(search);
              if (!code) return;
              e.preventDefault();
              router.push(dieQrPath(code));
            }}
            placeholder="Search customer, die name, order number or Die QR / Template ID"
          />
        </label>
        {tab === "dies" ? (
          <>
            <Select
              aria-label="Filter by status"
              className="h-11 w-40"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as DieShopStatus | "")
              }
            >
              <option value="">All statuses</option>
              {DIE_SHOP_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {DIE_SHOP_STATUS_LABEL[status]}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Filter by die type"
              className="h-11 w-40"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as DieType | "")}
            >
              <option value="">All die types</option>
              {DIE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {DIE_TYPE_LABEL[type]}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Filter by shape"
              className="h-11 w-40"
              value={shapeFilter}
              onChange={(e) => setShapeFilter(e.target.value as DieShape | "")}
            >
              <option value="">All shapes</option>
              {DIE_SHAPES.map((shape) => (
                <option key={shape} value={shape}>
                  {DIE_SHAPE_LABEL[shape]}
                </option>
              ))}
            </Select>
          </>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2 border-b border-slate-200">
      <div role="tablist" aria-label="Die Order" className="flex gap-1">
        {(
          [
            ["dies", "Dies", libraryDies.length, null],
            ["requests", "Requests", requests.length, waitingCount],
            ["manufacturers", "Manufacturers", manufacturers.length, null],
          ] as const
        ).map(([key, label, count, attention]) => {
          const on = tab === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              id={`die-tab-${key}`}
              aria-selected={on}
              aria-controls={`die-panel-${key}`}
              onClick={() => setTab(key)}
              className={cn(
                "-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors",
                on
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              )}
            >
              {label}
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
                  on ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"
                )}
              >
                {count}
              </span>
              {attention ? (
                <span
                  className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800"
                  title="Quotes waiting for you to confirm"
                >
                  {attention} quoted
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {tab === "dies" ? (
        <div className="pb-2">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              onClick={() => {
                setFormRequest(null);
                setFormDie("new");
              }}
              disabled={diesMigrationMissing}
              className="inline-flex items-center gap-1.5"
            >
              <Plus className="h-4 w-4" />
              Add Die
            </Button>
          </div>
        </div>
      ) : null}
      </div>

      {tab === "dies" ? (
      <section role="tabpanel" id="die-panel-dies" aria-labelledby="die-tab-dies">
        {diesMigrationMissing ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            The die list isn&apos;t set up yet. {DIES_MIGRATION_HINT}
          </p>
        ) : libraryDies.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            No dies yet. A die shows here when you add it with{" "}
            <span className="font-semibold">+ Add Die</span>, or when a die you
            ordered is marked received.
          </p>
        ) : shownDies.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            No dies match the selected filters.
          </p>
        ) : (
          <DieLibraryTable
            dies={shownDies}
            onEdit={(die) => {
              setFormRequest(null);
              setFormDie(die);
            }}
            onReorder={(die) => setReorderDie(die)}
            onUpdated={() => router.refresh()}
          />
        )}
      </section>
      ) : tab === "manufacturers" ? (
      <section role="tabpanel" id="die-panel-manufacturers" aria-labelledby="die-tab-manufacturers">
        <DieManufacturersManager
          initial={manufacturers}
          migrationRequired={manufacturersMigrationMissing}
          onChanged={() => router.refresh()}
          search={search}
        />
      </section>
      ) : (
      <section role="tabpanel" id="die-panel-requests" aria-labelledby="die-tab-requests">
        {requests.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            No die requests yet. Use <span className="font-semibold">Request quote</span> on a die.
          </p>
        ) : shownRequests.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            No requests match “{search.trim()}”.
          </p>
        ) : (
          <ul className="space-y-3">
            {shownRequests.map((req) => (
              <DieRequestCard
                key={req.id}
                req={req}
                dieCode={req.die_id ? dieCodeById[req.die_id] ?? null : null}
                manufacturers={manufacturers}
                onEditDie={
                  req.die_id && dieById.has(req.die_id)
                    ? () => {
                        setFormRequest(req);
                        setFormDie(dieById.get(req.die_id!)!);
                      }
                    : undefined
                }
                onSaved={(msg) => {
                  if (msg) setNotice(msg);
                  router.refresh();
                }}
              />
            ))}
          </ul>
        )}
      </section>
      )}

      {formDie ? (
        <DieFormModal
          die={formDie === "new" ? null : formDie}
          historyRequest={formRequest}
          onClose={() => {
            setFormDie(null);
            setFormRequest(null);
          }}
          requestCount={
            formDie === "new" ? 0 : requestCountByDie[formDie.id] ?? 0
          }
          onDeleted={(die) => {
            setFormDie(null);
            setFormRequest(null);
            setNotice(`Die “${die.name}” (${die.template_code}) deleted.`);
            router.refresh();
          }}
          manufacturers={manufacturers}
          onSaved={(die, created, result) => {
            setFormDie(null);
            setFormRequest(null);
            const base = result?.sent
              ? `Order for ${die.template_code} “${die.name}” sent to the manufacturer. It's on the Requests tab until you mark it received.`
              : created
                ? `Added ${die.template_code} “${die.name}”.`
                : `Die “${die.name}” saved.`;
            setNotice(result?.warning ? `${base} But ${result.warning}.` : base);
            if (result?.sent) setTab("requests");
            router.refresh();
          }}
        />
      ) : null}

      {reorderDie ? (
        <DieRequestModal
          die={reorderDie}
          manufacturers={manufacturers}
          onClose={() => setReorderDie(null)}
          onSent={(msg) => {
            setReorderDie(null);
            setNotice(msg);
            setTab("requests");
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
