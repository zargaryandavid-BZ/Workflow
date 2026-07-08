"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Link2, Mail, MessageSquare, Pencil, Plus, Trash2, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import {
  DEFAULT_NOTIFICATION_EMAIL_BODY,
  DEFAULT_NOTIFICATION_EMAIL_SUBJECT,
  DEFAULT_NOTIFICATION_SMS_BODY,
  DEFAULT_NOTIFICATION_WEBHOOK_BODY,
  NOTIFICATION_RULE_RECIPIENT_LABELS,
  NOTIFICATION_RULE_TEMPLATE_VARS,
  NOTIFICATION_RULE_TRIGGER_LABELS,
} from "@/lib/notification-rules";
import { RoleOrIndividualPicker, type PickerValue, type TeamMember } from "@/components/RoleOrIndividualPicker";
import { cn } from "@/lib/utils";
import type { BoardColumn, NotificationRule, NotificationRuleRecipient, NotificationRuleTrigger } from "@/lib/types";

interface Props {
  initialRules: NotificationRule[];
  columns: BoardColumn[];
  members: TeamMember[];
  disabled?: boolean;
}

export function NotificationRulesManager({
  initialRules,
  columns,
  members,
  disabled = false,
}: Props) {
  const router = useRouter();
  const [rules, setRules] = useState(initialRules);
  const [editing, setEditing] = useState<NotificationRule | "new" | null>(null);
  const [deleting, setDeleting] = useState<NotificationRule | null>(null);

  useEffect(() => setRules(initialRules), [initialRules]);

  async function toggleEnabled(rule: NotificationRule) {
    await fetch(`/api/notification-rules/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !rule.enabled }),
    });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing("new")} disabled={disabled}>
          <Plus className="h-4 w-4" /> Add Rule
        </Button>
      </div>

      {rules.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-400">
          No notification rules yet. Add your first rule to auto-notify customers
          when orders move.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              columns={columns}
              onEdit={() => setEditing(rule)}
              onDelete={() => setDeleting(rule)}
              onToggle={() => toggleEnabled(rule)}
            />
          ))}
        </ul>
      )}

      {editing ? (
        <RuleEditor
          rule={editing === "new" ? null : editing}
          columns={columns}
          members={members}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}

      {deleting ? (
        <DeleteRuleDialog
          rule={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function RuleRow({
  rule,
  columns,
  onEdit,
  onDelete,
  onToggle,
}: {
  rule: NotificationRule;
  columns: BoardColumn[];
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const columnLabel = rule.column_id
    ? (columns.find((c) => c.id === rule.column_id)?.name ?? "Unknown column")
    : "Any column";

  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5",
        !rule.enabled && "opacity-60"
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium text-slate-800">{rule.name}</span>
          <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
          <span className="text-slate-600">{columnLabel}</span>
        </div>
        <div className="mt-1 flex items-center gap-2 text-slate-400">
          {rule.send_email ? (
            <span title="Email enabled">
              <Mail className="h-3.5 w-3.5" />
            </span>
          ) : null}
          {rule.send_sms ? (
            <span title="SMS enabled">
              <MessageSquare className="h-3.5 w-3.5" />
            </span>
          ) : null}
          {rule.send_webhook ? (
            <span title="Webhook enabled">
              <Link2 className="h-3.5 w-3.5" />
            </span>
          ) : null}
          <span className="text-[10px] text-slate-500">
            {NOTIFICATION_RULE_RECIPIENT_LABELS[rule.recipient]}
          </span>
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs text-slate-600">
        <input
          type="checkbox"
          checked={rule.enabled}
          onChange={onToggle}
          className="rounded border-slate-300"
        />
        Enabled
      </label>

      <button
        type="button"
        onClick={onEdit}
        className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        aria-label="Edit rule"
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="rounded p-1.5 text-slate-400 hover:bg-red-100 hover:text-red-600"
        aria-label="Delete rule"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );
}

function RuleEditor({
  rule,
  columns,
  members,
  onClose,
  onSaved,
}: {
  rule: NotificationRule | null;
  columns: BoardColumn[];
  members: TeamMember[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(rule?.name ?? "");
  const [trigger, setTrigger] = useState<NotificationRuleTrigger>(
    rule?.trigger ?? "on_enter_column"
  );
  const [columnId, setColumnId] = useState(rule?.column_id ?? "");
  const [recipient, setRecipient] = useState<NotificationRuleRecipient>(
    rule?.recipient ?? "customer"
  );
  const [staffRecipients, setStaffRecipients] = useState<PickerValue>({
    mode: rule?.recipient_mode ?? "all",
    roles: rule?.recipient_roles ?? [],
    userIds: rule?.recipient_users ?? [],
  });
  const [sendEmail, setSendEmail] = useState(rule?.send_email ?? true);
  const [sendSms, setSendSms] = useState(rule?.send_sms ?? false);
  const [sendWebhook, setSendWebhook] = useState(rule?.send_webhook ?? false);
  const [emailSubject, setEmailSubject] = useState(
    rule?.email_subject ?? DEFAULT_NOTIFICATION_EMAIL_SUBJECT
  );
  const [emailBody, setEmailBody] = useState(
    rule?.email_body ?? DEFAULT_NOTIFICATION_EMAIL_BODY
  );
  const [smsBody, setSmsBody] = useState(
    rule?.sms_body ?? DEFAULT_NOTIFICATION_SMS_BODY
  );
  const [smsToPhone, setSmsToPhone] = useState(rule?.sms_to_phone ?? "");
  const [webhookUrl, setWebhookUrl] = useState(rule?.webhook_url ?? "");
  const [webhookBodyTemplate, setWebhookBodyTemplate] = useState(
    rule?.webhook_body_template || DEFAULT_NOTIFICATION_WEBHOOK_BODY
  );
  const [webhookHeaders, setWebhookHeaders] = useState<{ key: string; value: string }[]>(
    () => Object.entries(rule?.webhook_headers ?? {}).map(([key, value]) => ({ key, value }))
  );
  const [requireAllGroupItems, setRequireAllGroupItems] = useState(
    rule?.require_all_group_items ?? false
  );
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [webhookTestResult, setWebhookTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showStaffPicker = recipient === "staff" || recipient === "both";

  async function testWebhook() {
    setTestingWebhook(true);
    setWebhookTestResult(null);
    const headersObj: Record<string, string> = {};
    for (const { key, value } of webhookHeaders) {
      if (key.trim()) headersObj[key.trim()] = value;
    }
    try {
      const res = await fetch("/api/notification-rules/test-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhook_url: webhookUrl.trim(),
          webhook_body_template: webhookBodyTemplate,
          webhook_headers: headersObj,
        }),
      });
      const json = await res.json() as { ok?: boolean; status?: number; error?: string };
      if (json.ok) {
        setWebhookTestResult({ ok: true, message: `Webhook sent — got ${json.status} OK` });
      } else if (json.error) {
        setWebhookTestResult({ ok: false, message: `Could not reach endpoint: ${json.error}` });
      } else {
        setWebhookTestResult({ ok: false, message: `Webhook failed — got ${json.status ?? "unknown status"}` });
      }
    } catch {
      setWebhookTestResult({ ok: false, message: "Could not reach endpoint" });
    }
    setTestingWebhook(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const headersObj: Record<string, string> = {};
    for (const { key, value } of webhookHeaders) {
      if (key.trim()) headersObj[key.trim()] = value;
    }

    const payload = {
      name,
      trigger,
      column_id: trigger === "on_job_created" ? null : (columnId || null),
      recipient,
      send_email: sendEmail,
      send_sms: sendSms,
      send_webhook: sendWebhook,
      email_subject: emailSubject,
      email_body: emailBody,
      sms_body: smsBody,
      sms_to_phone: smsToPhone.trim(),
      webhook_url: webhookUrl.trim(),
      webhook_body_template: webhookBodyTemplate,
      webhook_headers: headersObj,
      recipient_mode: staffRecipients.mode,
      recipient_roles: staffRecipients.roles,
      recipient_users: staffRecipients.userIds,
      require_all_group_items: requireAllGroupItems,
    };

    const res = await fetch(
      rule ? `/api/notification-rules/${rule.id}` : "/api/notification-rules",
      {
        method: rule ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const json = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(json.error ?? "Failed to save");
      return;
    }
    onSaved();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={rule ? "Edit Notification Rule" : "Add Notification Rule"}
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="notification-rule-form" disabled={saving}>
            {saving ? "Saving…" : "Save Rule"}
          </Button>
        </>
      }
    >
      <form id="notification-rule-form" onSubmit={save} className="space-y-4">
        <div>
          <Label htmlFor="rule-name">Rule name</Label>
          <Input
            id="rule-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='e.g. "Customer Approval Ready"'
          />
        </div>

        <div>
          <Label htmlFor="rule-trigger">Trigger</Label>
          <Select
            id="rule-trigger"
            value={trigger}
            onChange={(e) => setTrigger(e.target.value as NotificationRuleTrigger)}
          >
            {(
              Object.entries(NOTIFICATION_RULE_TRIGGER_LABELS) as [
                NotificationRuleTrigger,
                string,
              ][]
            ).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>

        {trigger === "on_enter_column" && (
        <div>
          <Label htmlFor="rule-column">Column</Label>
          <Select
            id="rule-column"
            value={columnId}
            onChange={(e) => setColumnId(e.target.value)}
          >
            <option value="">Any column</option>
            {columns.map((col) => (
              <option key={col.id} value={col.id}>
                {col.name}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-slate-500">
            Leave blank to trigger on any column.
          </p>
        </div>
        )}

        {trigger === "on_enter_column" && (
          <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 cursor-pointer hover:bg-slate-100">
            <input
              type="checkbox"
              checked={requireAllGroupItems}
              onChange={(e) => setRequireAllGroupItems(e.target.checked)}
              className="mt-0.5 rounded border-slate-300"
            />
            <span>
              <span className="font-medium">Wait for all group items</span>
              <span className="block text-xs text-slate-500 mt-0.5">
                Only send this notification when <em>all</em> sub-items of the order group
                (e.g. XX-1, XX-2, XX-3) are in this column — not just the first one to arrive.
              </span>
            </span>
          </label>
        )}

        <div>
          <Label htmlFor="rule-recipient">Send to</Label>
          <Select
            id="rule-recipient"
            value={recipient}
            onChange={(e) =>
              setRecipient(e.target.value as NotificationRuleRecipient)
            }
          >
            {(
              Object.entries(NOTIFICATION_RULE_RECIPIENT_LABELS) as [
                NotificationRuleRecipient,
                string,
              ][]
            ).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>

        {showStaffPicker && (
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <RoleOrIndividualPicker
              label="Staff recipients"
              value={staffRecipients}
              members={members}
              onChange={setStaffRecipients}
            />
          </div>
        )}

        <div className="space-y-3 rounded-lg border border-slate-200 p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={sendEmail}
              onChange={(e) => setSendEmail(e.target.checked)}
              className="rounded border-slate-300"
            />
            Send Email
          </label>

          {sendEmail ? (
            <>
              <div>
                <Label htmlFor="rule-email-subject">Subject</Label>
                <Input
                  id="rule-email-subject"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="rule-email-body">Message</Label>
                <Textarea
                  id="rule-email-body"
                  rows={8}
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                />
              </div>
            </>
          ) : null}
        </div>

        <div className="space-y-3 rounded-lg border border-slate-200 p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={sendSms}
              onChange={(e) => setSendSms(e.target.checked)}
              className="rounded border-slate-300"
            />
            Send SMS
          </label>

          {sendSms ? (
            <>
              <div>
                <Label htmlFor="rule-sms-phone">Contact number</Label>
                <Input
                  id="rule-sms-phone"
                  type="tel"
                  value={smsToPhone}
                  onChange={(e) => setSmsToPhone(e.target.value)}
                  placeholder="+1 818 555 1234"
                />
                <p className="mt-1 text-xs text-slate-500">
                  SMS will be sent to this number. If left blank, uses the
                  customer or staff phone from the order.
                </p>
              </div>
              <div>
                <Label htmlFor="rule-sms-body">SMS message (max 160 chars)</Label>
                <Textarea
                  id="rule-sms-body"
                  rows={3}
                  maxLength={160}
                  value={smsBody}
                  onChange={(e) => setSmsBody(e.target.value)}
                />
                <p className="mt-1 text-xs text-slate-500">
                  {smsBody.length} / 160
                </p>
              </div>
            </>
          ) : null}
        </div>

        <div className="space-y-3 rounded-lg border border-slate-200 p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={sendWebhook}
              onChange={(e) => {
                setSendWebhook(e.target.checked);
                setWebhookTestResult(null);
              }}
              className="rounded border-slate-300"
            />
            Send Webhook
          </label>

          {sendWebhook ? (
            <>
              <div>
                <Label htmlFor="rule-webhook-url">Webhook URL</Label>
                <Input
                  id="rule-webhook-url"
                  type="url"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://"
                />
              </div>
              <div>
                <Label htmlFor="rule-webhook-body">Request body</Label>
                <textarea
                  id="rule-webhook-body"
                  rows={6}
                  value={webhookBodyTemplate}
                  onChange={(e) => setWebhookBodyTemplate(e.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                />
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <Label>Custom headers (optional)</Label>
                  {webhookHeaders.length < 10 ? (
                    <button
                      type="button"
                      onClick={() => setWebhookHeaders((h) => [...h, { key: "", value: "" }])}
                      className="text-xs text-slate-500 hover:text-slate-700"
                    >
                      + Add header
                    </button>
                  ) : null}
                </div>
                {webhookHeaders.length > 0 ? (
                  <div className="space-y-1.5">
                    {webhookHeaders.map((header, idx) => (
                      <div key={idx} className="flex gap-1.5">
                        <Input
                          value={header.key}
                          onChange={(e) =>
                            setWebhookHeaders((h) =>
                              h.map((row, i) => (i === idx ? { ...row, key: e.target.value } : row))
                            )
                          }
                          placeholder="Header name"
                          className="flex-1"
                        />
                        <Input
                          value={header.value}
                          onChange={(e) =>
                            setWebhookHeaders((h) =>
                              h.map((row, i) => (i === idx ? { ...row, value: e.target.value } : row))
                            )
                          }
                          placeholder="Value"
                          className="flex-1"
                        />
                        <button
                          type="button"
                          onClick={() => setWebhookHeaders((h) => h.filter((_, i) => i !== idx))}
                          className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500"
                          aria-label="Remove header"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={testingWebhook || !webhookUrl.trim()}
                  onClick={testWebhook}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {testingWebhook ? "Sending…" : "Test webhook"}
                </button>
                {webhookTestResult ? (
                  <span
                    className={cn(
                      "text-sm",
                      webhookTestResult.ok ? "text-green-600" : "text-red-600"
                    )}
                  >
                    {webhookTestResult.ok ? "✓" : "✗"} {webhookTestResult.message}
                  </span>
                ) : null}
              </div>
            </>
          ) : null}
        </div>

        <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <p className="font-medium text-slate-700">Available variables</p>
          <p className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
            {NOTIFICATION_RULE_TEMPLATE_VARS.map((v) => (
              <code key={v} className="rounded bg-white px-1">
                {v}
              </code>
            ))}
          </p>
        </div>

        {error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

function DeleteRuleDialog({
  rule,
  onClose,
  onDeleted,
}: {
  rule: NotificationRule;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setDeleting(true);
    const res = await fetch(`/api/notification-rules/${rule.id}`, {
      method: "DELETE",
    });
    setDeleting(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? "Failed to delete");
      return;
    }
    onDeleted();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Delete rule?"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button
            onClick={confirm}
            disabled={deleting}
            className="bg-red-600 hover:bg-red-700"
          >
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">
        Remove <strong>{rule.name}</strong>? This cannot be undone.
      </p>
      {error ? (
        <p className="mt-2 text-sm text-red-600">{error}</p>
      ) : null}
    </Modal>
  );
}
