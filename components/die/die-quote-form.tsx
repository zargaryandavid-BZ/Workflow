"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { RequiredDatePicker } from "@/components/die/required-date-picker";
import {
  DIE_PAST_DATE_ERROR,
  dieTodayYmd,
  isDieDatePast,
  dieDaysToDeliver,
  formatDieDaysToDeliver,
  formatDieQuotedPrice,
  formatDieSize,
} from "@/lib/die-request";
import { DIE_SHAPE_LABEL, DIE_TYPE_LABEL } from "@/lib/dies";
import { formatDate } from "@/lib/utils";

export type DiePortalData = {
  token: string;
  status: string;
  orderTitle: string;
  tenantName: string;
  width: number | null;
  height: number | null;
  depth: number | null;
  productName: string | null;
  dieName: string | null;
  dieType: string | null;
  templateCode: string | null;
  shape: string | null;
  roundedCorner: boolean | null;
  perforation: boolean | null;
  pacdoraTemplateName: string | null;
  pacdoraLink: string | null;
  requiredDate: string;
  fileName: string | null;
  files: { name: string; index: number; isImage: boolean }[];
  quotedPrice: number | null;
  timeEstimate: string | null;
  confirmedDueDate: string | null;
  clientNote: string | null;
  comment: string | null;
  allowOwnDate: boolean;
};

export function DieQuoteForm({ data }: { data: DiePortalData }) {
  const [price, setPrice] = useState(
    data.quotedPrice != null ? String(data.quotedPrice) : ""
  );
  const [confirmedDueDate, setConfirmedDueDate] = useState(
    data.confirmedDueDate ?? data.requiredDate
  );
  const [offerOwnDate, setOfferOwnDate] = useState(
    Boolean(
      data.allowOwnDate &&
        data.confirmedDueDate &&
        data.confirmedDueDate !== data.requiredDate
    )
  );
  const [note, setNote] = useState(data.clientNote?.trim() ?? "");
  const [noteLocked, setNoteLocked] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(
    data.status === "ordered" || data.status === "received"
  );

  const matchingRequired = !offerOwnDate;
  const daysTarget = matchingRequired
    ? data.requiredDate
    : confirmedDueDate || data.requiredDate;
  const daysSpan = useMemo(
    () => dieDaysToDeliver(daysTarget),
    [daysTarget]
  );
  const daysLabel = formatDieDaysToDeliver(daysSpan);

  function confirmRequiredDate() {
    setOfferOwnDate(false);
    setConfirmedDueDate(data.requiredDate);
  }

  function offerNewDate() {
    if (!data.allowOwnDate) return;
    setOfferOwnDate(true);
  }

  async function submit() {
    setError(null);
    if (!matchingRequired && !confirmedDueDate) {
      setError("Confirm due date is required.");
      return;
    }
    const dueToSend = matchingRequired ? data.requiredDate : confirmedDueDate;
    if (dueToSend && isDieDatePast(dueToSend)) {
      setError(
        matchingRequired
          ? "The requested date has already passed. Please contact the shop for a new date."
          : `That due date is in the past. ${DIE_PAST_DATE_ERROR}`
      );
      return;
    }
    const priceNum = parseFloat(price);
    if (!price.trim() || Number.isNaN(priceNum) || priceNum <= 0) {
      setError("Please enter a price greater than 0.");
      return;
    }
    if (!/^\d{1,5}(\.\d{1,2})?$/.test(price.trim()) || priceNum > 99_999.99) {
      setError("Enter a price up to 5 digits.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/die/${data.token}/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          price,
          timeEstimate: daysLabel,
          confirmedDueDate:
            data.allowOwnDate && !matchingRequired
              ? confirmedDueDate
              : data.requiredDate,
          note: note.trim(),
          clientNote: note.trim(),
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Could not submit");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit");
    } finally {
      setLoading(false);
    }
  }

  if (data.status === "received") {
    return (
      <div className="space-y-5">
        <div className="rounded-lg bg-emerald-50 p-5 text-center text-emerald-900">
          <h2 className="text-lg font-semibold">Die received</h2>
          <p className="mt-2 text-sm">
            We received the die for {data.orderTitle}. Thank you.
          </p>
        </div>
        <DiePortalJobDetails data={data} />
      </div>
    );
  }

  if (data.status === "ordered") {
    return (
      <div className="space-y-5">
        <div className="rounded-lg bg-emerald-50 p-5 text-center text-emerald-900">
          <h2 className="text-lg font-semibold">Order confirmed</h2>
          <p className="mt-2 text-sm">
            Please manufacture this die for {data.orderTitle}.
          </p>
        </div>
        <DiePortalJobDetails data={data} />
      </div>
    );
  }

  if (done) {
    return (
      <div className="rounded-lg bg-emerald-50 p-5 text-center text-emerald-900">
        <h2 className="text-lg font-semibold">
          {data.status === "ordered" ? "Order confirmed" : "Quote received"}
        </h2>
        <p className="mt-2 text-sm">
          {data.status === "ordered"
            ? "This die has been ordered. Thank you."
            : "Thank you. The team has your price, time estimate, and confirmed due date."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-600">
        Please quote this die and confirm when it will be ready.
      </p>

      <DiePortalJobDetails data={data} quoteMode />

      <div
        className={`grid items-stretch gap-2 ${
          data.allowOwnDate ? "grid-cols-3" : "grid-cols-2"
        }`}
      >
        <label className="flex h-full cursor-pointer items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-3">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600"
            checked={matchingRequired}
            onChange={() => confirmRequiredDate()}
          />
          <span>
            <span className="block text-sm font-medium text-slate-800">
              Confirm due date
            </span>
            <span className="mt-0.5 block text-xs text-slate-500">
              {formatDate(data.requiredDate) ?? data.requiredDate}
            </span>
          </span>
        </label>
        {data.allowOwnDate ? (
        <label className="flex h-full cursor-pointer items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-3">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600"
            checked={offerOwnDate}
            onChange={() => offerNewDate()}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-slate-800">
              Offer new date
            </span>
            {offerOwnDate ? (
              <div className="mt-1">
                <RequiredDatePicker
                  minDate={dieTodayYmd()}
                  id="die-confirm"
                  value={confirmedDueDate}
                  dueDate={data.requiredDate}
                  dueLabel="Requested"
                  selectedLabel="Your offer"
                  onChange={setConfirmedDueDate}
                />
              </div>
            ) : (
              <span className="mt-0.5 block text-xs text-slate-400">
                Pick a different date
              </span>
            )}
          </span>
        </label>
        ) : null}
        <div className="h-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-center">
          <Label htmlFor="die-price">Price</Label>
          <div className="relative mt-1">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xl font-semibold text-slate-400">
              $
            </span>
            <Input
              id="die-price"
              className="h-10 pl-8 pr-2 text-center text-xl font-semibold tabular-nums"
              type="text"
              inputMode="decimal"
              maxLength={8}
              value={price}
              onChange={(e) => {
                const next = e.target.value.trim().replace(/^\$/, "");
                if (next === "") {
                  setPrice("");
                  return;
                }
                if (!/^\d{0,5}(\.\d{0,2})?$/.test(next)) return;
                setPrice(next);
              }}
              placeholder="0.00"
            />
          </div>
        </div>
      </div>

      <div>
        <Label htmlFor="die-manufacturer-reply">Note (optional)</Label>
        <Textarea
          id="die-manufacturer-reply"
          name="die_manufacturer_reply_note"
          className="mt-1.5 min-h-[4.5rem]"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore="true"
          data-lpignore="true"
          data-form-type="other"
          readOnly={noteLocked}
          value={note}
          onFocus={() => setNoteLocked(false)}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note to the shop"
        />
      </div>

      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}
      <Button
        type="button"
        className="w-full"
        disabled={loading}
        onClick={() => void submit()}
      >
        {loading
          ? "Sending…"
          : data.status === "quoted"
            ? "Update quote"
            : "Send quote"}
      </Button>
    </div>
  );
}

function DiePortalJobDetails({
  data,
  quoteMode = false,
}: {
  data: DiePortalData;
  quoteMode?: boolean;
}) {
  const size = formatDieSize(data.width, data.height, data.depth);
  const due =
    data.confirmedDueDate ?? data.requiredDate;
  const timeLines = splitDieTimeEstimate(data.timeEstimate);

  return (
    <>
      <DieRequestDetailsTable data={data} />

      {quoteMode ? null : (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white px-3 py-2">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-black">
              Size (X × Y × Z)
            </dt>
            <dd className="mt-0.5 break-words text-sm font-medium text-black">
              {size}
            </dd>
          </div>
          <div className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white px-3 py-2">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-black">
              Confirmed due
            </dt>
            <dd className="mt-0.5 break-words text-sm font-medium text-black">
              {formatDate(due) ?? due}
            </dd>
          </div>
          <div className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white px-3 py-2">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-black">
              Price
            </dt>
            <dd className="mt-0.5 break-words text-sm font-medium text-black">
              {formatDieQuotedPrice(data.quotedPrice)}
            </dd>
          </div>
          <div className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white px-3 py-2">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-black">
              Time
            </dt>
            <dd className="mt-0.5 text-sm font-medium tabular-nums text-black">
              {timeLines.main}
            </dd>
            {timeLines.sub ? (
              <dd className="mt-0.5 break-words text-[11px] leading-tight text-black">
                {timeLines.sub}
              </dd>
            ) : null}
          </div>
        </dl>
      )}
    </>
  );
}

function DieRequestDetailsTable({ data }: { data: DiePortalData }) {
  const dieType =
    data.dieType && data.dieType in DIE_TYPE_LABEL
      ? DIE_TYPE_LABEL[data.dieType as keyof typeof DIE_TYPE_LABEL]
      : data.dieType || "—";
  const shape =
    data.shape && data.shape in DIE_SHAPE_LABEL
      ? DIE_SHAPE_LABEL[data.shape as keyof typeof DIE_SHAPE_LABEL]
      : data.shape || "—";
  const files = data.files ?? [];
  const requestedDays = dieDaysToDeliver(data.requiredDate);
  const requestedDaysLabel =
    requestedDays.calendar === 0
      ? "Today"
      : `${Math.abs(requestedDays.working)}/${Math.abs(
          requestedDays.calendar
        )} working/calendar${
          requestedDays.calendar < 0 ? " · overdue" : ""
        }`;
  const repeatedDieName =
    data.dieName?.trim().toLowerCase() ===
    data.productName?.trim().toLowerCase();
  const rows: Array<{ label: string; value: React.ReactNode }> = [
    { label: "Product", value: data.productName || "—" },
    ...(repeatedDieName
      ? []
      : [{ label: "Die name", value: data.dieName || "—" }]),
    { label: "Template ID", value: data.templateCode || "—" },
    { label: "Die type", value: dieType },
    {
      label: "Size (X × Y × Z)",
      value: formatDieSize(data.width, data.height, data.depth),
    },
    { label: "Shape", value: shape },
    {
      label: "Rounded corner",
      value: data.roundedCorner == null ? "—" : data.roundedCorner ? "Yes" : "No",
    },
    {
      label: "Perforation",
      value: data.perforation == null ? "—" : data.perforation ? "Yes" : "No",
    },
    {
      label: "Pacdora template",
      value: data.pacdoraTemplateName || "—",
    },
    {
      label: "Pacdora link",
      value: data.pacdoraLink ? (
        <a
          href={data.pacdoraLink}
          target="_blank"
          rel="noreferrer"
          className="text-blue-700 underline underline-offset-2"
        >
          Open template
        </a>
      ) : (
        "—"
      ),
    },
    {
      label: "Required date",
      value: formatDate(data.requiredDate) ?? data.requiredDate,
    },
    { label: "Days to deliver", value: requestedDaysLabel },
    {
      label: "Manufacturer may offer new date",
      value: data.allowOwnDate ? "Yes" : "No",
    },
    {
      label: "Comment",
      value: data.comment ? (
        <span className="whitespace-pre-wrap">{data.comment}</span>
      ) : (
        "—"
      ),
    },
    {
      label: "PDF / files",
      value:
        files.length > 0 ? (
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            {files.map((file) => (
              <a
                key={file.index}
                href={`/api/die/${data.token}/file?i=${file.index}`}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-blue-700 underline underline-offset-2"
              >
                {file.name}
              </a>
            ))}
          </span>
        ) : (
          "—"
        ),
    },
  ];
  // Only real information: no empty cells, "—" or "No".
  const shown = rows.filter(
    (row) => row.value != null && row.value !== "" && row.value !== "—" && row.value !== "No"
  );
  const tableRows = Array.from(
    { length: Math.ceil(shown.length / 3) },
    (_, index) => shown.slice(index * 3, index * 3 + 3)
  );

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <table className="w-full table-fixed text-sm">
        <caption className="border-b border-slate-200 bg-slate-100 px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-slate-700">
          Requested die information
        </caption>
        <tbody className="divide-y divide-slate-100">
          {tableRows.map((tableRow, rowIndex) => (
            <tr key={rowIndex}>
              {tableRow.map((row, columnIndex) => {
                // A short last row stretches its last cell: no empty boxes.
                const span =
                  columnIndex === tableRow.length - 1 ? 3 - tableRow.length + 1 : 1;
                return (
                  <td
                    key={row.label}
                    colSpan={span}
                    className="border-r border-slate-100 px-3 py-2.5 align-top last:border-r-0"
                  >
                    {row ? (
                      <>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          {row.label}
                        </p>
                        <div className="mt-1 break-words font-medium text-slate-900">
                          {row.value}
                        </div>
                      </>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function splitDieTimeEstimate(value: string | null): {
  main: string;
  sub: string | null;
} {
  const raw = value?.trim() || "—";
  const match = /^(\d+\/\d+)\s+(working\s*\/\s*calendar)(.*)$/i.exec(raw);
  if (match) {
    const extra = match[3]?.trim() ?? "";
    return {
      main: match[1],
      sub: extra ? `working / calendar ${extra}` : "working / calendar",
    };
  }
  const overdue = /^(\d+\/\d+)\s+(overdue)$/i.exec(raw);
  if (overdue) return { main: overdue[1], sub: "overdue" };
  return { main: raw, sub: null };
}
