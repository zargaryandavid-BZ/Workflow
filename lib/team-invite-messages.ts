import { buildBrandedEmailLayout } from "@/lib/notification-messages";
import {
  DEFAULT_MESSAGE_TEMPLATES,
  renderMessageTemplate,
  type MessageTemplateMap,
} from "@/lib/message-templates";

function templatesOrDefault(
  templates?: MessageTemplateMap | null
): MessageTemplateMap {
  return templates ?? DEFAULT_MESSAGE_TEMPLATES;
}

export type PasswordResetSubjectVars = {
  invitee_name?: string;
  reset_url?: string;
};

export function passwordResetSubject(
  tenantName: string,
  templates?: MessageTemplateMap | null,
  vars?: PasswordResetSubjectVars | null
) {
  const map = templatesOrDefault(templates);
  return renderMessageTemplate(map.password_reset_email_subject, {
    tenant_name: tenantName.trim() || "Workflow",
    invitee_name: vars?.invitee_name ?? "",
    reset_url: vars?.reset_url ?? "",
  });
}

export function buildPasswordResetEmailBody(params: {
  tenantName: string;
  resetUrl: string;
  fullName?: string | null;
  templates?: MessageTemplateMap | null;
}) {
  const map = templatesOrDefault(params.templates);
  const workspace = params.tenantName.trim() || "a workspace";
  return renderMessageTemplate(map.password_reset_email_body, {
    invitee_name: params.fullName?.trim() || "there",
    tenant_name: workspace,
    reset_url: params.resetUrl,
  });
}

export function buildPasswordResetEmailHtml(params: {
  tenantName: string;
  resetUrl: string;
  fullName?: string | null;
  templates?: MessageTemplateMap | null;
}) {
  const text = buildPasswordResetEmailBody(params);
  return buildBrandedEmailLayout({
    contextLabel: "Password reset",
    bodyHtml: plainTextToParagraphs(text),
    emailTitle: passwordResetSubject(params.tenantName, params.templates, {
      invitee_name: params.fullName?.trim() || "there",
      reset_url: params.resetUrl,
    }),
  });
}

export type TeamInviteSubjectVars = {
  invitee_name?: string;
  invite_url?: string;
};

export function teamInviteSubject(
  tenantName: string,
  templates?: MessageTemplateMap | null,
  vars?: TeamInviteSubjectVars | null
) {
  const map = templatesOrDefault(templates);
  return renderMessageTemplate(map.team_invite_email_subject, {
    tenant_name: tenantName.trim() || "Workflow",
    invitee_name: vars?.invitee_name ?? "",
    invite_url: vars?.invite_url ?? "",
  });
}

export function buildTeamInviteEmailBody(params: {
  tenantName: string;
  inviteUrl: string;
  fullName?: string | null;
  templates?: MessageTemplateMap | null;
}) {
  const map = templatesOrDefault(params.templates);
  const workspace = params.tenantName.trim() || "a workspace";
  return renderMessageTemplate(map.team_invite_email_body, {
    invitee_name: params.fullName?.trim() || "there",
    tenant_name: workspace,
    invite_url: params.inviteUrl,
  });
}

export function buildTeamInviteEmailHtml(params: {
  tenantName: string;
  inviteUrl: string;
  fullName?: string | null;
  templates?: MessageTemplateMap | null;
}) {
  const text = buildTeamInviteEmailBody(params);
  return buildBrandedEmailLayout({
    contextLabel: "Team invite",
    bodyHtml: plainTextToParagraphs(text),
    emailTitle: teamInviteSubject(params.tenantName, params.templates, {
      invitee_name: params.fullName?.trim() || "there",
      invite_url: params.inviteUrl,
    }),
  });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Escape plain text and turn URLs into anchors.
 * Linkify before inserting <br/> so escaped entities cannot glue onto hrefs
 * (e.g. `…/login<br/>This` → broken verify URL / 404).
 */
function linkifyEscapedPlainText(text: string): string {
  return text
    .split(/(https?:\/\/[^\s]+)/g)
    .map((part, index) => {
      if (index % 2 === 1) {
        const href = escapeHtml(part);
        return `<a href="${href}" style="color:#2563EB;word-break:break-all;">${href}</a>`;
      }
      return escapeHtml(part).replace(/\n/g, "<br/>");
    })
    .join("");
}

function plainTextToParagraphs(text: string): string {
  return text
    .trim()
    .split(/\n{2,}/)
    .filter(Boolean)
    .map(
      (block) =>
        `<p style="margin:0 0 12px; font-size:14px; color:#374151; line-height:1.7;">${linkifyEscapedPlainText(
          block
        )}</p>`
    )
    .join("");
}
