import { google } from "googleapis";

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const DEFAULT_FROM = "noreply@bazaarprinting.com";

export type GmailSendParams = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export type GmailSendResult = { sent: boolean; error?: string };

type ServiceAccount = {
  client_email?: string;
  private_key?: string;
};

export function gmailFromAddress(): string {
  return (
    process.env.GMAIL_FROM_EMAIL?.trim() || DEFAULT_FROM
  ).toLowerCase();
}

export function gmailFromHeader(): string {
  const email = gmailFromAddress();
  const name = process.env.GMAIL_FROM_NAME?.trim() || "Bazaar Printing";
  return `${name} <${email}>`;
}

function parseServiceAccountJson(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const decoded = raw.startsWith("{")
      ? raw
      : Buffer.from(raw, "base64").toString("utf8");
    return JSON.parse(decoded) as ServiceAccount;
  } catch {
    return null;
  }
}

export function isGmailSendConfigured(): boolean {
  const sa = parseServiceAccountJson();
  if (sa?.client_email && sa.private_key) return true;
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CLIENT_SECRET?.trim() &&
      process.env.GMAIL_REFRESH_TOKEN?.trim()
  );
}

function encodeSubject(subject: string): string {
  if (/^[\x20-\x7E]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
}

/** RFC 2822 message for Gmail `users.messages.send`. */
export function encodeGmailRawMessage(params: GmailSendParams & { from: string }): string {
  const boundary = `wf_${Date.now().toString(36)}`;
  const textBody = params.text?.trim()
    ? params.text
    : params.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const raw = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    `Subject: ${encodeSubject(params.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(textBody, "utf8").toString("base64"),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(params.html, "utf8").toString("base64"),
    `--${boundary}--`,
    "",
  ].join("\r\n");
  return Buffer.from(raw, "utf8").toString("base64url");
}

async function gmailClient() {
  const sa = parseServiceAccountJson();
  if (sa?.client_email && sa.private_key) {
    const key = sa.private_key.includes("\\n")
      ? sa.private_key.replace(/\\n/g, "\n")
      : sa.private_key;
    const auth = new google.auth.JWT({
      email: sa.client_email.trim(),
      key,
      scopes: [GMAIL_SEND_SCOPE],
      subject: gmailFromAddress(),
    });
    return google.gmail({ version: "v1", auth });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN?.trim();
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Gmail not configured. Add GOOGLE_SERVICE_ACCOUNT_JSON (domain-wide send as GMAIL_FROM_EMAIL) or GMAIL_REFRESH_TOKEN."
    );
  }
  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: "v1", auth });
}

export async function sendViaGmailApi(
  params: GmailSendParams
): Promise<GmailSendResult> {
  if (!isGmailSendConfigured()) {
    return {
      sent: false,
      error:
        "Email not configured. Add GOOGLE_SERVICE_ACCOUNT_JSON or GMAIL_REFRESH_TOKEN.",
    };
  }

  try {
    const gmail = await gmailClient();
    const res = await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: encodeGmailRawMessage({
          ...params,
          from: gmailFromHeader(),
        }),
      },
    });
    if (!res.data.id) {
      return { sent: false, error: "Email failed. Gmail did not return a message id." };
    }
    return { sent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Email failed to send.";
    console.error("[gmail] send error", message);
    return {
      sent: false,
      error: message.includes("invalid_grant")
        ? "Email failed. Gmail refresh token is invalid — reconnect Noreply@bazaarprinting.com."
        : message.includes("unauthorized_client") || message.includes("unauthorized")
          ? "Email failed. Enable Gmail API domain-wide delegation for noreply@bazaarprinting.com."
          : "Email failed. Check Gmail API configuration.",
    };
  }
}
