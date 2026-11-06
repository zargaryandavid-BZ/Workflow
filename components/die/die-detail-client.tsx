"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  BellRing,
  ExternalLink,
  FileText,
  History,
  LogIn,
  LogOut,
  Package,
  Pencil,
  Printer,
  RotateCcw,
  Send,
  Wrench,
} from "lucide-react";
import { formatShortOrderNumber } from "@/lib/board-order-filters";
import type { DieManufacturer } from "@/lib/die-manufacturers";
import { formatDieQuotedPrice } from "@/lib/die-request";
import {
  DIE_SHAPE_LABEL,
  DIE_TYPE_LABEL,
  dieEventLabel,
  dieUsageLevel,
  formatDieLwh,
  formatDieUses,
  type Die,
  type DieEvent,
  type DieShopStatus,
} from "@/lib/dies";
import type { DieOrderHistoryRow } from "@/lib/dies.server";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { DieFormModal } from "@/components/die/die-form-modal";
import { DieRequestModal } from "@/components/die/die-request-modal";
import { DieStatusSelect } from "@/components/die/die-status-select";
import { DieUseButton } from "@/components/die/die-use-button";

const TYPE_CLASS: Record<Die["die_type"], string> = {
  label: "bg-violet-50 text-violet-700",
  paper: "bg-amber-50 text-amber-700",
  box: "bg-sky-50 text-sky-700",
  other: "bg-slate-100 text-slate-600",
};

const EVENT_ICON: Record<DieEvent["kind"], typeof History> = {
  added: Package,
  ordered: Send,
  received: Package,
  used: LogOut,
  returned: LogIn,
  status: Wrench,
  reorder: RotateCcw,
  edited: Pencil,
  deleted: AlertTriangle,
  reminded: BellRing,
};

const ORDER_STATUS_LABEL: Record<string, string> = {
  sent: "Waiting for price",
  quoted: "Price received",
  ordered: "Ordered",
  received: "Received",
};

/** PATCH status / reorder; returns the saved die. */
async function saveDieShop(
  die: Die,
  body: { shop_status?: DieShopStatus; reorder?: boolean }
): Promise<Die> {
  const res = await fetch(`/api/dies/${die.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string; die?: Die };
  if (!res.ok || !json.die) throw new Error(json.error ?? "Could not save the die");
  return json.die;
}

function durationLabel(minutes: unknown): string | null {
  const m = Number(minutes);
  if (!Number.isFinite(m) || m <= 0) return null;
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h < 24) return rest ? `${h} h ${rest} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"}`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 text-right font-medium text-slate-800">{children}</dd>
    </div>
  );
}

export function DieDetailClient({
  die: initial,
  events,
  orders,
  historyMissing,
  canEdit,
  manufacturers,
}: {
  die: Die;
  events: DieEvent[];
  orders: DieOrderHistoryRow[];
  historyMissing: boolean;
  canEdit: boolean;
  manufacturers: DieManufacturer[];
}) {
  const router = useRouter();
  const [die, setDie] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyTab, setHistoryTab] = useState<"all" | "usage" | "orders">("all");

  function changed(next: Die) {
    setDie(next);
    router.refresh(); // reload history
  }

  async function shop(body: { shop_status?: DieShopStatus; reorder?: boolean }) {
    setBusy(true);
    setError(null);
    try {
      changed(await saveDieShop(die, body));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the die");
    } finally {
      setBusy(false);
    }
  }

  const level = dieUsageLevel(die);
  // A deleted die (e.g. opened from an old QR label) is read-only.
  const deleted = Boolean(die.deleted_at);
  const pct = die.max_uses ? Math.min(100, Math.round((die.use_count / die.max_uses) * 100)) : 0;
  const usageEvents = events.filter((e) => e.kind === "used" || e.kind === "returned");

  // One timeline: events + each order's milestones, newest first.
  const timeline = useMemo(() => {
    type Item = { key: string; at: string; title: string; who: string | null; detail: string | null; icon: typeof History; tone: string };
    const items: Item[] = [];
    const showEvents = historyTab !== "orders";
    const showOrders = historyTab !== "usage";
    if (showEvents) {
      for (const e of historyTab === "usage" ? usageEvents : events) {
        // Order events come from the order rows below (with prices / dates).
        if (historyTab === "all" && (e.kind === "ordered" || e.kind === "received")) continue;
        const detail =
          e.kind === "returned"
            ? [
                e.meta.taken_by ? `Taken by ${String(e.meta.taken_by)}` : null,
                durationLabel(e.meta.minutes) ? `out ${durationLabel(e.meta.minutes)}` : null,
              ]
                .filter(Boolean)
                .join(" · ") || null
            : e.kind === "used" && e.meta.max_uses
              ? `of ${String(e.meta.max_uses)} max`
              : null;
        items.push({
          key: e.id,
          at: e.created_at,
          title: dieEventLabel(e),
          who: e.actor_name,
          detail: [detail, e.note].filter(Boolean).join(" · ") || null,
          icon: EVENT_ICON[e.kind],
          tone:
            e.kind === "status" && e.meta.to === "out_of_order"
              ? "bg-red-50 text-red-700"
              : e.kind === "used"
                ? "bg-blue-50 text-blue-700"
                : e.kind === "returned"
                  ? "bg-amber-50 text-amber-700"
                  : "bg-slate-100 text-slate-600",
        });
      }
    }
    if (showOrders) {
      for (const o of orders) {
        const from = o.manufacturer_name ? ` · ${o.manufacturer_name}` : "";
        if (o.sent_at) {
          items.push({ key: `${o.id}-sent`, at: o.sent_at, title: `Order sent${from}`, who: null, detail: o.required_date ? `Needed by ${formatDate(o.required_date)}` : null, icon: Send, tone: "bg-indigo-50 text-indigo-700" });
        }
        if (o.quoted_at) {
          items.push({
            key: `${o.id}-quoted`,
            at: o.quoted_at,
            title: `Price received${from}`,
            who: null,
            detail: [
              formatDieQuotedPrice(o.quoted_price),
              o.time_estimate,
              o.confirmed_due_date ? `due ${formatDate(o.confirmed_due_date)}` : null,
            ].filter(Boolean).join(" · "),
            icon: Send,
            tone: "bg-indigo-50 text-indigo-700",
          });
        }
        if (o.ordered_at) {
          items.push({ key: `${o.id}-ordered`, at: o.ordered_at, title: `Order confirmed${from}`, who: null, detail: null, icon: Send, tone: "bg-indigo-50 text-indigo-700" });
        }
        if (o.received_at) {
          items.push({ key: `${o.id}-received`, at: o.received_at, title: "Die received", who: null, detail: null, icon: Package, tone: "bg-emerald-50 text-emerald-700" });
        }
      }
    }
    return items.sort((a, b) => b.at.localeCompare(a.at));
  }, [events, orders, historyTab, usageEvents]);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .die-qr-sheet, .die-qr-sheet * { visibility: visible !important; }
          .die-qr-sheet { position: fixed !important; inset: 0 auto auto 0 !important; margin: 0 !important; box-shadow: none !important; }
        }
      `}</style>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {canEdit ? (
            <Link href="/die-order" className="mb-1 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800">
              <ArrowLeft className="h-4 w-4" /> Die Order
            </Link>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-2xl font-bold tracking-wider text-slate-900">
              {die.template_code}
            </span>
            <h1 className="text-xl font-semibold text-slate-800">{die.name}</h1>
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", TYPE_CLASS[die.die_type])}>
              {DIE_TYPE_LABEL[die.die_type]}
            </span>
            {die.on_order ? (
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                On order
              </span>
            ) : null}
          </div>
        </div>
        {deleted ? null : (
        <div className="flex items-center gap-2">
          <DieStatusSelect
            value={die.shop_status}
            disabled={busy}
            onChange={(shop_status) => void shop({ shop_status })}
            className="h-10 px-3 text-sm"
          />
          {canEdit ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => setReordering(true)}
                className="inline-flex h-10 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                <RotateCcw className="h-4 w-4" /> Reorder
              </button>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex h-10 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Pencil className="h-4 w-4" /> Edit
              </button>
            </>
          ) : null}
        </div>
        )}
      </div>

      {deleted ? (
        <p className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          This die was deleted on {formatDateTime(die.deleted_at!)}. It can&apos;t be used or changed;
          its history is kept below.
        </p>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}
      {historyMissing ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Usage and history aren&apos;t set up yet. Run migration 0096_die_usage_history.sql in Supabase.
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-5">
          {/* Usage */}
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Usage</p>
                <p className={cn("mt-1 text-3xl font-bold tabular-nums", level === "over" ? "text-red-700" : level === "near" ? "text-amber-700" : "text-slate-900")}>
                  {formatDieUses(die)}
                  <span className="ml-1.5 text-base font-medium text-slate-500">
                    {die.max_uses ? "uses" : die.use_count === 1 ? "use" : "uses"}
                  </span>
                </p>
                {die.max_uses ? (
                  <div className="mt-2 h-2 w-64 max-w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={cn("h-full rounded-full", level === "over" ? "bg-red-500" : level === "near" ? "bg-amber-500" : "bg-blue-600")}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">No max uses set{canEdit ? " (Edit to set one)" : ""}.</p>
                )}
                {level === "over" ? (
                  <p className="mt-2 text-sm font-semibold text-red-700">Reached its max uses. Consider a reorder.</p>
                ) : level === "near" ? (
                  <p className="mt-2 text-sm font-semibold text-amber-700">Near its max uses.</p>
                ) : null}
              </div>
              {deleted ? null : <DieUseButton die={die} onChanged={changed} size="lg" />}
            </div>
            <dl className="mt-4 grid gap-x-6 border-t border-slate-100 pt-3 sm:grid-cols-2">
              <Row label="Now">
                {die.checked_out_at ? (
                  <span className="text-amber-800">
                    With {die.checked_out_by_name || "someone"} since {formatDateTime(die.checked_out_at)}
                  </span>
                ) : die.shop_status === "out_of_order" ? (
                  <span className="text-red-700">Out of order</span>
                ) : (
                  <span className="text-emerald-700">
                    On the shelf{die.location ? ` · ${die.location}` : ""}
                  </span>
                )}
              </Row>
              <Row label="Last used">{die.last_used_at ? formatDateTime(die.last_used_at) : "Never"}</Row>
            </dl>
          </section>

          {/* History */}
          <section className="rounded-xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <History className="h-4 w-4" /> History
              </h2>
              <div role="tablist" aria-label="History" className="flex gap-1 rounded-lg bg-slate-100 p-0.5">
                {(
                  [
                    ["all", "All"],
                    ["usage", `Usage (${usageEvents.filter((e) => e.kind === "used").length})`],
                    ["orders", `Orders (${orders.length})`],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={historyTab === key}
                    onClick={() => setHistoryTab(key)}
                    className={cn(
                      "rounded-md px-3 py-1 text-xs font-semibold",
                      historyTab === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {historyTab === "orders" && orders.length > 0 ? (
              <ul className="divide-y divide-slate-100 border-b border-slate-100">
                {orders.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                    <span className="font-medium text-slate-800">
                      {o.manufacturer_name ?? "Manufacturer"}
                      <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                        {ORDER_STATUS_LABEL[o.status] ?? o.status}
                      </span>
                    </span>
                    <span className="text-slate-600">
                      {[
                        o.quoted_price != null ? formatDieQuotedPrice(o.quoted_price) : null,
                        o.confirmed_due_date ? `due ${formatDate(o.confirmed_due_date)}` : null,
                        o.sent_at ? `sent ${formatDate(o.sent_at.slice(0, 10))}` : null,
                      ].filter(Boolean).join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {timeline.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500">
                {historyTab === "usage"
                  ? "Nobody has used this die yet."
                  : historyTab === "orders"
                    ? "No orders for this die."
                    : "No history yet."}
              </p>
            ) : (
              <ol className="divide-y divide-slate-100">
                {timeline.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.key} className="flex items-start gap-3 px-5 py-3">
                      <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full", item.tone)}>
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800">
                          {item.title}
                          {item.who ? <span className="font-normal text-slate-500"> · {item.who}</span> : null}
                        </p>
                        {item.detail ? <p className="text-xs text-slate-500">{item.detail}</p> : null}
                      </div>
                      <time className="shrink-0 text-xs tabular-nums text-slate-500">{formatDateTime(item.at)}</time>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>

        <div className="space-y-5">
          {/* QR label */}
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="die-qr-sheet mx-auto flex w-full max-w-[18rem] flex-col items-center gap-2 rounded-lg border-2 border-slate-900 bg-white px-4 py-5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/dies/${die.id}/qr`} alt={`QR code for ${die.template_code}`} className="h-44 w-44" />
              <p className="font-mono text-lg font-bold tracking-wider text-slate-900">{die.template_code}</p>
              <p className="text-center text-sm font-semibold text-slate-800">{die.name}</p>
            </div>
            <div className="mt-3 flex items-center justify-center gap-4">
              <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 hover:underline">
                <Printer className="h-4 w-4" /> Print label
              </button>
              <a href={`/api/dies/${die.id}/qr?download=1`} className="text-sm font-semibold text-blue-700 hover:underline">
                Download PNG
              </a>
            </div>
            <p className="mt-2 text-center text-xs text-slate-500">Scanning this QR opens this page.</p>
          </section>

          {/* Details */}
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Details</p>
            <dl className="divide-y divide-slate-100">
              {die.location ? <Row label="Location">{die.location}</Row> : null}
              <Row label="Size (L × W × H)">{formatDieLwh(die)}</Row>
              <Row label="Shape">{DIE_SHAPE_LABEL[die.shape]}</Row>
              <Row label="Finishing">
                {[die.rounded_corner ? "Rounded corner" : null, die.perforation ? "Perforation" : null].filter(Boolean).join(", ") || "—"}
              </Row>
              <Row label="Order">{die.order_title ? formatShortOrderNumber(die.order_title) : "—"}</Row>
              {die.customer_name ? <Row label="Customer">{die.customer_name}</Row> : null}
              <Row label="Ordered">{formatDateTime(die.ordered_at) || "—"}</Row>
              <Row label="Pacdora">
                {die.pacdora_link ? (
                  <a href={die.pacdora_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-700 hover:underline">
                    {die.pacdora_template_name || "Open"} <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : (
                  die.pacdora_template_name || "—"
                )}
              </Row>
              <Row label="Die PDF">
                {die.has_pdf ? (
                  <a href={`/api/dies/${die.id}/file`} target="_blank" rel="noreferrer" className="inline-flex max-w-[12rem] items-center gap-1 text-blue-700 hover:underline">
                    <FileText className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{die.pdf_name ?? "PDF"}</span>
                  </a>
                ) : (
                  "—"
                )}
              </Row>
            </dl>
          </section>
        </div>
      </div>

      {notice ? (
        <p className="fixed bottom-4 right-4 z-50 max-w-md rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 shadow-lg">
          {notice}
        </p>
      ) : null}

      {reordering ? (
        <DieRequestModal
          die={die}
          manufacturers={manufacturers}
          onClose={() => setReordering(false)}
          onSent={(msg) => {
            setReordering(false);
            setNotice(msg);
            router.refresh();
          }}
        />
      ) : null}

      {editing ? (
        <DieFormModal
          die={die}
          manufacturers={manufacturers}
          onClose={() => setEditing(false)}
          onSaved={(saved, _created, result) => {
            setEditing(false);
            changed(saved);
            setError(result?.warning ? `Saved, but ${result.warning}.` : null);
          }}
          onDeleted={() => {
            setEditing(false);
            router.push("/die-order");
          }}
        />
      ) : null}
    </div>
  );
}
