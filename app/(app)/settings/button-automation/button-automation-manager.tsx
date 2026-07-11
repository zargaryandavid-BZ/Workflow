"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Label, Select } from "@/components/ui/input";
import {
  BUTTON_ACTION_LABELS,
  EMAIL_RECIPIENT_LABELS,
  SMS_RECIPIENT_LABELS,
  buildButtonAutomationConfig,
  parseEmailConfig,
  parseSmsConfig,
} from "@/lib/button-automations";
import { cn } from "@/lib/utils";
import type {
  BoardColumn,
  ButtonAutomation,
  ButtonAutomationActionType,
  ButtonAutomationEmailRecipient,
  ButtonAutomationSmsRecipient,
} from "@/lib/types";

interface Props {
  initialButtons: ButtonAutomation[];
  columns: BoardColumn[];
  disabled?: boolean;
}

export function ButtonAutomationManager({
  initialButtons,
  columns,
  disabled = false,
}: Props) {
  const router = useRouter();
  const [buttons, setButtons] = useState(initialButtons);
  const [editing, setEditing] = useState<ButtonAutomation | "new" | null>(null);
  const [deleting, setDeleting] = useState<ButtonAutomation | null>(null);

  useEffect(() => setButtons(initialButtons), [initialButtons]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  async function persistOrder(next: ButtonAutomation[]) {
    setButtons(next);
    await fetch("/api/button-automations/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds: next.map((b) => b.id) }),
    });
    router.refresh();
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = buttons.findIndex((b) => b.id === active.id);
    const newIndex = buttons.findIndex((b) => b.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    persistOrder(arrayMove(buttons, oldIndex, newIndex));
  }

  async function toggleEnabled(button: ButtonAutomation) {
    await fetch(`/api/button-automations/${button.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !button.enabled }),
    });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing("new")} disabled={disabled}>
          <Plus className="h-4 w-4" /> Add Button
        </Button>
      </div>

      {buttons.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-400">
          No buttons yet. Add your first action button.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={buttons.map((b) => b.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="space-y-1.5">
              {buttons.map((button) => (
                <SortableButtonRow
                  key={button.id}
                  button={button}
                  columns={columns}
                  onEdit={() => setEditing(button)}
                  onDelete={() => setDeleting(button)}
                  onToggle={() => toggleEnabled(button)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {editing ? (
        <ButtonEditor
          button={editing === "new" ? null : editing}
          columns={columns}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}

      {deleting ? (
        <DeleteButtonDialog
          button={deleting}
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

function SortableButtonRow({
  button,
  columns,
  onEdit,
  onDelete,
  onToggle,
}: {
  button: ButtonAutomation;
  columns: BoardColumn[];
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: button.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const columnLabels =
    button.column_ids.length === 0
      ? ["All columns"]
      : button.column_ids
          .map((id) => columns.find((c) => c.id === id)?.name ?? id)
          .slice(0, 3);

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5",
        !button.enabled && "opacity-60"
      )}
    >
      <button
        type="button"
        className="cursor-grab touch-none rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <span className="text-lg leading-none">{button.icon || "⚡"}</span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-800">{button.name}</p>
        <div className="mt-1 flex flex-wrap gap-1">
          <Badge className="bg-slate-100 text-[10px] text-slate-600">
            {BUTTON_ACTION_LABELS[button.action_type]}
          </Badge>
          {columnLabels.map((label) => (
            <Badge key={label} className="text-[10px] font-normal">
              {label}
            </Badge>
          ))}
          {button.column_ids.length > 3 ? (
            <Badge className="text-[10px] font-normal">
              +{button.column_ids.length - 3}
            </Badge>
          ) : null}
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs text-slate-600">
        <input
          type="checkbox"
          checked={button.enabled}
          onChange={onToggle}
          className="rounded border-slate-300"
        />
        Enabled
      </label>

      <button
        type="button"
        onClick={onEdit}
        className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        aria-label="Edit button"
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="rounded p-1.5 text-slate-400 hover:bg-red-100 hover:text-red-600"
        aria-label="Delete button"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );
}

function ButtonEditor({
  button,
  columns,
  onClose,
  onSaved,
}: {
  button: ButtonAutomation | null;
  columns: BoardColumn[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const parsedEmail = parseEmailConfig(button?.config ?? {});
  const parsedSms = parseSmsConfig(button?.config ?? {});
  const [name, setName] = useState(button?.name ?? "");
  const [icon, setIcon] = useState(button?.icon ?? "📋");
  const [actionType, setActionType] = useState<ButtonAutomationActionType>(
    button?.action_type ?? "copy_link"
  );
  const [columnIds, setColumnIds] = useState<string[]>(button?.column_ids ?? []);
  // Email fields
  const [recipient, setRecipient] = useState<ButtonAutomationEmailRecipient>(
    parsedEmail.recipient
  );
  const [customEmail, setCustomEmail] = useState(parsedEmail.custom_email ?? "");
  const [subjectTemplate, setSubjectTemplate] = useState(
    parsedEmail.subject_template
  );
  // SMS fields
  const [smsRecipient, setSmsRecipient] = useState<ButtonAutomationSmsRecipient>(
    parsedSms.recipient
  );
  const [customPhone, setCustomPhone] = useState(parsedSms.custom_phone ?? "");
  const [smsBodyTemplate, setSmsBodyTemplate] = useState(parsedSms.body_template);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleColumn(id: string) {
    setColumnIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const emailConfig = { recipient, custom_email: customEmail || undefined, subject_template: subjectTemplate };
    const smsConfig = { recipient: smsRecipient, custom_phone: customPhone || undefined, body_template: smsBodyTemplate };
    const payload = {
      name,
      icon,
      action_type: actionType,
      column_ids: columnIds,
      config: buildButtonAutomationConfig(actionType, actionType === "send_sms" ? smsConfig : emailConfig),
    };

    const res = await fetch(
      button ? `/api/button-automations/${button.id}` : "/api/button-automations",
      {
        method: button ? "PATCH" : "POST",
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
      title={button ? "Edit Button" : "Add Button"}
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="button-automation-form" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <form id="button-automation-form" onSubmit={save} className="space-y-4">
        <div>
          <Label htmlFor="btn-name">Name</Label>
          <Input
            id="btn-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Send to Press"
          />
        </div>

        <div>
          <Label htmlFor="btn-icon">Icon</Label>
          <Input
            id="btn-icon"
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            placeholder="📋"
          />
        </div>

        <div>
          <Label htmlFor="btn-action">Action type</Label>
          <Select
            id="btn-action"
            value={actionType}
            onChange={(e) =>
              setActionType(e.target.value as ButtonAutomationActionType)
            }
          >
            <option value="copy_link">Copy Card Link</option>
            <option value="send_email">Send Email</option>
            <option value="send_sms">Send SMS</option>
            <option value="generate_pdf">Generate PDF (Job Ticket)</option>
            <option value="generate_packing_slip">Generate Packing Slip</option>
          </Select>
        </div>

        <div>
          <Label>Show in columns</Label>
          <p className="mb-2 text-xs text-slate-500">
            Leave all unchecked to show in every column.
          </p>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
            {columns.map((col) => (
              <label
                key={col.id}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={columnIds.includes(col.id)}
                  onChange={() => toggleColumn(col.id)}
                  className="rounded border-slate-300"
                />
                {col.name}
              </label>
            ))}
          </div>
        </div>

        {actionType === "send_email" ? (
          <>
            <div>
              <Label htmlFor="btn-recipient">Recipient</Label>
              <Select
                id="btn-recipient"
                value={recipient}
                onChange={(e) =>
                  setRecipient(e.target.value as ButtonAutomationEmailRecipient)
                }
              >
                {(
                  (
                    [
                      "customer",
                      "designer",
                      "custom",
                    ] as ButtonAutomationEmailRecipient[]
                  ).map((value) => (
                    <option key={value} value={value}>
                      {EMAIL_RECIPIENT_LABELS[value]}
                    </option>
                  ))
                )}
              </Select>
            </div>

            {recipient === "custom" ? (
              <div>
                <Label htmlFor="btn-custom-email">Email address</Label>
                <Input
                  id="btn-custom-email"
                  type="email"
                  required
                  value={customEmail}
                  onChange={(e) => setCustomEmail(e.target.value)}
                  placeholder="name@example.com"
                />
              </div>
            ) : null}

            <div>
              <Label htmlFor="btn-subject">Subject template</Label>
              <Input
                id="btn-subject"
                value={subjectTemplate}
                onChange={(e) => setSubjectTemplate(e.target.value)}
                placeholder="Order {{order_number}} — {{customer_name}}"
              />
            </div>
          </>
        ) : null}

        {actionType === "send_sms" ? (
          <>
            <div>
              <Label htmlFor="btn-sms-recipient">Send to</Label>
              <Select
                id="btn-sms-recipient"
                value={smsRecipient}
                onChange={(e) => setSmsRecipient(e.target.value as ButtonAutomationSmsRecipient)}
              >
                {(["customer", "custom"] as ButtonAutomationSmsRecipient[]).map((value) => (
                  <option key={value} value={value}>
                    {SMS_RECIPIENT_LABELS[value]}
                  </option>
                ))}
              </Select>
            </div>

            {smsRecipient === "custom" ? (
              <div>
                <Label htmlFor="btn-custom-phone">Phone number</Label>
                <Input
                  id="btn-custom-phone"
                  type="tel"
                  required
                  value={customPhone}
                  onChange={(e) => setCustomPhone(e.target.value)}
                  placeholder="+18185551234"
                />
              </div>
            ) : null}

            <div>
              <Label htmlFor="btn-sms-body">Message template</Label>
              <p className="mb-1 text-xs text-slate-500">
                Variables: {"{{order_number}}"}, {"{{customer_name}}"}, {"{{due_date}}"}, {"{{product}}"}, {"{{assigned_to}}"}
              </p>
              <textarea
                id="btn-sms-body"
                value={smsBodyTemplate}
                onChange={(e) => setSmsBodyTemplate(e.target.value)}
                placeholder="Order {{order_number}} — {{customer_name}}"
                rows={3}
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
              />
            </div>
          </>
        ) : null}

        {error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

function DeleteButtonDialog({
  button,
  onClose,
  onDeleted,
}: {
  button: ButtonAutomation;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setDeleting(true);
    const res = await fetch(`/api/button-automations/${button.id}`, {
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
      title="Delete button?"
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
        Remove <strong>{button.name}</strong>? This cannot be undone.
      </p>
      {error ? (
        <p className="mt-2 text-sm text-red-600">{error}</p>
      ) : null}
    </Modal>
  );
}
