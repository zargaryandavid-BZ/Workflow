"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { RequiredDatePicker } from "@/components/die/required-date-picker";
import {
  dieDaysToDeliver,
  formatDieDaysToDeliver,
  formatDieQuotedPrice,
} from "@/lib/die-request";
import { formatDate } from "@/lib/utils";

export type DiePortalData = {
  token: string;
  status: string;
  orderTitle: string;
  tenantName: string;
  width: number | null;
  height: number | null;
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
  const [done, setDone] = useState(data.status === "ordered");

  const size =
    data.width != null && data.height != null
      ? `${data.width} × ${data.height}`
      : "—";
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
    if (!/^\d{1,5}(\.\d{1,2})?$/.test(price.trim()) || Number(price) < 0) {
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

      <dl className="grid grid-cols-3 gap-2">
        <div className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white px-3 py-2">
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-black">
            Size (X × Y)
          </dt>
          <dd className="mt-0.5 break-words text-sm font-medium text-black">
            {size}
          </dd>
        </div>
        <div className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white px-3 py-2">
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-black">
            Required date
          </dt>
          <dd className="mt-0.5 break-words text-sm font-medium text-black">
            {formatDate(data.requiredDate) ?? data.requiredDate}
          </dd>
          <dd className="mt-0.5 text-[11px] text-black">Fixed</dd>
        </div>
        <div className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white px-3 py-2">
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-black">
            Days to deliver
          </dt>
          <dd className="mt-0.5 text-sm font-medium tabular-nums text-black">
            {daysSpan.calendar === 0
              ? "Today"
              : `${Math.abs(daysSpan.working)}/${Math.abs(daysSpan.calendar)}`}
          </dd>
          {daysSpan.calendar !== 0 ? (
            <dd className="mt-0.5 break-words text-[11px] leading-tight text-black">
              {daysSpan.calendar < 0
                ? "working / calendar · overdue"
                : "working / calendar"}
            </dd>
          ) : null}
        </div>
      </dl>

      <div className={data.allowOwnDate ? "grid grid-cols-2 gap-2" : ""}>
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-3">
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
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-3">
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
      </div>

      <div className="mx-auto w-[10.5rem] text-center">
        <Label htmlFor="die-price">Price</Label>
        <div className="relative mt-1.5">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-2xl font-semibold text-slate-400">
            $
          </span>
          <Input
            id="die-price"
            className="h-14 pl-8 pr-2 text-center text-2xl font-semibold tabular-nums"
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
  const files = data.files ?? [];
  const size =
    data.width != null && data.height != null
      ? `${data.width} × ${data.height}`
      : "—";
  const due =
    data.confirmedDueDate ?? data.requiredDate;
  const timeLines = splitDieTimeEstimate(data.timeEstimate);

  return (
    <>
      {files.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Files
          </p>
          <div className="flex flex-wrap gap-2">
            {files.map((file) =>
              file.isImage ? (
                <a
                  key={file.index}
                  href={`/api/die/${data.token}/file?i=${file.index}&preview=1`}
                  target="_blank"
                  rel="noreferrer"
                  className="block"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/die/${data.token}/file?i=${file.index}&preview=1`}
                    alt={file.name}
                    className="h-20 w-20 rounded-md border border-slate-200 object-cover"
                  />
                </a>
              ) : (
                <a
                  key={file.index}
                  href={`/api/die/${data.token}/file?i=${file.index}`}
                  className="block truncate text-sm font-medium text-blue-600 underline"
                >
                  {file.name}
                </a>
              )
            )}
          </div>
        </div>
      ) : data.fileName ? (
        <a
          href={`/api/die/${data.token}/file`}
          className="block truncate text-sm font-medium text-blue-600 underline"
        >
          Download file: {data.fileName}
        </a>
      ) : null}

      {data.comment ? (
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-black">
            Comment
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm font-medium text-black">
            {data.comment}
          </p>
        </div>
      ) : null}

      {quoteMode ? null : (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white px-3 py-2">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-black">
              Size (X × Y)
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
