"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, formatDateTime } from "@/lib/utils";
import { CustomerLinkRow } from "./customer-link-row";
import { postJsonWithTimeout } from "@/lib/fetch-with-timeout";
import { validateSmsRecipient } from "@/lib/sms";
import type { ApprovalNote, BoardColumn, Customer } from "@/lib/types";

interface ApprovalTabProps {
  notes: ApprovalNote[];
  customer: Customer | null;
  orderId: string;
  columns: BoardColumn[];
  contactEmail?: string | null;
  contactPhone?: string | null;
  onChanged: () => void;
}

function showCustomerLink(note: ApprovalNote) {
  return (
    note.channel !== "manual" &&
    (note.status === "sent" || note.status === "pending")
  );
}

function sentToLabel(note: ApprovalNote, customer: Customer | null) {
  if (note.channel === "sms") return customer?.phone ?? "SMS";
  if (note.channel === "email") return customer?.email ?? "Email";
  return "—";
}

function findColumn(columns: BoardColumn[], match: (c: BoardColumn) => boolean) {
  return columns.find(match) ?? null;
}

function NotifyRow({
  note,
  customer,
  contactEmail,
  contactPhone,
  onSent,
}: {
  note: ApprovalNote;
  customer: Customer | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  onSent: () => void;
}) {
  const [channel, setChannel] = useState<"email" | "sms" | null>(null);
  const [email, setEmail] = useState(
    contactEmail ?? customer?.email ?? ""
  );
  const [phone, setPhone] = useState(
    contactPhone ?? customer?.phone ?? ""
  );
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEmail(contactEmail ?? customer?.email ?? "");
    setPhone(contactPhone ?? customer?.phone ?? "");
  }, [contactEmail, contactPhone, customer?.email, customer?.phone]);

  async function send() {
    if (!channel) return;
    setError(null);
    if (channel === "sms") {
      const smsError = validateSmsRecipient(phone);
      if (smsError) {
        setError(smsError);
        return;
      }
    } else if (!email.trim()) {
      setError("Customer email is required.");
      return;
    }
    setSending(true);
    try {
      const { ok, data } = await postJsonWithTimeout<{ error?: string }>(
        `/api/notifications/${note.id}/send`,
        {
          channel,
          toEmail: channel === "email" ? email.trim() || undefined : undefined,
          toPhone: channel === "sms" ? phone.trim() || undefined : undefined,
        }
      );
      if (!ok) {
        setError(
          data.error ??
            (channel === "sms"
              ? "SMS failed to send. Please check Twilio config."
              : "Email failed. Check INSTANTLY_API_KEY.")
        );
        return;
      }
      onSent();
    } catch {
      setError(
        channel === "sms"
          ? "SMS failed to send. Please check Twilio config."
          : "Email failed. Check INSTANTLY_API_KEY."
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-2 border-t border-slate-100 pt-3">
      <p className="text-sm font-medium text-slate-700">Resend notification</p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => setChannel(channel === "email" ? null : "email")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium",
              channel === "email"
                ? "border-blue-500 bg-blue-50 text-blue-700"
                : "border-slate-200 text-slate-600 hover:bg-slate-50"
            )}
          >
            <Mail className="h-4 w-4" />
            Email
          </button>
          <button
            type="button"
            onClick={() => setChannel(channel === "sms" ? null : "sms")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium",
              channel === "sms"
                ? "border-blue-500 bg-blue-50 text-blue-700"
                : "border-slate-200 text-slate-600 hover:bg-slate-50"
            )}
          >
            <MessageSquare className="h-4 w-4" />
            SMS
          </button>
        </div>
        {channel ? (
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            <Input
              type={channel === "email" ? "email" : "tel"}
              value={channel === "email" ? email : phone}
              onChange={(e) =>
                channel === "email"
                  ? setEmail(e.target.value)
                  : setPhone(e.target.value)
              }
              placeholder={
                channel === "email"
                  ? "customer@example.com"
                  : "+1 555 123 4567"
              }
              className="h-9 min-w-0 flex-1 sm:max-w-xs"
            />
            <Button
              type="button"
              size="sm"
              disabled={sending}
              onClick={send}
              className="shrink-0"
            >
              {sending ? "Sending…" : "Resend"}
            </Button>
          </div>
        ) : null}
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

function MoveButton({
  orderId,
  columnId,
  label,
  onMoved,
}: {
  orderId: string;
  columnId: string;
  label: string;
  onMoved: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function move() {
    setLoading(true);
    const res = await fetch("/api/orders/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId,
        toColumnId: columnId,
        position: Date.now(),
      }),
    });
    setLoading(false);
    if (res.ok) {
      onMoved();
      router.refresh();
    }
  }

  return (
    <Button type="button" size="sm" disabled={loading} onClick={move}>
      {loading ? "Moving…" : label}
    </Button>
  );
}

export function ApprovalTab({
  notes,
  customer,
  orderId,
  columns,
  contactEmail,
  contactPhone,
  onChanged,
}: ApprovalTabProps) {
  const [manualLoading, setManualLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (notes.length === 0) {
    return (
      <p className="text-sm text-slate-400">No approval requests yet.</p>
    );
  }

  const latest = notes[0];
  const history = [...notes].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  const productionColumn = findColumn(columns, (c) => c.kind === "done");
  const returningColumn = findColumn(
    columns,
    (c) => c.kind === "exception" && c.name.toLowerCase().includes("returning")
  );

  async function markManualApproved() {
    setError(null);
    setManualLoading(true);
    try {
      const res = await fetch(
        `/api/notifications/${latest.id}/manual-approve`,
        { method: "POST" }
      );
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to mark as approved");
        return;
      }
      onChanged();
    } finally {
      setManualLoading(false);
    }
  }

  function renderLatestActions() {
    if (latest.status === "responded" && latest.customer_response === "approved") {
      return productionColumn ? (
        <MoveButton
          orderId={orderId}
          columnId={productionColumn.id}
          label="Move to production →"
          onMoved={onChanged}
        />
      ) : null;
    }

    if (
      latest.status === "responded" &&
      latest.customer_response === "changes_requested"
    ) {
      return returningColumn ? (
        <MoveButton
          orderId={orderId}
          columnId={returningColumn.id}
          label="Move to Returning Tickets"
          onMoved={onChanged}
        />
      ) : null;
    }

    if (
      latest.channel === "manual" &&
      latest.status !== "responded"
    ) {
      return (
        <div className="space-y-2">
          <p className="text-sm text-slate-600">
            No notification sent. Contact customer directly.
          </p>
          <Button
            type="button"
            size="sm"
            disabled={manualLoading}
            onClick={markManualApproved}
          >
            {manualLoading ? "Saving…" : "Mark as approved manually"}
          </Button>
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
        </div>
      );
    }

    if (
      (latest.status === "sent" || latest.status === "pending") &&
      latest.channel !== "manual"
    ) {
      return (
        <NotifyRow
          note={latest}
          customer={customer}
          contactEmail={contactEmail}
          contactPhone={contactPhone}
          onSent={onChanged}
        />
      );
    }

    return null;
  }

  function entryStatus(note: ApprovalNote) {
    if (note.status === "responded") {
      if (note.customer_response === "approved") {
        return {
          label: "✅ Approved",
          className: "text-emerald-600",
          time: note.responded_at,
        };
      }
      return {
        label: "❌ Rejected",
        className: "text-red-600",
        time: note.responded_at,
      };
    }
    if (note.channel === "manual") {
      return {
        label: "👤 Manual follow-up",
        className: "text-slate-600",
        time: null,
      };
    }
    if (note.status === "sent" || note.status === "pending") {
      return {
        label: "⏳ Waiting for approval",
        className: "text-amber-600",
        time: note.created_at,
      };
    }
    return {
      label: note.status,
      className: "text-slate-500",
      time: null,
    };
  }

  const latestStatus = entryStatus(latest);

  return (
    <div className="space-y-5">
      <div className="text-sm">
        <span className="font-medium text-slate-700">Status: </span>
        <span className={latestStatus.className}>{latestStatus.label}</span>
        {latestStatus.time ? (
          <span className="text-slate-500">
            {" "}
            — {formatDateTime(latestStatus.time)}
          </span>
        ) : null}
      </div>

      {(latest.status === "sent" || latest.status === "pending") &&
      latest.channel !== "manual" ? (
        <div className="text-sm text-slate-600">
          <p>
            <span className="font-medium text-slate-700">Sent: </span>
            {formatDateTime(latest.created_at)} via{" "}
            {latest.channel === "sms" ? "SMS" : "Email"}
          </p>
          <p className="mt-1">
            <span className="font-medium text-slate-700">To: </span>
            {sentToLabel(latest, customer)}
          </p>
          {showCustomerLink(latest) ? (
            <div className="mt-3">
              <CustomerLinkRow token={latest.token} />
            </div>
          ) : null}
        </div>
      ) : null}

      {latest.status === "responded" &&
      latest.customer_response === "changes_requested" &&
      latest.customer_note ? (
        <div>
          <p className="text-sm font-medium text-slate-700">Customer note:</p>
          <blockquote className="mt-1 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
            &ldquo;{latest.customer_note}&rdquo;
          </blockquote>
        </div>
      ) : null}

      {latest.staff_note &&
      latest.status !== "responded" &&
      latest.channel !== "manual" ? (
        <div>
          <p className="text-sm font-medium text-slate-700">Note to customer:</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">
            {latest.staff_note}
          </p>
        </div>
      ) : null}

      {renderLatestActions()}

      {history.length > 1 ? (
        <div>
          <p className="mb-3 text-sm font-semibold text-slate-700">
            Communication history
          </p>
          <div className="space-y-3">
            {history.map((note) => {
              const status = entryStatus(note);
              return (
                <div
                  key={note.id}
                  className="rounded-lg border border-slate-200 p-4 text-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="text-xs text-slate-500">
                      {formatDateTime(note.created_at)}
                      {note.creator_name ? ` · ${note.creator_name}` : ""}
                    </p>
                    <span className={cn("font-medium", status.className)}>
                      {status.label}
                    </span>
                  </div>
                  {note.staff_note ? (
                    <p className="mt-2 text-slate-600">{note.staff_note}</p>
                  ) : null}
                  {note.customer_note ? (
                    <p className="mt-2 text-slate-600">
                      &ldquo;{note.customer_note}&rdquo;
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
