import "server-only";

import { loadOrderExportData } from "@/lib/button-automation-order-data";
import {
  buildNotificationRuleTemplateContext,
  renderNotificationRuleTemplate,
} from "@/lib/notification-rules";
import { sendTransactionalEmail } from "@/lib/email";
import { buildNotificationRuleEmailHtml } from "@/lib/notification-messages";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  normalizeSmsPhone,
  sendSms,
  validateSmsRecipient,
} from "@/lib/sms";
import type { NotificationRule, NotificationRuleRecipient } from "@/lib/types";

function uniqueStrings(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v?.trim())))];
}

interface StaffProfile {
  id: string;
  email: string | null;
  role: string;
}

/**
 * Load staff profiles for a tenant filtered by the rule's recipient_mode.
 *
 * mode: 'all'         → all staff profiles
 * mode: 'roles'       → profiles where role is in recipient_roles
 * mode: 'individuals' → profiles where id is in recipient_users
 */
async function loadStaffProfiles(
  supabase: ReturnType<typeof createAdminClient>,
  tenantId: string,
  rule: NotificationRule
): Promise<StaffProfile[]> {
  const mode = rule.recipient_mode ?? "all";

  if (mode === "individuals") {
    const ids = rule.recipient_users ?? [];
    if (ids.length === 0) return [];
    const { data } = await supabase
      .from("profiles")
      .select("id, email:auth_email, role:memberships!inner(role)")
      .eq("memberships.tenant_id", tenantId)
      .in("id", ids);
    // profiles table may not expose email directly; fetch from memberships + auth.users via admin
    // Simpler: query memberships joined to profiles for email
    return await loadStaffByIds(supabase, tenantId, ids);
  }

  if (mode === "roles") {
    const roles = rule.recipient_roles ?? [];
    if (roles.length === 0) return [];
    return await loadStaffByRoles(supabase, tenantId, roles);
  }

  // mode === 'all'
  return await loadAllStaff(supabase, tenantId);
}

async function loadStaffByIds(
  supabase: ReturnType<typeof createAdminClient>,
  tenantId: string,
  ids: string[]
): Promise<StaffProfile[]> {
  const { data } = await supabase
    .from("memberships")
    .select("user_id, role")
    .eq("tenant_id", tenantId)
    .in("user_id", ids);
  if (!data?.length) return [];
  return fetchProfileEmails(supabase, tenantId, data);
}

async function loadStaffByRoles(
  supabase: ReturnType<typeof createAdminClient>,
  tenantId: string,
  roles: string[]
): Promise<StaffProfile[]> {
  const { data } = await supabase
    .from("memberships")
    .select("user_id, role")
    .eq("tenant_id", tenantId)
    .in("role", roles);
  if (!data?.length) return [];
  return fetchProfileEmails(supabase, tenantId, data);
}

async function loadAllStaff(
  supabase: ReturnType<typeof createAdminClient>,
  tenantId: string
): Promise<StaffProfile[]> {
  const { data } = await supabase
    .from("memberships")
    .select("user_id, role")
    .eq("tenant_id", tenantId);
  if (!data?.length) return [];
  return fetchProfileEmails(supabase, tenantId, data);
}

async function fetchProfileEmails(
  supabase: ReturnType<typeof createAdminClient>,
  _tenantId: string,
  memberships: { user_id: string; role: string }[]
): Promise<StaffProfile[]> {
  const ids = memberships.map((m) => m.user_id);

  // Try profiles table first.
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email")
    .in("id", ids);

  const emailMap = new Map(
    ((profiles ?? []) as { id: string; email: string | null }[])
      .filter((p) => p.email)
      .map((p) => [p.id, p.email])
  );

  // Profiles table often lacks email — fall back to auth for any missing ones.
  const missingIds = ids.filter((id) => !emailMap.has(id));
  await Promise.all(
    missingIds.map(async (id) => {
      const { data } = await supabase.auth.admin.getUserById(id);
      if (data?.user?.email) {
        emailMap.set(id, data.user.email);
      }
    })
  );

  return memberships.map((m) => ({
    id: m.user_id,
    email: emailMap.get(m.user_id) ?? null,
    role: m.role,
  }));
}

function resolveRecipients(
  recipient: NotificationRuleRecipient,
  data: Awaited<ReturnType<typeof loadOrderExportData>>,
  staffProfiles: StaffProfile[]
): { emails: string[]; phones: string[] } {
  if (!data) return { emails: [], phones: [] };

  const emails: string[] = [];
  const phones: string[] = [];

  if (recipient === "customer" || recipient === "both") {
    if (data.customerEmail) emails.push(data.customerEmail);
    if (data.customerPhone) phones.push(data.customerPhone);
  }

  if (recipient === "staff" || recipient === "both") {
    for (const profile of staffProfiles) {
      if (profile.email) emails.push(profile.email);
    }
    // Fall back to legacy assignedToEmail if no profiles loaded (e.g. old rows)
    if (staffProfiles.length === 0 && data.assignedToEmail) {
      emails.push(data.assignedToEmail);
    }
  }

  return {
    emails: uniqueStrings(emails),
    phones: uniqueStrings(phones),
  };
}

/** Returns true when a Supabase/PostgREST error is because the trigger column
 *  doesn't exist yet (migration 0027 not yet applied). */
function isMissingTriggerColumn(error: { message?: string } | null): boolean {
  const msg = error?.message?.toLowerCase() ?? "";
  return (
    (msg.includes("trigger") && msg.includes("column")) ||
    (msg.includes("trigger") && msg.includes("schema cache"))
  );
}

export async function fireNotificationRules(
  orderId: string,
  newColumnId: string,
  tenantId: string
): Promise<void> {
  const supabase = createAdminClient();

  // Try filtering by trigger (requires migration 0027). If the column doesn't
  // exist yet, fall back to the pre-migration query so existing rules keep
  // working while the migration is pending.
  let rulesResult = await supabase
    .from("notification_rules")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("enabled", true)
    .eq("trigger", "on_enter_column")
    .or(`column_id.eq.${newColumnId},column_id.is.null`);

  if (rulesResult.error && isMissingTriggerColumn(rulesResult.error)) {
    console.warn("[NotifRule] trigger column missing — using legacy query (run migration 0027)");
    // Migration not yet applied — fall back to legacy query (no trigger filter).
    rulesResult = await supabase
      .from("notification_rules")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("enabled", true)
      .or(`column_id.eq.${newColumnId},column_id.is.null`);
  }

  const { data: rules, error: rulesError } = rulesResult;

  if (rulesError) {
    console.error("[NotifRule] rules query error:", rulesError.message);
    if (rulesError.message.toLowerCase().includes("notification_rules")) {
      return;
    }
    throw rulesError;
  }

  console.log(`[NotifRule] on_enter_column: ${rules?.length ?? 0} rule(s) for column ${newColumnId}`);
  if (!rules?.length) return;

  const { data: tenant } = await supabase
    .from("tenants")
    .select("name")
    .eq("id", tenantId)
    .maybeSingle();

  const exportData = await loadOrderExportData(
    supabase,
    orderId,
    tenantId,
    tenant?.name ?? "Workflow"
  );
  if (!exportData) {
    console.warn(`[NotifRule] loadOrderExportData returned null for order ${orderId}`);
    return;
  }

  // Ensure column name reflects the destination column after move.
  const { data: column } = await supabase
    .from("board_columns")
    .select("name")
    .eq("id", newColumnId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (column?.name) {
    exportData.columnName = column.name as string;
  }

  const movedAt = new Date().toISOString();
  const templateContext = buildNotificationRuleTemplateContext(exportData, {
    columnId: newColumnId,
    tenantId,
    movedAt,
  });

  for (const rule of rules as NotificationRule[]) {
    // Resolve staff profiles when the rule targets staff.
    let staffProfiles: StaffProfile[] = [];
    if (rule.recipient === "staff" || rule.recipient === "both") {
      staffProfiles = await loadStaffProfiles(supabase, tenantId, rule).catch(() => []);
    }

    const { emails, phones: recipientPhones } = resolveRecipients(rule.recipient, exportData, staffProfiles);

    // If a fixed SMS contact number is set on the rule, send only to that number.
    // Otherwise fall back to phone(s) resolved from the order.
    const phones = rule.sms_to_phone?.trim()
      ? [rule.sms_to_phone.trim()]
      : recipientPhones;

    console.log(
      `[NotifRule] rule "${rule.name}" recipient=${rule.recipient}` +
      ` customerEmail=${exportData.customerEmail ?? "none"}` +
      ` sms_to_phone=${rule.sms_to_phone || "none"}` +
      ` emails=[${emails.join(", ")}] phones=[${phones.join(", ")}]`
    );

    if ((rule.send_email && emails.length === 0) && (!rule.send_sms || phones.length === 0)) {
      console.warn(`[NotifRule] rule ${rule.id} (${rule.name}): no recipient email/phone found — skipping`);
    }

    if (rule.send_email && emails.length > 0) {
      const subject = renderNotificationRuleTemplate(
        rule.email_subject,
        templateContext
      );
      const text = renderNotificationRuleTemplate(
        rule.email_body,
        templateContext
      );
      const html = buildNotificationRuleEmailHtml(text, templateContext.order_number);

      for (const to of emails) {
        const result = await sendTransactionalEmail({ to, subject, html, text }).catch(
          (err: unknown) => ({ sent: false, error: err instanceof Error ? err.message : String(err) })
        );
        if (!result.sent) {
          console.error(`[NotifRule] email failed rule ${rule.id} → ${to}:`, result.error);
        }
      }
    }

    if (rule.send_sms && phones.length > 0) {
      const smsText = renderNotificationRuleTemplate(
        rule.sms_body,
        templateContext
      );

      for (const raw of phones) {
        const validationError = validateSmsRecipient(raw);
        if (validationError) {
          console.warn(`[NotifRule] SMS skipped — ${validationError} (number: ${raw})`);
          continue;
        }
        const to = normalizeSmsPhone(raw);
        await sendSms({ to, body: smsText }).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[NotifRule] SMS error rule ${rule.id}:`, message);
        });
      }
    }

    if (rule.send_webhook && rule.webhook_url?.trim()) {
      const renderedBody = renderNotificationRuleTemplate(
        rule.webhook_body_template || "{}",
        templateContext
      );
      await fetch(rule.webhook_url.trim(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(rule.webhook_headers ?? {}),
        },
        body: renderedBody,
      }).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[NotifRule webhook] "${rule.name}" failed:`, message);
      });
    }
  }
}

export async function fireNewJobNotificationRules(
  orderId: string,
  columnId: string,
  tenantId: string
): Promise<void> {
  const supabase = createAdminClient();

  const { data: rules, error: rulesError } = await supabase
    .from("notification_rules")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("enabled", true)
    .eq("trigger", "on_job_created");

  if (rulesError) {
    // If the trigger column doesn't exist yet, there are no on_job_created
    // rules to fire — silently skip rather than throwing.
    if (
      isMissingTriggerColumn(rulesError) ||
      rulesError.message.toLowerCase().includes("notification_rules")
    ) {
      return;
    }
    throw rulesError;
  }

  if (!rules?.length) return;

  const { data: tenant } = await supabase
    .from("tenants")
    .select("name")
    .eq("id", tenantId)
    .maybeSingle();

  const exportData = await loadOrderExportData(
    supabase,
    orderId,
    tenantId,
    tenant?.name ?? "Workflow"
  );
  if (!exportData) return;

  const { data: column } = await supabase
    .from("board_columns")
    .select("name")
    .eq("id", columnId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (column?.name) {
    exportData.columnName = column.name as string;
  }

  const movedAt2 = new Date().toISOString();
  const templateContext = buildNotificationRuleTemplateContext(exportData, {
    columnId: columnId,
    tenantId,
    movedAt: movedAt2,
  });

  for (const rule of rules as NotificationRule[]) {
    let staffProfiles: StaffProfile[] = [];
    if (rule.recipient === "staff" || rule.recipient === "both") {
      staffProfiles = await loadStaffProfiles(supabase, tenantId, rule).catch(() => []);
    }

    const { emails, phones: recipientPhones2 } = resolveRecipients(rule.recipient, exportData, staffProfiles);
    const phones2 = rule.sms_to_phone?.trim() ? [rule.sms_to_phone.trim()] : recipientPhones2;

    if (rule.send_email && emails.length > 0) {
      const subject = renderNotificationRuleTemplate(rule.email_subject, templateContext);
      const text = renderNotificationRuleTemplate(rule.email_body, templateContext);
      const html = buildNotificationRuleEmailHtml(text, templateContext.order_number);

      for (const to of emails) {
        const result = await sendTransactionalEmail({ to, subject, html, text }).catch(
          (err: unknown) => ({ sent: false, error: err instanceof Error ? err.message : String(err) })
        );
        if (!result.sent) {
          console.error(`[NotifRule] email failed rule ${rule.id} → ${to}:`, result.error);
        }
      }
    }

    if (rule.send_sms && phones2.length > 0) {
      const smsText2 = renderNotificationRuleTemplate(rule.sms_body, templateContext);

      for (const raw of phones2) {
        const validationError = validateSmsRecipient(raw);
        if (validationError) {
          console.warn(`[NotifRule] SMS skipped — ${validationError} (number: ${raw})`);
          continue;
        }
        const to = normalizeSmsPhone(raw);
        await sendSms({ to, body: smsText2 }).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[NotifRule] SMS error rule ${rule.id}:`, message);
        });
      }
    }

    if (rule.send_webhook && rule.webhook_url?.trim()) {
      const renderedBody2 = renderNotificationRuleTemplate(
        rule.webhook_body_template || "{}",
        templateContext
      );
      await fetch(rule.webhook_url.trim(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(rule.webhook_headers ?? {}),
        },
        body: renderedBody2,
      }).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[NotifRule webhook] "${rule.name}" failed:`, message);
      });
    }
  }
}
