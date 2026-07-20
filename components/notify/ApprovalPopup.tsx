"use client";

import { useMemo, useState } from "react";
import { Mail, MessageSquare, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import {
  approvalSubject,
  buildApprovalEmailBody,
  buildApprovalSmsBody,
  customerContactFromOrder,
  customerNameFromOrder,
  productFromOrder,
} from "@/lib/notification-messages";
import {
  channelFromSelection,
  defaultSendChannels,
  resolvePreferredNotifyChannel,
} from "@/lib/preferred-channel";
import { postJsonWithTimeout } from "@/lib/fetch-with-timeout";
import { validateSmsRecipient } from "@/lib/sms";
import { cn } from "@/lib/utils";
import type { CustomField, OrderWithRelations } from "@/lib/types";

type Mode = "notify" | "manual";

interface Props {
  order: OrderWithRelations;
  tenantName: string;
  customFields: CustomField[];
  fieldValues: Record<string, unknown>;
  smsConfigured: boolean;
  publicAppUrl: boolean;
  onClose: () => void;
  dismissing?: boolean;
  onSent: (toastMessage: string) => void;
}

export function ApprovalPopup({
  order,
  tenantName,
  customFields,
  fieldValues,
  smsConfigured,
  publicAppUrl,
  onClose,
  dismissing = false,
  onSent,
}: Props) {
  const contact = useMemo(
    () => customerContactFromOrder(order, fieldValues, customFields),
    [order, fieldValues, customFields]
  );
  const customerName = useMemo(
    () => customerNameFromOrder(order, fieldValues, customFields),
    [order, fieldValues, customFields]
  );
  const product = useMemo(
    () => productFromOrder(fieldValues, customFields),
    [fieldValues, customFields]
  );

  const initialResolved = resolvePreferredNotifyChannel(
    contact,
    order.customer?.preferred_channel,
    smsConfigured
  );

  const [mode, setMode] = useState<Mode>(() =>
    initialResolved === "manual" ? "manual" : "notify"
  );
  const [selected, setSelected] = useState<Array<"email" | "sms">>(() =>
    initialResolved === "manual"
      ? defaultSendChannels(contact, order.customer?.preferred_channel, smsConfigured)
      : defaultSendChannels(
          contact,
          order.customer?.preferred_channel,
          smsConfigured
        )
  );
  const [email, setEmail] = useState(contact.email ?? "");
  const [phone, setPhone] = useState(contact.phone ?? "");
  const [subject, setSubject] = useState(() => approvalSubject(order.title));
  const [emailMessage, setEmailMessage] = useState(() =>
    buildApprovalEmailBody({
      customerName: customerNameFromOrder(order, fieldValues, customFields),
      productType: productFromOrder(fieldValues, customFields),
      orderNumber: order.title,
      approvalLink: "[reply link added on send]",
      teamName: `${tenantName} Team`,
    })
  );
  const [staffNote, setStaffNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wantEmail = mode === "notify" && selected.includes("email");
  const wantSms = mode === "notify" && selected.includes("sms");
  const isManual = mode === "manual";

  function toggleChannel(next: "email" | "sms") {
    setMode("notify");
    setSelected((prev) => {
      if (prev.includes(next)) {
        const nextSel = prev.filter((c) => c !== next);
        return nextSel.length === 0 ? prev : nextSel;
      }
      return [...prev, next];
    });
    setError(null);
  }

  function selectManual() {
    setMode("manual");
    setError(null);
  }

  async function saveAndSend() {
    setError(null);

    if (!isManual) {
      const channel = channelFromSelection(selected);
      if (!channel) {
        setError("Select Email, SMS, or both.");
        return;
      }
      if (wantEmail && !email.trim()) {
        setError("Customer email is required.");
        return;
      }
      if (wantSms) {
        const smsError = validateSmsRecipient(phone);
        if (smsError) {
          setError(smsError);
          return;
        }
      }
      if (wantEmail && !emailMessage.trim()) {
        setError("Email message is required.");
        return;
      }
    }

    setLoading(true);
    try {
      const channel = isManual ? "manual" : channelFromSelection(selected);
      if (!channel) {
        setError("Select Email, SMS, or both.");
        setLoading(false);
        return;
      }

      const emailBody =
        wantEmail
          ? appendStaffNoteToEmail(emailMessage, staffNote)
          : undefined;
      const { ok, data } = await postJsonWithTimeout<{ error?: string }>(
        "/api/notifications/send",
        {
          orderId: order.id,
          type: "customer_approval",
          channel,
          staffNote: staffNote.trim() || undefined,
          subject: wantEmail ? subject.trim() : undefined,
          messageBody: wantEmail
            ? emailBody
            : wantSms
              ? buildApprovalSmsBody({
                  customerName,
                  productType: product,
                  orderNumber: order.title,
                  approvalLink: "[reply link added on send]",
                  brandName: tenantName,
                })
              : undefined,
          toEmail: wantEmail ? email.trim() || undefined : undefined,
          toPhone: wantSms ? phone.trim() || undefined : undefined,
        }
      );
      if (!ok) {
        setError(
          data.error ??
            (wantSms && !wantEmail
              ? "SMS failed to send. Please check Twilio config."
              : wantEmail
                ? "Email failed. Check INSTANTLY_API_KEY."
                : "Failed to save")
        );
        return;
      }
      if (isManual) {
        onSent("Saved — manual follow-up");
      } else if (channel === "both") {
        onSent(`Approval request sent via Email + SMS to ${customerName}`);
      } else if (channel === "email") {
        onSent(`Approval request sent to ${customerName}`);
      } else {
        onSent(`SMS sent to ${phone.trim()}`);
      }
    } catch {
      setError(
        wantSms && !wantEmail
          ? "SMS failed to send. Please check Twilio config."
          : wantEmail
            ? "Email failed. Check INSTANTLY_API_KEY."
            : "Failed to save"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        role="dialog"
        aria-labelledby="approval-popup-title"
      >
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2
              id="approval-popup-title"
              className="text-base font-semibold text-slate-800"
            >
              Request customer approval
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {order.title}
              {customerName !== "there" ? ` · ${customerName}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading || dismissing}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">
              How would you like to notify the customer?
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => toggleChannel("email")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
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
                  "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                  wantSms
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                )}
              >
                <MessageSquare className="h-4 w-4" />
                SMS
              </button>
              <button
                type="button"
                onClick={selectManual}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                  isManual
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                )}
              >
                <User className="h-4 w-4" />
                Manual
              </button>
            </div>
            {!isManual ? (
              <p className="mt-1.5 text-xs text-slate-500">
                Select Email, SMS, or both when contact details are available.
              </p>
            ) : null}
          </div>

          {isManual ? (
            <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              You&apos;ve selected manual follow-up. The card will be tagged as
              Manual on the board.
            </p>
          ) : (
            <>
              {wantEmail ? (
                <div>
                  <Label htmlFor="approval-email">Email</Label>
                  <Input
                    id="approval-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="customer@example.com"
                  />
                </div>
              ) : null}

              {wantSms ? (
                <div>
                  <Label htmlFor="approval-phone">Phone</Label>
                  <Input
                    id="approval-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+1 555 123 4567"
                  />
                  {!smsConfigured ? (
                    <p className="mt-1 text-xs text-amber-700">
                      Twilio is not configured. Add Twilio credentials to
                      .env.local and restart the dev server.
                    </p>
                  ) : null}
                  {smsConfigured && !publicAppUrl ? (
                    <p className="mt-1 text-xs text-slate-500">
                      Approval links use localhost and won&apos;t open on a
                      customer&apos;s phone until you set NEXT_PUBLIC_APP_URL to
                      your public domain.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {wantEmail ? (
                <>
                  <div>
                    <Label htmlFor="approval-subject">Subject</Label>
                    <Input
                      id="approval-subject"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="approval-message">Email message</Label>
                    <Textarea
                      id="approval-message"
                      value={emailMessage}
                      onChange={(e) => setEmailMessage(e.target.value)}
                      rows={12}
                      className="mt-1 font-sans text-sm leading-relaxed"
                    />
                    <p className="mt-1 text-xs text-slate-400">
                      Edit the email sent to the customer. Keep{" "}
                      <span className="font-mono">
                        [reply link added on send]
                      </span>{" "}
                      where the approval link should appear.
                    </p>
                  </div>
                </>
              ) : null}

              {wantSms ? (
                <div>
                  <Label>Message preview (SMS)</Label>
                  <p className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    {buildApprovalSmsBody({
                      customerName,
                      productType: product,
                      orderNumber: order.title,
                      approvalLink: "[reply link added on send]",
                      brandName: tenantName,
                    })}
                  </p>
                </div>
              ) : null}
            </>
          )}

          <div>
            <Label htmlFor="approval-note">
              Note for customer{" "}
              <span className="font-normal text-slate-400">(optional)</span>
            </Label>
            <Textarea
              id="approval-note"
              value={staffNote}
              onChange={(e) => setStaffNote(e.target.value)}
              placeholder="Anything you'd like the customer to know before approving…"
              rows={3}
            />
          </div>

          {error ? (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={loading || dismissing}
          >
            Cancel
          </Button>
          <Button onClick={saveAndSend} disabled={loading || dismissing}>
            {loading
              ? "Saving…"
              : isManual
                ? "Save"
                : "Send & notify"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function appendStaffNoteToEmail(body: string, note: string) {
  const trimmed = note.trim();
  if (!trimmed) return body.trim();
  return `${body.trim()}\n\nNote from our team:\n${trimmed}`;
}
