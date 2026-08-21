"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Mail, MessageSquare, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, formatDateTime } from "@/lib/utils";
import { formatFileSize as formatBytes } from "@/lib/notification-messages";
import { CustomerLinkRow } from "./customer-link-row";
import { MoveBlockedModal } from "./move-blocked-modal";
import { postJsonWithTimeout } from "@/lib/fetch-with-timeout";
import { requestOrderMove } from "@/lib/orders/move-order-client";
import type { MissingField } from "@/lib/orders/validate-ready-to-move";
import { defaultSendChannels, channelFromSelection } from "@/lib/preferred-channel";
import { validateSmsRecipient } from "@/lib/sms";
import type { Asset, BoardColumn, Customer, MissingInfoNote, Role } from "@/lib/types";

interface MissingInfoTabProps {
  notes: MissingInfoNote[];
  customer: Customer | null;
  orderId: string;
  sourceColumnId: string;
  columns: BoardColumn[];
  columnName?: string;
  missingFields?: MissingField[];
  contactEmail?: string | null;
  contactPhone?: string | null;
  role?: Role;
  onSent: () => void;
  /** When the card is moved to In Progress from this tab. */
  onMoved?: (toColumnId: string) => void;
}

function showCustomerLink(note: MissingInfoNote) {
  return (
    (note.channel === "email" ||
      note.channel === "sms" ||
      note.channel === "both") &&
    note.status === "sent"
  );
}

function channelLabel(channel: MissingInfoNote["channel"]) {
  if (channel === "both") return "Email + SMS";
  if (channel === "sms") return "SMS";
  if (channel === "email") return "Email";
  return channel;
}

function sentToLabel(
  note: MissingInfoNote,
  customer: Customer | null,
  contactEmail?: string | null,
  contactPhone?: string | null
) {
  const email = contactEmail ?? customer?.email ?? null;
  const phone = contactPhone ?? customer?.phone ?? null;
  if (note.channel === "both") {
    return [email, phone].filter(Boolean).join(" · ") || "Email + SMS";
  }
  if (note.channel === "sms") return phone ?? "SMS";
  if (note.channel === "email") return email ?? "Email";
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
  const [selected, setSelected] = useState<Array<"email" | "sms">>(() =>
    defaultSendChannels(
      {
        email: contactEmail ?? customer?.email ?? null,
        phone: contactPhone ?? customer?.phone ?? null,
      },
      customer?.preferred_channel
    )
  );
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
    setSelected(
      defaultSendChannels(
        {
          email: contactEmail ?? customer?.email ?? null,
          phone: contactPhone ?? customer?.phone ?? null,
        },
        customer?.preferred_channel
      )
    );
  }, [
    contactEmail,
    contactPhone,
    customer?.email,
    customer?.phone,
    customer?.preferred_channel,
  ]);

  function toggleChannel(next: "email" | "sms") {
    setSelected((prev) =>
      prev.includes(next) ? prev.filter((c) => c !== next) : [...prev, next]
    );
    setError(null);
  }

  async function send() {
    const channel = channelFromSelection(selected);
    if (!channel) return;
    setError(null);
    if (selected.includes("sms")) {
      const smsError = validateSmsRecipient(phone);
      if (smsError) {
        setError(smsError);
        return;
      }
    }
    if (selected.includes("email") && !email.trim()) {
      setError("Customer email is required.");
      return;
    }
    setSending(true);
    try {
      const { ok, data } = await postJsonWithTimeout<{
        error?: string;
        warning?: string | null;
      }>(`/api/notifications/${note.id}/send`, {
        channel,
        toEmail: selected.includes("email")
          ? email.trim() || undefined
          : undefined,
        toPhone: selected.includes("sms")
          ? phone.trim() || undefined
          : undefined,
      });
      if (!ok) {
        setError(
          data.error ??
            (selected.includes("sms") && !selected.includes("email")
              ? "SMS failed to send. Please check Twilio config."
              : "Email failed. Check INSTANTLY_API_KEY.")
        );
        return;
      }
      if (data.warning) {
        setError(data.warning);
      }
      onSent();
    } catch {
      setError(
        selected.includes("sms") && !selected.includes("email")
          ? "SMS failed to send. Please check Twilio config."
          : "Email failed. Check INSTANTLY_API_KEY."
      );
    } finally {
      setSending(false);
    }
  }

  const wantEmail = selected.includes("email");
  const wantSms = selected.includes("sms");
  const hasSelection = wantEmail || wantSms;

  return (
    <div className="space-y-2 border-t border-slate-100 pt-3">
      <p className="text-sm font-medium text-slate-700">{label}</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => toggleChannel("email")}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium",
            wantEmail
              ? "border-blue-500 bg-blue-50 text-blue-700"
              : "border-slate-200 text-slate-600 hover:bg-slate-50"
          )}
        >
          <Mail className="h-4 w-4" />
          Email
        </button>
        <button
          type="button"
          onClick={() => toggleChannel("sms")}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium",
            wantSms
              ? "border-blue-500 bg-blue-50 text-blue-700"
              : "border-slate-200 text-slate-600 hover:bg-slate-50"
          )}
        >
          <MessageSquare className="h-4 w-4" />
          SMS
        </button>
        {wantEmail ? (
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="customer@example.com"
            className="h-9 min-w-0 flex-1"
          />
        ) : null}
        {wantSms ? (
          <Input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 555 123 4567"
            className="h-9 min-w-0 flex-1"
          />
        ) : null}
        {hasSelection ? (
          <Button
            type="button"
            size="sm"
            disabled={sending}
            onClick={send}
            className="shrink-0"
          >
            {sending ? "Sending…" : sendLabel}
          </Button>
        ) : null}
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

function MoveToInProgressButton({
  orderId,
  sourceColumnId,
  columns,
  onMoved,
}: {
  orderId: string;
  sourceColumnId: string;
  columns: BoardColumn[];
  onMoved: (toColumnId: string) => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moveBlockedFields, setMoveBlockedFields] = useState<
    MissingField[] | null
  >(null);
  const inProgress = columns.find((c) =>
    c.name.toLowerCase().includes("in progress")
  );

  async function move() {
    if (!inProgress) return;
    setLoading(true);
    setError(null);
    const result = await requestOrderMove(
      {
        orderId,
        toColumnId: inProgress.id,
        position: Date.now(),
        bypassDropRoles: true,
      },
      { fromColumnId: sourceColumnId, columns }
    );
    setLoading(false);
    if (result.ok) {
      onMoved(inProgress.id);
      router.refresh();
      return;
    }
    if (result.missingFields?.length) {
      setMoveBlockedFields(result.missingFields);
      return;
    }
    setError(result.error ?? "Move was rejected.");
  }

  if (!inProgress) return null;

  return (
    <>
      <div className="space-y-2">
        <Button type="button" size="sm" disabled={loading} onClick={move}>
          {loading ? "Moving…" : "Move to In Progress"}
        </Button>
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
      </div>
      {moveBlockedFields ? (
        <MoveBlockedModal
          missingFields={moveBlockedFields}
          onOpenCard={() => setMoveBlockedFields(null)}
          onClose={() => setMoveBlockedFields(null)}
        />
      ) : null}
    </>
  );
}

function HistoryEntry({
  note,
  customer,
  isLatest,
  canSend,
  contactEmail,
  contactPhone,
  onSent,
}: {
  note: MissingInfoNote;
  customer: Customer | null;
  isLatest: boolean;
  canSend: boolean;
  contactEmail?: string | null;
  contactPhone?: string | null;
  onSent: () => void;
}) {
  const isInternalNote = note.channel === "none";
  const status = statusSummary(note);

  return (
    <div
      className={cn(
        "space-y-3 rounded-lg border p-4",
        isInternalNote
          ? "border-amber-100 bg-amber-50/50"
          : "border-slate-200"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p
            className={cn(
              "text-xs font-semibold uppercase tracking-wide",
              isInternalNote ? "text-amber-600" : "text-slate-400"
            )}
          >
            {isInternalNote ? (
              <span className="inline-flex items-center gap-1">
                <StickyNote className="h-3 w-3" /> Internal note
              </span>
            ) : (
              "Team request"
            )}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {formatDateTime(note.created_at)}
            {note.creator_name ? ` · ${note.creator_name}` : ""}
          </p>
        </div>
        {isLatest && !isInternalNote ? (
          <span className={cn("text-sm font-medium", status.className)}>
            {status.label}
          </span>
        ) : null}
      </div>

      {note.staff_note ? (
        <blockquote
          className={cn(
            "rounded-md px-3 py-2 text-sm text-slate-700",
            isInternalNote ? "bg-amber-50" : "bg-slate-50"
          )}
        >
          {note.staff_note}
        </blockquote>
      ) : null}

      {!isInternalNote && note.channel !== "none" && note.status !== "pending" ? (
        <p className="text-sm text-slate-600">
          <span className="font-medium text-slate-700">Sent: </span>
          via {channelLabel(note.channel)} to{" "}
          {sentToLabel(note, customer, contactEmail, contactPhone)}
        </p>
      ) : null}

      {showCustomerLink(note) ? <CustomerLinkRow token={note.token} /> : null}

      {!isInternalNote && note.status === "responded" ? (
        <div className="border-t border-slate-100 pt-3">
          <p className="inline-block rounded-md bg-amber-200 px-2 py-1 text-xs font-bold uppercase tracking-wide text-black">
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
      ) : !isInternalNote && isLatest && canSend && note.channel === "manual" ? (
        <NotifyRow
          note={note}
          customer={customer}
          contactEmail={contactEmail}
          contactPhone={contactPhone}
          label="Send notification"
          sendLabel="Send"
          onSent={onSent}
        />
      ) : !isInternalNote && isLatest && canSend && note.channel !== "manual" ? (
        <NotifyRow
          note={note}
          customer={customer}
          contactEmail={contactEmail}
          contactPhone={contactPhone}
          label={note.status === "sent" ? "Resend notification" : "Send notification"}
          sendLabel={note.status === "sent" ? "Resend" : "Send"}
          onSent={onSent}
        />
      ) : !isInternalNote && !isLatest ? (
        <p className="text-sm text-slate-400">No client response yet</p>
      ) : null}
    </div>
  );
}

export function MissingInfoTab({
  notes,
  customer,
  orderId,
  sourceColumnId,
  columns,
  columnName,
  missingFields = [],
  contactEmail,
  contactPhone,
  role,
  onSent,
  onMoved,
}: MissingInfoTabProps) {
  const canSend = role !== "designer";

  if (notes.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          This order is in the{" "}
          <span className="font-medium">{columnName ?? "Missing Info"}</span>{" "}
          column. No customer notification has been logged yet.
        </p>
        {missingFields.length > 0 ? (
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">
              Required fields still incomplete
            </p>
            <ul className="space-y-1.5">
              {missingFields.map((field) => (
                <li
                  key={field.field}
                  className="flex items-center gap-2 text-sm text-slate-600"
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                  {field.label}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-slate-500">
              Complete these on the Order Details tab, then move the card forward
              when ready.
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            All required fields appear complete. You can move this card to the next
            stage when ready.
          </p>
        )}
        {canSend ? (
          <p className="text-sm text-slate-400">
            To email or text the customer, move the card into Missing Info from
            another column with automations enabled, or log a manual follow-up after
            a notification is created.
          </p>
        ) : null}
      </div>
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
      {canSend ? (
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
      ) : null}

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
              canSend={canSend}
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
          sourceColumnId={sourceColumnId}
          columns={columns}
          onMoved={(toColumnId) => {
            if (onMoved) onMoved(toColumnId);
            else onSent();
          }}
        />
      ) : null}
    </div>
  );
}
