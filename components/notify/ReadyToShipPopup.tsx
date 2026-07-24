"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Mail, MessageSquare, Package, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import {
  buildReadyToShipEmailBody,
  buildReadyToShipSmsBody,
  customerContactFromOrder,
  customerNameFromOrder,
  readyToShipSubject,
} from "@/lib/notification-messages";
import {
  destinationForChannel,
  resolvePreferredNotifyChannel,
} from "@/lib/preferred-channel";
import { postJsonWithTimeout } from "@/lib/fetch-with-timeout";
import { validateSmsRecipient } from "@/lib/sms";
import { cn } from "@/lib/utils";
import type { CustomField, OrderWithRelations } from "@/lib/types";

type Channel = "email" | "sms" | "manual";

interface CheckResult {
  siblingCount: number;
  siblingsInColumn: number;
  siblingTitles?: string[];
  groupLabel?: string;
  previousNotificationDate: string | null;
}

interface Props {
  order: OrderWithRelations;
  columnId: string;
  tenantName: string;
  customFields: CustomField[];
  fieldValues: Record<string, unknown>;
  smsConfigured: boolean;
  onClose: () => void;
  dismissing?: boolean;
  onSent: (toastMessage: string) => void;
}

export function ReadyToShipPopup({
  order,
  columnId,
  tenantName,
  customFields,
  fieldValues,
  smsConfigured,
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
  const teamName = `${tenantName} Team`;

  const [channel, setChannel] = useState<Channel>(() =>
    resolvePreferredNotifyChannel(
      contact,
      order.customer?.preferred_channel,
      smsConfigured
    )
  );
  const [to, setTo] = useState(() => {
    const initial = resolvePreferredNotifyChannel(
      contact,
      order.customer?.preferred_channel,
      smsConfigured
    );
    if (initial === "manual") return "";
    return destinationForChannel(contact, initial);
  });
  const [subject, setSubject] = useState(() => readyToShipSubject(order.title));
  const [emailMessage, setEmailMessage] = useState(() =>
    buildReadyToShipEmailBody({
      customerName,
      orderNumber: order.title,
      orderLink: "[order link added on send]",
      teamName,
    })
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allowPartial, setAllowPartial] = useState(false);

  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);

  useEffect(() => {
    fetch(
      `/api/board/ready-to-ship-check?orderId=${encodeURIComponent(order.id)}&columnId=${encodeURIComponent(columnId)}`
    )
      .then((r) => r.json())
      .then((data: CheckResult) => setCheckResult(data))
      .catch(() => {
        /* non-critical */
      });
  }, [order.id, columnId]);

  const orderLabel = checkResult?.groupLabel?.trim() || order.title;

  useEffect(() => {
    if (!checkResult?.groupLabel) return;
    setSubject(readyToShipSubject(checkResult.groupLabel));
    setEmailMessage(
      buildReadyToShipEmailBody({
        customerName,
        orderNumber: checkResult.groupLabel,
        orderLink: "[order link added on send]",
        teamName,
      })
    );
  }, [checkResult?.groupLabel, customerName, teamName]);

  const notAllReady =
    checkResult !== null &&
    checkResult.siblingCount > 1 &&
    checkResult.siblingsInColumn < checkResult.siblingCount;

  const waitingForGroup = notAllReady && !allowPartial && channel !== "manual";

  const alreadySent = Boolean(checkResult?.previousNotificationDate);
  const alreadySentDate = checkResult?.previousNotificationDate
    ? new Date(checkResult.previousNotificationDate).toLocaleDateString(
        undefined,
        {
          month: "short",
          day: "numeric",
          year: "numeric",
        }
      )
    : null;

  async function saveAndSend() {
    setError(null);

    if (waitingForGroup) {
      setError(
        "Wait until all parts are in Ready to Ship, or choose “Notify partial anyway”."
      );
      return;
    }

    if (channel !== "manual") {
      const destination = to.trim();
      if (!destination) {
        setError(
          channel === "email"
            ? "Customer email is required."
            : "Customer phone number is required."
        );
        return;
      }
      if (channel === "sms") {
        const smsError = validateSmsRecipient(destination);
        if (smsError) {
          setError(smsError);
          return;
        }
      }
    }

    setLoading(true);
    try {
      const { ok, data } = await postJsonWithTimeout<{ error?: string }>(
        "/api/notifications/send",
        {
          orderId: order.id,
          type: "ready_to_ship",
          channel,
          subject: channel === "email" ? subject.trim() : undefined,
          messageBody: channel === "email" ? emailMessage : undefined,
          toEmail: channel === "email" ? to.trim() || undefined : undefined,
          toPhone: channel === "sms" ? to.trim() || undefined : undefined,
        }
      );

      if (!ok) {
        setError(
          data.error ??
            (channel === "sms"
              ? "SMS failed. Check Twilio config."
              : channel === "email"
                ? "Email failed. Check INSTANTLY_API_KEY."
                : "Failed to save")
        );
        return;
      }

      if (channel === "manual") {
        onSent("Saved — manual follow-up");
      } else if (channel === "email") {
        onSent(`Notification sent to ${customerName}`);
      } else {
        onSent(`SMS sent to ${to.trim()}`);
      }
    } catch {
      setError(
        channel === "sms"
          ? "SMS failed. Check Twilio config."
          : channel === "email"
            ? "Email failed. Check INSTANTLY_API_KEY."
            : "Failed to save"
      );
    } finally {
      setLoading(false);
    }
  }

  function switchChannel(next: Channel) {
    setChannel(next);
    if (next === "email") setTo(contact.email ?? "");
    else if (next === "sms") setTo(contact.phone ?? "");
    setError(null);
  }

  const isManual = channel === "manual";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        role="dialog"
        aria-labelledby="rts-popup-title"
      >
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
              <Package className="h-5 w-5" />
            </span>
            <div>
              <h2
                id="rts-popup-title"
                className="text-base font-semibold text-slate-800"
              >
                Order is ready — notify customer
              </h2>
              <p className="mt-0.5 text-sm text-slate-500">
                {orderLabel}
                {customerName !== "there" ? ` · ${customerName}` : ""}
              </p>
            </div>
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
          {checkResult && checkResult.siblingCount > 1 ? (
            <div
              className={cn(
                "flex items-start gap-2 rounded-md px-3 py-2.5 text-sm",
                notAllReady
                  ? "border border-amber-200 bg-amber-50 text-amber-800"
                  : "border border-emerald-200 bg-emerald-50 text-emerald-800"
              )}
            >
              {notAllReady ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              ) : (
                <Package className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              )}
              <div className="space-y-1">
                <span>
                  {notAllReady
                    ? `Waiting for all parts — ${checkResult.siblingsInColumn} of ${checkResult.siblingCount} are in Ready to Ship. One SMS will list every part when you send.`
                    : `All ${checkResult.siblingCount} parts are ready. One notification link will show all parts for the customer.`}
                </span>
                {checkResult.siblingTitles?.length ? (
                  <p className="text-xs opacity-80">
                    {checkResult.siblingTitles.join(" · ")}
                  </p>
                ) : null}
                {notAllReady ? (
                  <button
                    type="button"
                    onClick={() => {
                      setAllowPartial(true);
                      setError(null);
                    }}
                    className="mt-1 text-xs font-medium underline underline-offset-2"
                  >
                    Notify partial anyway
                  </button>
                ) : null}
                {allowPartial && notAllReady ? (
                  <p className="text-xs font-medium">
                    Partial notify enabled — customer will still see all group
                    parts on the link.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {alreadySent ? (
            <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm text-blue-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
              <span>
                A ready notification was already sent on{" "}
                <strong>{alreadySentDate}</strong>. Sending again will notify the
                customer a second time.
              </span>
            </div>
          ) : null}

          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">
              How would you like to notify the customer?
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => switchChannel("email")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                  channel === "email"
                    ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                )}
              >
                <Mail className="h-4 w-4" />
                Email
              </button>
              <button
                type="button"
                onClick={() => switchChannel("sms")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                  channel === "sms"
                    ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                )}
              >
                <MessageSquare className="h-4 w-4" />
                SMS
              </button>
              <button
                type="button"
                onClick={() => switchChannel("manual")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                  channel === "manual"
                    ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                )}
              >
                <User className="h-4 w-4" />
                Manual
              </button>
            </div>
          </div>

          {isManual ? (
            <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              You&apos;ve selected manual follow-up. The card will be tagged on
              the board without sending a message.
            </p>
          ) : (
            <>
              <div>
                <Label htmlFor="rts-to">To</Label>
                <Input
                  id="rts-to"
                  type={channel === "email" ? "email" : "tel"}
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder={
                    channel === "email"
                      ? "customer@example.com"
                      : "+1 555 123 4567"
                  }
                />
                {channel === "sms" && !smsConfigured ? (
                  <p className="mt-1 text-xs text-amber-700">
                    Twilio is not configured. Add Twilio credentials to
                    .env.local and restart.
                  </p>
                ) : null}
              </div>

              {channel === "email" ? (
                <>
                  <div>
                    <Label htmlFor="rts-subject">Subject</Label>
                    <Input
                      id="rts-subject"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="rts-message">Email message</Label>
                    <Textarea
                      id="rts-message"
                      value={emailMessage}
                      onChange={(e) => setEmailMessage(e.target.value)}
                      rows={10}
                      className="mt-1 font-sans text-sm leading-relaxed"
                    />
                  </div>
                </>
              ) : (
                <div>
                  <Label>Message preview (SMS)</Label>
                  <p className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    {buildReadyToShipSmsBody({
                      customerName,
                      orderNumber: orderLabel,
                      orderLink: "[order link added on send]",
                      brandName: tenantName,
                    })}
                  </p>
                </div>
              )}
            </>
          )}

          {error ? (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <Button variant="ghost" onClick={onClose} disabled={loading || dismissing}>
            Cancel
          </Button>
          <Button
            onClick={saveAndSend}
            disabled={loading || dismissing || waitingForGroup}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {loading
              ? "Saving…"
              : isManual
                ? "Save"
                : waitingForGroup
                  ? "Waiting for all parts"
                  : "Send notification"}
          </Button>
        </div>
      </div>
    </div>
  );
}
