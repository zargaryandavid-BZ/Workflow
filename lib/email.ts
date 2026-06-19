import "server-only";

import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import {
  instantlyAccountError,
  INSTANTLY_ERROR_MESSAGES,
  listInstantlyAccounts,
  normalizeEaccount,
  resolveInstantlyEaccount,
} from "@/lib/instantly";
import {
  buildApprovalEmailBody,
  buildApprovalEmailHtml,
  buildMissingInfoEmailBody,
  buildMissingInfoEmailHtml,
  missingInfoSubject,
  messageToEmailHtml,
} from "@/lib/notification-messages";
import {
  buildTeamInviteEmailBody,
  buildTeamInviteEmailHtml,
  teamInviteSubject,
} from "@/lib/team-invite-messages";

const INSTANTLY_SEND_URL = "https://api.instantly.ai/api/v2/emails/test";

interface ApprovalEmailArgs {
  to: string;
  orderTitle: string;
  tenantName: string;
  approvalUrl: string;
}

interface NotificationEmailArgs {
  to: string;
  type: "missing_info" | "customer_approval";
  orderTitle: string;
  tenantName: string;
  actionUrl: string;
  staffNote?: string | null;
  productType?: string;
  customerName?: string | null;
  subject?: string;
  htmlBody?: string;
  textBody?: string;
}

export type EmailSendResult = { sent: boolean; error?: string };

function instantlyConfig() {
  const apiKey = process.env.INSTANTLY_API_KEY?.trim();
  const from = process.env.INSTANTLY_FROM_EMAIL?.trim();
  return { apiKey, from };
}

/** True when Instantly env vars are set and a workspace sender account is configured. */
export function isCustomerEmailConfigured(): boolean {
  return Boolean(instantlyConfig().apiKey);
}

/**
 * Sends HTML email via Instantly API v2 with a 10s timeout.
 * Uses a connected workspace account (`INSTANTLY_FROM_EMAIL` as `eaccount`).
 */
async function postInstantlyEmail(
  apiKey: string,
  eaccount: string,
  params: { to: string; subject: string; html: string; text?: string }
) {
  return fetchWithTimeout(INSTANTLY_SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      eaccount,
      to_address_email_list: params.to,
      subject: params.subject,
      body: {
        html: params.html,
        text: params.text ?? undefined,
      },
    }),
  });
}

async function sendCustomerEmail(params: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<EmailSendResult> {
  const { apiKey, from } = instantlyConfig();

  if (!apiKey) {
    return {
      sent: false,
      error: "Email not configured. Add INSTANTLY_API_KEY.",
    };
  }

  const { eaccount, available } = await resolveInstantlyEaccount(from);
  if (!eaccount) {
    return {
      sent: false,
      error: instantlyAccountError(from, available),
    };
  }

  if (from && normalizeEaccount(from) !== eaccount) {
    console.info(
      `[instantly] using ${eaccount} (configured: ${normalizeEaccount(from)})`
    );
  }

  try {
    let res = await postInstantlyEmail(apiKey, eaccount, params);

    let text = await res.text();
    let json: { status?: string; error?: string; message?: string } = {};
    try {
      json = text ? (JSON.parse(text) as typeof json) : {};
    } catch {
      /* non-JSON body */
    }

    // Retry once with a fresh account list if the sender was not found.
    if (json.error === "ACC_NOT_FOUND") {
      await listInstantlyAccounts(true);
      const retry = await resolveInstantlyEaccount(from);
      if (retry.eaccount && retry.eaccount !== eaccount) {
        res = await postInstantlyEmail(apiKey, retry.eaccount, params);
        text = await res.text();
        try {
          json = text ? (JSON.parse(text) as typeof json) : {};
        } catch {
          json = {};
        }
      }
    }

    if (!res.ok) {
      console.error("[instantly] failed to send email", res.status, text);
      return {
        sent: false,
        error:
          json.message ??
          (res.status === 401
            ? "Email failed. Check INSTANTLY_API_KEY."
            : "Email failed. Check Instantly configuration."),
      };
    }

    if (json.error) {
      console.error("[instantly] send rejected", json.error);
      if (json.error === "ACC_NOT_FOUND") {
        return {
          sent: false,
          error: instantlyAccountError(from, available),
        };
      }
      const label =
        INSTANTLY_ERROR_MESSAGES[json.error] ?? `Email failed (${json.error})`;
      return { sent: false, error: label };
    }

    if (json.status !== "success") {
      console.error("[instantly] unexpected response", text);
      return {
        sent: false,
        error: "Email failed. Check Instantly configuration.",
      };
    }

    return { sent: true };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Email failed to send.";
    console.error("[instantly] send error", message);
    return {
      sent: false,
      error: message.includes("timed out")
        ? "Email failed. Request timed out — check Instantly status."
        : "Email failed. Check INSTANTLY_API_KEY.",
    };
  }
}

/** Sends the customer approval email via Instantly. When not configured, logs the link. */
export async function sendApprovalEmail(
  args: ApprovalEmailArgs
): Promise<EmailSendResult & { url?: string }> {
  const html = buildApprovalEmailHtml({
    customerName: "there",
    productType: "order",
    orderNumber: args.orderTitle,
    approvalLink: args.approvalUrl,
    teamName: `${args.tenantName} Team`,
  });
  const text = buildApprovalEmailBody({
    customerName: "there",
    productType: "order",
    orderNumber: args.orderTitle,
    approvalLink: args.approvalUrl,
    teamName: `${args.tenantName} Team`,
  });

  const result = await sendCustomerEmail({
    to: args.to,
    subject: `Approval needed: ${args.orderTitle}`,
    html,
    text,
  });

  if (!result.sent) {
    console.info(
      `[approval-link] ${args.tenantName} -> ${args.to}: ${args.approvalUrl}`
    );
    return { ...result, url: args.approvalUrl };
  }

  return { ...result, url: args.approvalUrl };
}

/** Sends a customer notification email with a tokenized action link. */
export async function sendNotificationEmail(
  args: NotificationEmailArgs
): Promise<EmailSendResult & { url?: string }> {
  const isApproval = args.type === "customer_approval";
  const subject =
    args.subject ??
    (isApproval
      ? `Action required: please approve your proof — ${args.orderTitle}`
      : missingInfoSubject(args.orderTitle));

  let html: string;
  let text: string | undefined;

  if (args.htmlBody) {
    html = args.htmlBody.includes("<")
      ? args.htmlBody
      : messageToEmailHtml(args.htmlBody);
  } else if (args.type === "missing_info") {
    html = buildMissingInfoEmailHtml({
      customerName: args.customerName?.trim() || "there",
      productType: args.productType ?? "order",
      orderNumber: args.orderTitle,
      replyLink: args.actionUrl,
      staffNote: args.staffNote,
      teamName: `${args.tenantName} Team`,
    });
  } else if (args.type === "customer_approval") {
    html = buildApprovalEmailHtml({
      customerName: args.customerName?.trim() || "there",
      productType: args.productType ?? "order",
      orderNumber: args.orderTitle,
      approvalLink: args.actionUrl,
      internalNote: args.staffNote,
      teamName: `${args.tenantName} Team`,
    });
  } else {
    html = messageToEmailHtml(args.htmlBody ?? "");
  }

  if (args.type === "missing_info") {
    text = buildMissingInfoEmailBody({
      customerName: args.customerName?.trim() || "there",
      productType: args.productType ?? "order",
      orderNumber: args.orderTitle,
      replyLink: args.actionUrl,
      staffNote: args.staffNote,
      teamName: `${args.tenantName} Team`,
    });
  } else if (args.type === "customer_approval") {
    text =
      args.textBody ??
      buildApprovalEmailBody({
        customerName: args.customerName?.trim() || "there",
        productType: args.productType ?? "order",
        orderNumber: args.orderTitle,
        approvalLink: args.actionUrl,
        internalNote: args.staffNote,
        teamName: `${args.tenantName} Team`,
      });
  }

  const result = await sendCustomerEmail({
    to: args.to,
    subject,
    html,
    text,
  });

  if (!result.sent) {
    console.info(
      `[notification-link:${args.type}] ${args.tenantName} -> ${args.to}: ${args.actionUrl}`
    );
    return { ...result, url: args.actionUrl };
  }

  return { ...result, url: args.actionUrl };
}

/** Sends a team invite email via Instantly with the Supabase-generated signup link. */
export async function sendTeamInviteEmail(args: {
  to: string;
  tenantName: string;
  inviteUrl: string;
  fullName?: string | null;
}): Promise<EmailSendResult> {
  const html = buildTeamInviteEmailHtml({
    tenantName: args.tenantName,
    inviteUrl: args.inviteUrl,
    fullName: args.fullName,
  });
  const text = buildTeamInviteEmailBody({
    tenantName: args.tenantName,
    inviteUrl: args.inviteUrl,
    fullName: args.fullName,
  });

  const result = await sendCustomerEmail({
    to: args.to,
    subject: teamInviteSubject(args.tenantName),
    html,
    text,
  });

  if (!result.sent) {
    console.info(
      `[team-invite] ${args.tenantName} -> ${args.to}: ${args.inviteUrl}`
    );
  }

  return result;
}

/** Generic transactional email via Instantly (staff / automation use). */
export async function sendTransactionalEmail(params: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<EmailSendResult> {
  return sendCustomerEmail(params);
}
