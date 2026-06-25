import { buildBrandedEmailLayout } from "@/lib/notification-messages";

export function passwordResetSubject(tenantName: string) {
  return `Reset your password for ${tenantName} on Workflow`;
}

export function buildPasswordResetEmailBody(params: {
  tenantName: string;
  resetUrl: string;
  fullName?: string | null;
}) {
  const greeting = params.fullName?.trim()
    ? `Hi ${params.fullName.trim()},`
    : "Hi there,";
  const workspace = params.tenantName.trim() || "a workspace";

  return [
    greeting,
    `An admin at ${workspace} has sent you a password reset link.`,
    `Use the link below to set a new password:`,
    ``,
    params.resetUrl,
    `This link expires in 24 hours.`,
    `Thank you,\n${workspace} Team`,
  ].join("\n");
}

export function buildPasswordResetEmailHtml(params: {
  tenantName: string;
  resetUrl: string;
  fullName?: string | null;
}) {
  const tenantName = escapeHtml(params.tenantName.trim() || "Workflow");
  const inviteeName = params.fullName?.trim()
    ? escapeHtml(params.fullName.trim())
    : "there";
  const link = escapeHtml(params.resetUrl);

  const bodyHtml = [
    `<p style="margin:0 0 12px; font-size:14px; color:#374151; line-height:1.7;">Hi ${inviteeName},</p>`,
    `<p style="margin:0 0 20px; font-size:14px; color:#374151; line-height:1.7;">An admin at <strong>${tenantName}</strong> has sent you a password reset link. Click below to set a new password.</p>`,
    `<p style="margin:0 0 20px;"><a href="${link}" style="display:inline-block; background:#2563EB; color:#ffffff; text-decoration:none; padding:10px 22px; border-radius:6px; font-size:14px; font-weight:500;">Reset password</a></p>`,
    `<hr style="border:none; border-top:1px solid #f3f4f6; margin:0 0 16px;" />`,
    `<p style="margin:0 0 6px; font-size:13px; color:#9ca3af;">Or copy this link:</p>`,
    `<p style="margin:0 0 16px;"><a href="${link}" style="color:#2563EB; font-size:13px; word-break:break-all;">${link}</a></p>`,
    `<hr style="border:none; border-top:1px solid #f3f4f6; margin:0 0 16px;" />`,
    `<p style="margin:0; font-size:13px; color:#9ca3af;">If you didn't request this, you can ignore this email.</p>`,
  ].join("");

  return buildBrandedEmailLayout({
    contextLabel: "Password reset",
    bodyHtml,
    emailTitle: passwordResetSubject(params.tenantName),
  });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function teamInviteSubject(tenantName: string) {
  return `You've been invited to join ${tenantName} on Workflow`;
}

export function buildTeamInviteEmailBody(params: {
  tenantName: string;
  inviteUrl: string;
  fullName?: string | null;
}) {
  const greeting = params.fullName?.trim()
    ? `Hi ${params.fullName.trim()},`
    : "Hi there,";
  const workspace = params.tenantName.trim() || "a workspace";

  return [
    greeting,
    `You've been invited to join ${workspace} on Workflow.`,
    `Use the link below to create your account and set your password:`,
    ``,
    params.inviteUrl,
    `This link expires in 24 hours.`,
    `Thank you,\n${workspace} Team`,
  ].join("\n");
}

export function buildTeamInviteEmailHtml(params: {
  tenantName: string;
  inviteUrl: string;
  fullName?: string | null;
}) {
  const tenantName = escapeHtml(params.tenantName.trim() || "Workflow");
  const inviteeName = params.fullName?.trim()
    ? escapeHtml(params.fullName.trim())
    : "there";
  const link = escapeHtml(params.inviteUrl);

  const bodyHtml = [
    `<p style="margin:0 0 12px; font-size:14px; color:#374151; line-height:1.7;">Hi ${inviteeName},</p>`,
    `<p style="margin:0 0 20px; font-size:14px; color:#374151; line-height:1.7;">You've been invited to join <strong>${tenantName}</strong> on Workflow. Click below to create your account and set your password.</p>`,
    `<p style="margin:0 0 20px;"><a href="${link}" style="display:inline-block; background:#2563EB; color:#ffffff; text-decoration:none; padding:10px 22px; border-radius:6px; font-size:14px; font-weight:500;">Accept invite</a></p>`,
    `<hr style="border:none; border-top:1px solid #f3f4f6; margin:0 0 16px;" />`,
    `<p style="margin:0 0 6px; font-size:13px; color:#9ca3af;">Or copy this link:</p>`,
    `<p style="margin:0 0 16px;"><a href="${link}" style="color:#2563EB; font-size:13px; word-break:break-all;">${link}</a></p>`,
    `<hr style="border:none; border-top:1px solid #f3f4f6; margin:0 0 16px;" />`,
    `<p style="margin:0; font-size:13px; color:#9ca3af;">If you didn't expect this invitation, you can ignore this email.</p>`,
  ].join("");

  return buildBrandedEmailLayout({
    contextLabel: "Team invite",
    bodyHtml,
    emailTitle: teamInviteSubject(params.tenantName),
  });
}
