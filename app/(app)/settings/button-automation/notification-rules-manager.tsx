"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Mail, MessageSquare, Pencil, Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import {
  DEFAULT_NOTIFICATION_EMAIL_BODY,
  DEFAULT_NOTIFICATION_EMAIL_SUBJECT,
  DEFAULT_NOTIFICATION_SMS_BODY,
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showStaffPicker = recipient === "staff" || recipient === "both";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const payload = {
      name,
      trigger,
      column_id: trigger === "on_job_created" ? null : (columnId || null),
      recipient,
      send_email: sendEmail,
      send_sms: sendSms,
      email_subject: emailSubject,
      email_body: emailBody,
      sms_body: smsBody,
      sms_to_phone: smsToPhone.trim(),
      recipient_mode: staffRecipients.mode,
      recipient_roles: staffRecipients.roles,
      recipient_users: staffRecipients.userIds,
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
