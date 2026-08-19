"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, MessageSquare, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, formatDateTime } from "@/lib/utils";
import { CustomerLinkRow } from "./customer-link-row";
import { MoveBlockedModal } from "./move-blocked-modal";
import { postJsonWithTimeout } from "@/lib/fetch-with-timeout";
import { requestOrderMove } from "@/lib/orders/move-order-client";
import type { MissingField } from "@/lib/orders/validate-ready-to-move";
import { defaultSendChannels, channelFromSelection } from "@/lib/preferred-channel";
import { validateSmsRecipient } from "@/lib/sms";
import type { ApprovalNote, BoardColumn, Customer } from "@/lib/types";

interface ApprovalTabProps {
  notes: ApprovalNote[];
  customer: Customer | null;
  orderId: string;
  sourceColumnId: string;
  columns: BoardColumn[];
  contactEmail?: string | null;
  contactPhone?: string | null;
  onChanged: (patch?: { column_id?: string }) => void;
}

function showCustomerLink(note: ApprovalNote) {
  // Show for waiting, approved, and rejected — staff need the same link that was sent.
  return (
    note.channel !== "manual" &&
    note.channel !== "none" &&
    Boolean(note.token?.trim())
  );
}

function channelLabel(channel: ApprovalNote["channel"]) {
  if (channel === "both") return "Email + SMS";
  if (channel === "sms") return "SMS";
  if (channel === "email") return "Email";
  return channel;
}

function sentToLabel(
  note: ApprovalNote,
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

function findColumn(columns: BoardColumn[], match: (c: BoardColumn) => boolean) {
  return columns.find(match) ?? null;
}

function NotifyRow({
  note,
  customer,
  contactEmail,
  contactPhone,
  onSent,
  title = "Resend notification",
  sendLabel = "Resend",
}: {
  note: ApprovalNote;
  customer: Customer | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  onSent: () => void;
  title?: string;
  sendLabel?: string;
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
      <p className="text-sm font-medium text-slate-700">{title}</p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => toggleChannel("email")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium",
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
              "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium",
              wantSms
                ? "border-blue-500 bg-blue-50 text-blue-700"
                : "border-slate-200 text-slate-600 hover:bg-slate-50"
            )}
          >
            <MessageSquare className="h-4 w-4" />
            SMS
          </button>
        </div>
        {hasSelection && !(wantEmail && wantSms) ? (
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            <Input
              type={wantEmail ? "email" : "tel"}
              value={wantEmail ? email : phone}
              onChange={(e) =>
                wantEmail ? setEmail(e.target.value) : setPhone(e.target.value)
              }
              placeholder={
                wantEmail ? "customer@example.com" : "+1 555 123 4567"
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
      {wantEmail && wantSms ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="customer@example.com"
            className="h-9 min-w-0 flex-1"
          />
          <Input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 555 123 4567"
            className="h-9 min-w-0 flex-1"
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
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

function MoveButton({
  orderId,
  columnId,
  sourceColumnId,
  columns,
  label,
  onMoved,
}: {
  orderId: string;
  columnId: string;
  sourceColumnId: string;
  columns: BoardColumn[];
  label: string;
  onMoved: (toColumnId: string) => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [moveBlockedFields, setMoveBlockedFields] = useState<
    MissingField[] | null
  >(null);

  async function move() {
    setLoading(true);
    const result = await requestOrderMove(
      {
        orderId,
        toColumnId: columnId,
        position: Date.now(),
        bypassDropRoles: true,
      },
      { fromColumnId: sourceColumnId, columns }
    );
    setLoading(false);
    if (result.ok) {
      onMoved(columnId);
      router.refresh();
      return;
    }
    if (result.missingFields?.length) {
      setMoveBlockedFields(result.missingFields);
    }
  }

  return (
    <>
      <Button type="button" size="sm" disabled={loading} onClick={move}>
        {loading ? "Moving…" : label}
      </Button>
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

export function ApprovalTab({
  notes,
  customer,
  orderId,
  sourceColumnId,
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
  const decisions = notes
    .filter(
      (n) =>
        n.status === "responded" &&
        (n.customer_response === "approved" ||
          n.customer_response === "changes_requested")
    )
    .sort(
      (a, b) =>
        new Date(b.responded_at ?? b.created_at).getTime() -
        new Date(a.responded_at ?? a.created_at).getTime()
    );
  const latestDecision = decisions[0];
  // A decision closes every approval request that existed at that moment.
  // A request created after the decision starts a new approval round.
  const statusNote =
    latestDecision &&
    new Date(latestDecision.responded_at ?? latestDecision.created_at).getTime() >=
      new Date(latest.created_at).getTime()
      ? latestDecision
      : latest;
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
    if (
      statusNote.status === "responded" &&
      statusNote.customer_response === "approved"
    ) {
      return productionColumn ? (
        <MoveButton
          orderId={orderId}
          columnId={productionColumn.id}
          sourceColumnId={sourceColumnId}
          columns={columns}
          label="Move to production →"
          onMoved={(toColumnId) => onChanged({ column_id: toColumnId })}
        />
      ) : null;
    }

    if (
      statusNote.status === "responded" &&
      statusNote.customer_response === "changes_requested"
    ) {
      return (
        <div className="space-y-3">
          <NotifyRow
            note={statusNote}
            customer={customer}
            contactEmail={contactEmail}
            contactPhone={contactPhone}
            onSent={onChanged}
            title="Resend Approve Request"
            sendLabel="Send"
          />
          {returningColumn ? (
            <MoveButton
              orderId={orderId}
              columnId={returningColumn.id}
              sourceColumnId={sourceColumnId}
              columns={columns}
              label="Move to Returning Tickets"
              onMoved={(toColumnId) => onChanged({ column_id: toColumnId })}
            />
          ) : null}
        </div>
      );
    }

    if (
      statusNote.channel === "manual" &&
      statusNote.status !== "responded"
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
      (statusNote.status === "sent" || statusNote.status === "pending") &&
      statusNote.channel !== "manual"
    ) {
      return (
        <NotifyRow
          note={statusNote}
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
    const closingDecision = decisions.find(
      (decision) =>
        decision.id !== note.id &&
        new Date(decision.responded_at ?? decision.created_at).getTime() >=
          new Date(note.created_at).getTime()
    );
    if (closingDecision) {
      return closingDecision.customer_response === "approved"
        ? {
            label: "✅ Closed · Customer approved",
            className: "text-emerald-600",
            time: closingDecision.responded_at,
          }
        : {
            label: "❌ Closed · Changes requested",
            className: "text-red-600",
            time: closingDecision.responded_at,
          };
    }
    if (note.status === "expired") {
      return {
        label: `📤 Sent via ${channelLabel(note.channel)}`,
        className: "text-slate-500",
        time: note.created_at,
      };
    }
    if (note.status === "sent" || note.status === "pending") {
      return {
        label: `⏳ Waiting · ${channelLabel(note.channel)}`,
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

  const latestStatus = entryStatus(statusNote);

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

      {(statusNote.status === "sent" || statusNote.status === "pending") &&
      statusNote.channel !== "manual" ? (
        <div className="text-sm text-slate-600">
          <p>
            <span className="font-medium text-slate-700">Sent: </span>
            {formatDateTime(statusNote.created_at)} via{" "}
            {channelLabel(statusNote.channel)}
          </p>
          <p className="mt-1">
            <span className="font-medium text-slate-700">To: </span>
            {sentToLabel(statusNote, customer, contactEmail, contactPhone)}
          </p>
          {showCustomerLink(statusNote) ? (
            <div className="mt-3">
              <CustomerLinkRow token={statusNote.token} orderId={orderId} />
            </div>
          ) : null}
        </div>
      ) : null}

      {statusNote.status === "responded" && statusNote.customer_note ? (
        <div>
          <p className="text-sm font-medium text-slate-700">
            Customer last response:
          </p>
          <blockquote className="mt-1 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
            &ldquo;{statusNote.customer_note}&rdquo;
          </blockquote>
        </div>
      ) : null}

      {statusNote.staff_note &&
      statusNote.status !== "responded" &&
      statusNote.channel !== "manual" ? (
        <div>
          <p className="text-sm font-medium text-slate-700">Note to customer:</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">
            {statusNote.staff_note}
          </p>
        </div>
      ) : null}

      {renderLatestActions()}

      {history.length > 0 ? (
        <div>
          <p className="mb-3 text-sm font-semibold text-slate-700">
            Communication history
          </p>
          <div className="space-y-3">
            {[...history].reverse().map((note) => {
              const status = entryStatus(note);
              const isLatest = note.id === latest.id;
              const hasCustomerReply = note.status === "responded";
              return (
                <div
                  key={note.id}
                  className={cn(
                    "rounded-lg border p-4 text-sm",
                    isLatest
                      ? "border-amber-200 bg-amber-50/40"
                      : "border-slate-200"
                  )}
                >
                  {/* Our Sent */}
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Our Sent
                        {isLatest ? " · Latest" : ""}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {formatDateTime(note.created_at)}
                        {note.creator_name ? ` · ${note.creator_name}` : ""}
                        {note.channel !== "manual" && note.channel !== "none"
                          ? ` · via ${channelLabel(note.channel)}`
                          : ""}
                      </p>
                    </div>
                    <span className={cn("text-sm font-medium", status.className)}>
                      {status.label}
                    </span>
                  </div>

                  {note.approval_files && note.approval_files.length > 0 ? (
                    <div className="mt-2">
                      <p className="text-[11px] font-medium text-slate-400">
                        Files sent this round
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {note.approval_files.map((f, i) => (
                          <a
                            key={i}
                            href={`/api/orders/${orderId}/approval-files/${note.id}/${i}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
                            title={`Exact file the customer saw for this approval: ${f.file_name}`}
                          >
                            <Paperclip className="h-3 w-3 shrink-0" />
                            <span className="max-w-[160px] truncate">
                              {f.file_name}
                            </span>
                          </a>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {note.staff_note ? (
                    <p className="mt-3 whitespace-pre-wrap text-slate-700">
                      {note.staff_note}
                    </p>
                  ) : note.channel === "manual" ? (
                    <p className="mt-3 text-slate-500">
                      Manual follow-up — no message sent.
                    </p>
                  ) : null}

                  {showCustomerLink(note) ? (
                    <div className="mt-3">
                      <CustomerLinkRow token={note.token} orderId={orderId} />
                    </div>
                  ) : null}

                  {/* Customer Response */}
                  {hasCustomerReply ? (
                    <div className="mt-4 border-t border-slate-200/80 pt-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Customer Response
                        {note.responded_at
                          ? ` · ${formatDateTime(note.responded_at)}`
                          : ""}
                      </p>
                      {note.customer_note ? (
                        <blockquote className="mt-2 rounded-md bg-white/80 px-3 py-2 text-slate-700">
                          &ldquo;{note.customer_note}&rdquo;
                        </blockquote>
                      ) : (
                        <p className="mt-2 text-slate-500">
                          No note from customer.
                        </p>
                      )}
                    </div>
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
