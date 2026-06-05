"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Mail, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, formatDateTime } from "@/lib/utils";
import { formatFileSize as formatBytes } from "@/lib/notification-messages";
import { CustomerLinkRow } from "./customer-link-row";
import { postJsonWithTimeout } from "@/lib/fetch-with-timeout";
import { validateSmsRecipient } from "@/lib/sms";
import type { Asset, BoardColumn, Customer, MissingInfoNote } from "@/lib/types";

interface MissingInfoTabProps {
  notes: MissingInfoNote[];
  customer: Customer | null;
  orderId: string;
  columns: BoardColumn[];
  contactEmail?: string | null;
  contactPhone?: string | null;
  onSent: () => void;
}

function showCustomerLink(note: MissingInfoNote) {
  return (
    (note.channel === "email" || note.channel === "sms") &&
    note.status === "sent"
  );
}

function sentToLabel(note: MissingInfoNote, customer: Customer | null) {
  if (note.channel === "sms") return customer?.phone ?? "SMS";
  if (note.channel === "email") return customer?.email ?? "Email";
  return "—";
}

function statusSummary(note: MissingInfoNote) {
  if (note.status === "responded") {
    return {
      label: "✓ Client replied",
      className: "text-emerald-600",
    };
  }
  if (note.channel === "manual") {
    return {
      label: "👤 Manual follow-up",
      className: "text-slate-600",
    };
  }
  if (note.status === "sent") {
    return {
      label: "⏳ Waiting for reply",
      className: "text-amber-600",
    };
  }
  if (note.status === "expired") {
    return {
      label: "Link expired",
      className: "text-slate-500",
    };
  }
  return {
    label: "Not sent yet",
    className: "text-slate-500",
  };
}

function AttachmentList({ assets }: { assets: Asset[] }) {
  if (assets.length === 0) return null;

  return (
    <ul className="mt-2 space-y-2">
      {assets.map((asset) => (
        <li
          key={asset.id}
          className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-sm"
        >
          <span className="flex min-w-0 items-center gap-2 truncate text-slate-700">
            <FileText className="h-4 w-4 shrink-0 text-slate-400" />
            <span className="truncate">{asset.file_name}</span>
            {asset.size ? (
              <span className="shrink-0 text-xs text-slate-400">
                — {formatBytes(asset.size)}
              </span>
            ) : null}
          </span>
          <a
            href={`/api/assets/${asset.id}`}
            className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs font-medium text-[var(--primary)] hover:bg-blue-50"
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </a>
        </li>
      ))}
    </ul>
  );
}

function NotifyRow({
  note,
  customer,
  contactEmail,
  contactPhone,
  label = "Send notification",
  sendLabel = "Send",
  onSent,
}: {
  note: MissingInfoNote;
  customer: Customer | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  label?: string;
  sendLabel?: string;
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
      <p className="text-sm font-medium text-slate-700">{label}</p>
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
              {sending ? "Sending…" : sendLabel}
            </Button>
          </div>
        ) : null}
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

function MoveToInProgressButton({
  orderId,
  columns,
  onMoved,
}: {
  orderId: string;
  columns: BoardColumn[];
  onMoved: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const inProgress = columns.find((c) =>
    c.name.toLowerCase().includes("in progress")
  );

  async function move() {
    if (!inProgress) return;
    setLoading(true);
    const res = await fetch("/api/orders/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId,
        toColumnId: inProgress.id,
        position: Date.now(),
      }),
    });
    setLoading(false);
    if (res.ok) {
      onMoved();
      router.refresh();
    }
  }

  if (!inProgress) return null;

  return (
    <Button type="button" size="sm" disabled={loading} onClick={move}>
      {loading ? "Moving…" : "Move to In Progress"}
    </Button>
  );
}

function HistoryEntry({
  note,
  customer,
  isLatest,
  contactEmail,
  contactPhone,
  onSent,
}: {
  note: MissingInfoNote;
  customer: Customer | null;
  isLatest: boolean;
  contactEmail?: string | null;
  contactPhone?: string | null;
  onSent: () => void;
}) {
  const status = statusSummary(note);

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Team request
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {formatDateTime(note.created_at)}
            {note.creator_name ? ` · ${note.creator_name}` : ""}
          </p>
        </div>
        {isLatest ? (
          <span className={cn("text-sm font-medium", status.className)}>
            {status.label}
          </span>
        ) : null}
      </div>

      {note.staff_note ? (
        <blockquote className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {note.staff_note}
        </blockquote>
      ) : null}

      {note.channel !== "none" && note.status !== "pending" ? (
        <p className="text-sm text-slate-600">
          <span className="font-medium text-slate-700">Sent: </span>
          via {note.channel === "sms" ? "SMS" : "Email"} to{" "}
          {sentToLabel(note, customer)}
        </p>
      ) : null}

      {showCustomerLink(note) ? <CustomerLinkRow token={note.token} /> : null}

      {note.status === "responded" ? (
        <div className="border-t border-slate-100 pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Client reply
            {note.responded_at
              ? ` · ${formatDateTime(note.responded_at)}`
              : ""}
          </p>
          {note.customer_note ? (
            <p className="mt-2 text-sm text-slate-600">
              &ldquo;{note.customer_note}&rdquo;
            </p>
          ) : null}
          <AttachmentList assets={note.response_assets} />
          {!note.customer_note && note.response_assets.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Response submitted.</p>
          ) : null}
        </div>
      ) : isLatest && note.channel === "manual" ? (
        <p className="text-sm text-slate-600">
          No notification sent. Contact customer directly.
        </p>
      ) : isLatest && note.channel !== "manual" ? (
        <NotifyRow
          note={note}
          customer={customer}
          contactEmail={contactEmail}
          contactPhone={contactPhone}
          label={note.status === "sent" ? "Resend notification" : "Send notification"}
          sendLabel={note.status === "sent" ? "Resend" : "Send"}
          onSent={onSent}
        />
      ) : (
        <p className="text-sm text-slate-400">No client response yet</p>
      )}
    </div>
  );
}

export function MissingInfoTab({
  notes,
  customer,
  orderId,
  columns,
  contactEmail,
  contactPhone,
  onSent,
}: MissingInfoTabProps) {
  if (notes.length === 0) {
    return (
      <p className="text-sm text-slate-400">No missing info notes yet.</p>
    );
  }

  const latest = notes[0];
  const latestStatus = statusSummary(latest);
  const history = [...notes].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  return (
    <div className="space-y-5">
      <div className="text-sm">
        <span className="font-medium text-slate-700">Status: </span>
        <span className={latestStatus.className}>{latestStatus.label}</span>
        {latest.status === "responded" && latest.responded_at ? (
          <span className="text-slate-500">
            {" "}
            — {formatDateTime(latest.responded_at)}
          </span>
        ) : null}
      </div>

      <div>
        <p className="mb-3 text-sm font-semibold text-slate-700">
          Communication history
        </p>
        <div className="space-y-3">
          {history.map((note) => (
            <HistoryEntry
              key={note.id}
              note={note}
              customer={customer}
              isLatest={note.id === latest.id}
              contactEmail={contactEmail}
              contactPhone={contactPhone}
              onSent={onSent}
            />
          ))}
        </div>
      </div>

      {latest.status === "responded" ? (
        <MoveToInProgressButton
          orderId={orderId}
          columns={columns}
          onMoved={onSent}
        />
      ) : null}
    </div>
  );
}
