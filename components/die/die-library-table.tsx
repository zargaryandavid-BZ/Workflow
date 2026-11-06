"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ExternalLink, FileText, Pencil, Printer, RotateCcw } from "lucide-react";
import { DieStatusSelect } from "@/components/die/die-status-select";
import { DieUseButton } from "@/components/die/die-use-button";
import { Modal } from "@/components/ui/modal";
import { formatShortOrderNumber } from "@/lib/board-order-filters";
import {
  DIE_SHAPE_LABEL,
  DIE_TYPE_LABEL,
  dieQrPath,
  dieUsageLevel,
  formatDieLwh,
  formatDieUses,
  type Die,
  type DieShopStatus,
} from "@/lib/dies";
import { cn, formatDate, formatDateTime } from "@/lib/utils";

const TYPE_CLASS: Record<Die["die_type"], string> = {
  label: "bg-violet-50 text-violet-700",
  paper: "bg-amber-50 text-amber-700",
  box: "bg-sky-50 text-sky-700",
  other: "bg-slate-100 text-slate-600",
};

const USAGE_CLASS = {
  none: "text-slate-700",
  ok: "text-slate-700",
  near: "font-semibold text-amber-700",
  over: "font-semibold text-red-700",
} as const;

export function DieLibraryTable({
  dies,
  onEdit,
  onReorder,
  onUpdated,
}: {
  dies: Die[];
  onEdit: (die: Die) => void;
  /** Opens the Reorder popup (manufacturer, date, then "Yes, send reorder"). */
  onReorder: (die: Die) => void;
  onUpdated: (die: Die) => void;
}) {
  const [rows, setRows] = useState(dies);
  const [openDie, setOpenDie] = useState<Die | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const th = "whitespace-nowrap px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500";
  const td = "whitespace-nowrap px-3 py-2.5 align-middle";

  useEffect(() => {
    setRows(dies);
  }, [dies]);

  function apply(die: Die) {
    setRows((prev) => prev.map((row) => (row.id === die.id ? die : row)));
    setOpenDie((current) => (current?.id === die.id ? die : current));
    onUpdated(die);
  }

  async function save(
    die: Die,
    body: { shop_status?: DieShopStatus; reorder?: boolean }
  ) {
    setError(null);
    setBusyId(die.id);
    try {
      const res = await fetch(`/api/dies/${die.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; die?: Die };
      if (!res.ok || !json.die) throw new Error(json.error ?? "Could not save the die");
      apply(json.die);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the die");
    } finally {
      setBusyId(null);
    }
  }

  const shown = openDie ? rows.find((row) => row.id === openDie.id) ?? openDie : null;
  // No data in any row → no column.
  const hasOrder = rows.some((d) => d.order_title);
  const hasCustomer = rows.some((d) => d.customer_name);
  const hasManufacturer = rows.some((d) => d.manufacturer_name);
  const hasLocation = rows.some((d) => d.location);
  const hasFiles = rows.some((d) => d.pacdora_link || d.pacdora_template_name || d.has_pdf);
  const hasSize = rows.some((d) => formatDieLwh(d) !== "—");

  return (
    <>
      {error ? (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {/* 9 columns that fit the screen; less-used ones hide on narrow screens. */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full table-auto text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className={th}>Die</th>
              <th className={th}>Status</th>
              {hasCustomer ? <th className={cn(th, "hidden md:table-cell")}>Customer</th> : null}
              {hasManufacturer ? <th className={cn(th, "hidden lg:table-cell")}>Manufacturer</th> : null}
              {hasLocation ? <th className={cn(th, "hidden md:table-cell")}>Location</th> : null}
              {hasOrder ? <th className={cn(th, "hidden md:table-cell")}>Order</th> : null}
              <th className={cn(th, "hidden sm:table-cell")}>{hasSize ? "Size & shape" : "Shape"}</th>
              {hasFiles ? <th className={cn(th, "hidden lg:table-cell")}>Files</th> : null}
              <th className={cn(th, "hidden xl:table-cell")}>Ordered</th>
              <th className={th}>Uses</th>
              <th className={cn(th, "hidden lg:table-cell")}>Last used / with</th>
              <th className={cn(th, "text-right")}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((die) => {
              const finishing = [
                die.rounded_corner ? "Rounded corner" : null,
                die.perforation ? "Perforation" : null,
              ].filter(Boolean);
              return (
                <tr
                  key={die.id}
                  className="cursor-pointer hover:bg-slate-50/60"
                  onClick={(e) => {
                    const target = e.target as HTMLElement;
                    if (target.closest("a, button, select, input, label")) return;
                    setOpenDie(die);
                  }}
                >
                  <td className={cn(td, "max-w-0 w-[34%] whitespace-normal")}>
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 font-mono text-[11px] font-semibold text-slate-500">
                        {die.template_code}
                      </span>
                      <span className={cn("shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold", TYPE_CLASS[die.die_type])}>
                        {DIE_TYPE_LABEL[die.die_type]}
                      </span>
                    </div>
                    <Link
                      href={dieQrPath(die.template_code)}
                      title={die.name}
                      className="block truncate font-semibold text-slate-800 hover:text-blue-700 hover:underline"
                    >
                      {die.name}
                    </Link>
                  </td>
                  <td className={td}>
                    <DieStatusSelect
                      value={die.shop_status}
                      disabled={busyId === die.id}
                      onChange={(shop_status) => save(die, { shop_status })}
                    />
                  </td>
                  {hasCustomer ? (
                    <td className={cn(td, "hidden max-w-[12rem] truncate text-slate-700 md:table-cell")} title={die.customer_name ?? undefined}>
                      {die.customer_name}
                    </td>
                  ) : null}
                  {hasManufacturer ? (
                    <td className={cn(td, "hidden max-w-[12rem] truncate text-slate-700 lg:table-cell")} title={die.manufacturer_name ?? undefined}>
                      {die.manufacturer_name}
                    </td>
                  ) : null}
                  {hasLocation ? (
                    <td className={cn(td, "hidden max-w-[10rem] truncate font-medium text-slate-800 md:table-cell")} title={die.location ?? undefined}>
                      {die.location}
                    </td>
                  ) : null}
                  {hasOrder ? (
                    <td className={cn(td, "hidden tabular-nums text-slate-700 md:table-cell")}>
                      {die.order_title ? formatShortOrderNumber(die.order_title) : null}
                    </td>
                  ) : null}
                  <td className={cn(td, "hidden sm:table-cell")}>
                    {formatDieLwh(die) !== "—" ? (
                      <span className="block tabular-nums text-slate-800">
                        {[die.length, die.width, die.height].filter((v) => v != null).join(" × ")}
                      </span>
                    ) : null}
                    <span className="block text-xs text-slate-500">
                      {[DIE_SHAPE_LABEL[die.shape], ...finishing].join(" · ")}
                    </span>
                  </td>
                  {hasFiles ? (
                  <td className={cn(td, "hidden lg:table-cell")}>
                    <div className="flex items-center gap-2">
                      {die.pacdora_link ? (
                        <a
                          href={die.pacdora_link}
                          target="_blank"
                          rel="noreferrer"
                          title={die.pacdora_template_name ? `Pacdora: ${die.pacdora_template_name}` : "Pacdora"}
                          className="inline-flex max-w-[8rem] items-center gap-1 text-xs text-blue-700 hover:underline"
                        >
                          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{die.pacdora_template_name || "Pacdora"}</span>
                        </a>
                      ) : die.pacdora_template_name ? (
                        <span className="max-w-[8rem] truncate text-xs text-slate-600" title={die.pacdora_template_name}>
                          {die.pacdora_template_name}
                        </span>
                      ) : null}
                      {die.has_pdf ? (
                        <a
                          href={`/api/dies/${die.id}/file`}
                          target="_blank"
                          rel="noreferrer"
                          title={die.pdf_name ?? "Die PDF"}
                          className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline"
                        >
                          <FileText className="h-3.5 w-3.5 shrink-0" />
                          PDF
                        </a>
                      ) : null}
                    </div>
                  </td>
                  ) : null}
                  <td className={cn(td, "hidden text-xs text-slate-700 xl:table-cell")}>
                    {die.ordered_at ? formatDate(die.ordered_at.slice(0, 10)) : null}
                  </td>
                  <td className={cn(td, "tabular-nums", USAGE_CLASS[dieUsageLevel(die)])}>
                    {formatDieUses(die)}
                  </td>
                  <td className={cn(td, "hidden text-xs text-slate-700 lg:table-cell")}>
                    {die.checked_out_at ? (
                      <span className="font-semibold text-amber-800">
                        With {die.checked_out_by_name || "someone"}
                      </span>
                    ) : die.last_used_at ? (
                      formatDateTime(die.last_used_at)
                    ) : null}
                  </td>
                  <td className={cn(td, "text-right")}>
                    <div className="inline-flex items-center gap-1">
                      <DieUseButton die={die} onChanged={apply} />
                      <button
                        type="button"
                        disabled={busyId === die.id}
                        onClick={() => onReorder(die)}
                        title="Reorder"
                        aria-label={`Reorder ${die.name}`}
                        className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-60"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onEdit(die)}
                        title="Edit"
                        className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        aria-label={`Edit ${die.name}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {shown ? (
        <Modal
          open
          onClose={() => setOpenDie(null)}
          title={`${shown.name} · ${shown.template_code}`}
          className="max-w-md"
        >
          <style>{`
            @media print {
              body * { visibility: hidden !important; }
              .die-qr-sheet, .die-qr-sheet * { visibility: visible !important; }
              .die-qr-sheet {
                position: fixed !important;
                inset: 0 auto auto 0 !important;
                margin: 0 !important;
                box-shadow: none !important;
              }
            }
          `}</style>
          <div className="space-y-4 py-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-slate-600">
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", TYPE_CLASS[shown.die_type])}>
                  {DIE_TYPE_LABEL[shown.die_type]}
                </span>
                <span className="ml-2 tabular-nums">{formatDieLwh(shown)}</span>
              </div>
              <DieStatusSelect
                value={shown.shop_status}
                disabled={busyId === shown.id}
                onChange={(shop_status) => save(shown, { shop_status })}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-700">
              <p>
                Ordered{" "}
                <span className="font-semibold">{formatDateTime(shown.ordered_at) || "—"}</span>
              </p>
              <button
                type="button"
                disabled={busyId === shown.id}
                onClick={() => save(shown, { reorder: true })}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reorder
              </button>
            </div>
            <div className="die-qr-sheet mx-auto flex w-80 flex-col items-center gap-2 rounded-lg border-2 border-slate-900 bg-white px-4 py-5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/dies/${shown.id}/qr`}
                alt={`QR code for ${shown.template_code}`}
                className="h-48 w-48"
              />
              <p className="font-mono text-lg font-bold tracking-wider text-slate-900">
                {shown.template_code}
              </p>
              <p className="text-center text-sm font-semibold text-slate-800">{shown.name}</p>
              <dl
                className={cn(
                  "mt-2 grid w-full divide-x divide-slate-200 border-t border-slate-200 pt-3 text-center",
                  shown.order_title && formatDieLwh(shown) !== "—"
                    ? "grid-cols-3"
                    : shown.order_title || formatDieLwh(shown) !== "—"
                      ? "grid-cols-2"
                      : "grid-cols-1"
                )}
              >
                {shown.order_title ? (
                  <div className="min-w-0 px-1">
                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Order
                    </dt>
                    <dd className="mt-0.5 truncate text-xs font-semibold text-slate-900">
                      {formatShortOrderNumber(shown.order_title)}
                    </dd>
                  </div>
                ) : null}
                {formatDieLwh(shown) !== "—" ? (
                  <div className="min-w-0 px-1">
                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Size
                    </dt>
                    <dd className="mt-0.5 truncate text-xs font-semibold text-slate-900">
                      {formatDieLwh(shown)}
                    </dd>
                  </div>
                ) : null}
                <div className="min-w-0 px-1">
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Shape
                  </dt>
                  <dd className="mt-0.5 truncate text-xs font-semibold text-slate-900">
                    {DIE_SHAPE_LABEL[shown.shape]}
                  </dd>
                </div>
              </dl>
            </div>
            <div className="flex items-center justify-center gap-4">
              <Link
                href={dieQrPath(shown.template_code)}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 hover:underline"
              >
                Open die page
                <ArrowRight className="h-4 w-4" />
              </Link>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 hover:underline"
              >
                <Printer className="h-4 w-4" />
                Print
              </button>
              <a
                href={`/api/dies/${shown.id}/qr?download=1`}
                className="text-sm font-semibold text-blue-700 hover:underline"
              >
                Download PNG
              </a>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
