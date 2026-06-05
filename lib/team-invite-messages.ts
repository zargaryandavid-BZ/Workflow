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
  const workspace = escapeHtml(params.tenantName.trim() || "Workflow");
  const greeting = params.fullName?.trim()
    ? `Hi ${escapeHtml(params.fullName.trim())},`
    : "Hi there,";
  const link = escapeHtml(params.inviteUrl);

  const bodyHtml = [
    `<p style="margin:0 0 10px;font-size:15px;line-height:1.45;color:#334155;">${greeting}</p>`,
    `<p style="margin:0 0 10px;font-size:15px;line-height:1.45;color:#334155;">You've been invited to join <strong>${workspace}</strong> on Workflow.</p>`,
    `<p style="margin:0 0 10px;font-size:15px;line-height:1.45;color:#334155;">Click the button below to create your account and set your password.</p>`,
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 12px;"><tr><td style="border-radius:6px;background:#1d4ed8;"><a href="${link}" style="display:inline-block;padding:10px 18px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Accept invite</a></td></tr></table>`,
    `<p style="margin:0 0 10px;padding:8px 10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;line-height:1.35;color:#64748b;">Or copy this link:<br><a href="${link}" style="color:#1d4ed8;word-break:break-all;text-decoration:underline;">${link}</a></p>`,
    `<p style="margin:0 0 10px;font-size:12px;line-height:1.35;color:#94a3b8;">This link expires in 24 hours.</p>`,
    `<p style="margin:0;font-size:14px;line-height:1.4;color:#475569;">Thank you,<br><strong style="color:#1e293b;">${workspace} Team</strong></p>`,
  ].join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;line-height:1.45;color:#1e293b;-webkit-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;">
    <tr>
      <td align="center" style="padding:16px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;">
          <tr>
            <td style="background:#1d4ed8;padding:12px 18px;font-size:14px;font-weight:600;color:#ffffff;">Team invite</td>
          </tr>
          <tr>
            <td style="padding:18px 20px;">${bodyHtml}</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
