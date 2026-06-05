import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

interface SmsArgs {
  to: string;
  body: string;
}

export type SmsSendResult = { sent: boolean; error?: string };

export function isSmsConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
      process.env.TWILIO_AUTH_TOKEN?.trim() &&
      process.env.TWILIO_PHONE_NUMBER?.trim()
  );
}

/** Reject emails and other non-phone values before calling Twilio. */
export function validateSmsRecipient(raw: string): string | null {
  const value = raw.trim();
  if (!value) return "Phone number is required for SMS.";
  if (value.includes("@")) {
    return "SMS requires a phone number, not an email address.";
  }
  const digits = value.replace(/\D/g, "");
  if (digits.length < 10) {
    return "Enter a valid phone number (at least 10 digits, e.g. +1 818 555 1234).";
  }
  return null;
}

/** Normalize to E.164; US numbers without country code get +1. */
export function normalizeSmsPhone(raw: string): string {
  const value = raw.trim();
  if (value.startsWith("+")) {
    return `+${value.slice(1).replace(/\D/g, "")}`;
  }
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

function twilioErrorMessage(responseText: string): string {
  try {
    const parsed = JSON.parse(responseText) as {
      message?: string;
      code?: number;
    };
    if (parsed.message) {
      const hints: Record<number, string> = {
        21211:
          "Use a valid mobile number in E.164 format (e.g. +18185551234).",
        21610:
          "This number has opted out of messages from your Twilio number.",
        21614: "This number cannot receive SMS.",
        21408:
          "Your Twilio account does not have permission to send to this region.",
      };
      const hint = parsed.code ? hints[parsed.code] : undefined;
      const base = parsed.code
        ? `Twilio (${parsed.code}): ${parsed.message}`
        : parsed.message;
      return hint ? `${base} ${hint}` : base;
    }
  } catch {
    /* use raw text */
  }
  return responseText || "Twilio rejected the message.";
}

/**
 * Sends an SMS via Twilio with a 10-second timeout.
 */
export async function sendSms(args: SmsArgs): Promise<SmsSendResult> {
  const validationError = validateSmsRecipient(args.to);
  if (validationError) {
    return { sent: false, error: validationError };
  }

  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_PHONE_NUMBER?.trim();
  const to = normalizeSmsPhone(args.to);

  if (!sid || !token || !from) {
    console.info(`[sms] -> ${to}: ${args.body}`);
    return {
      sent: false,
      error: "SMS not configured. Please add Twilio credentials.",
    };
  }

  try {
    const res = await fetchWithTimeout(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString(
            "base64"
          )}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ From: from, To: to, Body: args.body }),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      console.error("[twilio] failed to send SMS", text);
      return {
        sent: false,
        error: "SMS failed to send. Please check Twilio config.",
      };
    }

    return { sent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "SMS failed to send.";
    console.error("[twilio] send error", message);
    return {
      sent: false,
      error: "SMS failed to send. Please check Twilio config.",
    };
  }
}
