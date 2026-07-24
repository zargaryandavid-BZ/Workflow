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
import { Input, Label, Textarea } from "@/components/ui/input";
import { TAG_COLORS } from "@/lib/tags";
import { TAG_NOTIFY_RECIPIENTS } from "@/lib/tag-notify-config";
import { cn } from "@/lib/utils";
import type { Tag } from "@/lib/types";

interface Props {
  initialTags: Tag[];
}

export function TagsManager({ initialTags }: Props) {
  const router = useRouter();
  const [tags, setTags] = useState<Tag[]>(initialTags);
  const [editing, setEditing] = useState<Tag | "new" | null>(null);
  const [deleting, setDeleting] = useState<Tag | null>(null);

  useEffect(() => setTags(initialTags), [initialTags]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  async function persistOrder(next: Tag[]) {
    setTags(next);
    await fetch("/api/tags/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds: next.map((t) => t.id) }),
    });
    router.refresh();
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = tags.findIndex((t) => t.id === active.id);
    const newIndex = tags.findIndex((t) => t.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    persistOrder(arrayMove(tags, oldIndex, newIndex));
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4" /> Add Tag
        </Button>
      </div>

      {tags.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-400">
          No tags yet.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={tags.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="space-y-1.5">
              {tags.map((tag) => (
                <SortableTagRow
                  key={tag.id}
                  tag={tag}
                  onEdit={() => setEditing(tag)}
                  onDelete={() => setDeleting(tag)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {editing ? (
        <TagEditor
          tag={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}

      {deleting ? (
        <DeleteTagDialog
          tag={deleting}
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

function SortableTagRow({
  tag,
  onEdit,
  onDelete,
}: {
  tag: Tag;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tag.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5"
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
      <span
        className="h-3.5 w-3.5 shrink-0 rounded-full"
        style={{ backgroundColor: tag.color }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-slate-800">{tag.name}</p>
          {tag.notify_enabled ? (
            <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
              Notify
            </span>
          ) : null}
        </div>
        {tag.description ? (
          <p className="truncate text-xs text-slate-500">{tag.description}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        aria-label="Edit tag"
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="rounded p-1.5 text-slate-400 hover:bg-red-100 hover:text-red-600"
        aria-label="Delete tag"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );
}

function TagEditor({
  tag,
  onClose,
  onSaved,
}: {
  tag: Tag | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = tag === null;
  const [name, setName] = useState(tag?.name ?? "");
  const [color, setColor] = useState(tag?.color ?? TAG_COLORS[0]);
  const [description, setDescription] = useState(tag?.description ?? "");
  const [notifyEnabled, setNotifyEnabled] = useState(
    Boolean(tag?.notify_enabled)
  );
  const [notifySendEmail, setNotifySendEmail] = useState(
    Boolean(tag?.notify_send_email)
  );
  const [notifySendSms, setNotifySendSms] = useState(
    Boolean(tag?.notify_send_sms)
  );
  const [notifyRecipients, setNotifyRecipients] = useState<string[]>(
    Array.isArray(tag?.notify_recipients) ? [...tag.notify_recipients] : []
  );
  const [notifyCustomEmail, setNotifyCustomEmail] = useState(
    tag?.notify_custom_email ?? ""
  );
  const [notifyCustomPhone, setNotifyCustomPhone] = useState(
    tag?.notify_custom_phone ?? ""
  );
  const [notifyEmailSubject, setNotifyEmailSubject] = useState(
    tag?.notify_email_subject ?? "Tag update: {{tag_name}} — #{{order_number}}"
  );
  const [notifyEmailBody, setNotifyEmailBody] = useState(
    tag?.notify_email_body ??
      `Hi {{customer_name}},\n\nOrder #{{order_number}} was tagged "{{tag_name}}".\n\n— {{brand}}`
  );
  const [notifySmsBody, setNotifySmsBody] = useState(
    tag?.notify_sms_body ??
      `Bazaar Printing: order {{order_number}} tagged "{{tag_name}}".`
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleRecipient(value: string) {
    setNotifyRecipients((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (notifyEnabled && !notifySendEmail && !notifySendSms) {
      setError("Choose Email and/or SMS when notifications are enabled.");
      return;
    }
    if (notifyEnabled && notifyRecipients.length === 0) {
      setError("Select at least one recipient.");
      return;
    }
    setError(null);
    setLoading(true);

    const payload = {
      name: name.trim(),
      color,
      description: description.trim() || null,
      notify_enabled: notifyEnabled,
      notify_send_email: notifySendEmail,
      notify_send_sms: notifySendSms,
      notify_recipients: notifyRecipients,
      notify_custom_email: notifyCustomEmail.trim() || null,
      notify_custom_phone: notifyCustomPhone.trim() || null,
      notify_email_subject: notifyEmailSubject.trim() || null,
      notify_email_body: notifyEmailBody.trim() || null,
      notify_sms_body: notifySmsBody.trim() || null,
    };

    const res = await fetch(
      isNew ? "/api/tags" : `/api/tags/${tag.id}`,
      {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const json = await res.json();
    setLoading(false);
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
      title={isNew ? "Add Tag" : "Edit Tag"}
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="tag-form" disabled={loading}>
            {loading ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <form id="tag-form" onSubmit={save} className="space-y-4">
        <div>
          <Label htmlFor="tag-name">
            Name<span className="ml-0.5 text-red-500">*</span>
          </Label>
          <Input
            id="tag-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Rush Order"
          />
        </div>
        <div>
          <Label>Color</Label>
          <div className="mt-2 flex flex-wrap gap-2">
            {TAG_COLORS.map((swatch) => (
              <button
                key={swatch}
                type="button"
                onClick={() => setColor(swatch)}
                className={cn(
                  "h-7 w-7 rounded-full border-2 transition-transform hover:scale-110",
                  color === swatch
                    ? "border-slate-800 ring-2 ring-slate-300"
                    : "border-transparent"
                )}
                style={{ backgroundColor: swatch }}
                aria-label={`Color ${swatch}`}
                aria-pressed={color === swatch}
              />
            ))}
          </div>
        </div>
        <div>
          <Label htmlFor="tag-desc">Description (optional)</Label>
          <Input
            id="tag-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Rush / urgent production jobs"
          />
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
            <input
              type="checkbox"
              checked={notifyEnabled}
              onChange={(e) => setNotifyEnabled(e.target.checked)}
              className="rounded border-slate-300"
            />
            Notify when this tag is set on an order
          </label>

          {notifyEnabled ? (
            <>
              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-600">
                  Channel
                </p>
                <div className="flex flex-wrap gap-3 text-sm text-slate-700">
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={notifySendEmail}
                      onChange={(e) => setNotifySendEmail(e.target.checked)}
                    />
                    Email
                  </label>
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={notifySendSms}
                      onChange={(e) => setNotifySendSms(e.target.checked)}
                    />
                    SMS
                  </label>
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-600">
                  Recipients
                </p>
                <div className="flex flex-wrap gap-3 text-sm text-slate-700">
                  {TAG_NOTIFY_RECIPIENTS.map((r) => (
                    <label
                      key={r.value}
                      className="inline-flex items-center gap-1.5"
                    >
                      <input
                        type="checkbox"
                        checked={notifyRecipients.includes(r.value)}
                        onChange={() => toggleRecipient(r.value)}
                      />
                      {r.label}
                    </label>
                  ))}
                </div>
              </div>

              {notifyRecipients.includes("custom") ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="tag-custom-email">Custom email</Label>
                    <Input
                      id="tag-custom-email"
                      type="email"
                      value={notifyCustomEmail}
                      onChange={(e) => setNotifyCustomEmail(e.target.value)}
                      placeholder="ops@example.com"
                    />
                  </div>
                  <div>
                    <Label htmlFor="tag-custom-phone">Custom phone</Label>
                    <Input
                      id="tag-custom-phone"
                      type="tel"
                      value={notifyCustomPhone}
                      onChange={(e) => setNotifyCustomPhone(e.target.value)}
                      placeholder="+1 555 123 4567"
                    />
                  </div>
                </div>
              ) : null}

              {notifySendEmail ? (
                <>
                  <div>
                    <Label htmlFor="tag-email-subject">Email subject</Label>
                    <Input
                      id="tag-email-subject"
                      value={notifyEmailSubject}
                      onChange={(e) => setNotifyEmailSubject(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="tag-email-body">Email body</Label>
                    <Textarea
                      id="tag-email-body"
                      value={notifyEmailBody}
                      onChange={(e) => setNotifyEmailBody(e.target.value)}
                      rows={5}
                      className="mt-1 font-sans text-sm"
                    />
                  </div>
                </>
              ) : null}

              {notifySendSms ? (
                <div>
                  <Label htmlFor="tag-sms-body">SMS body</Label>
                  <Textarea
                    id="tag-sms-body"
                    value={notifySmsBody}
                    onChange={(e) => setNotifySmsBody(e.target.value)}
                    rows={3}
                    className="mt-1 font-sans text-sm"
                  />
                </div>
              ) : null}

              <p className="text-[11px] text-slate-500">
                Placeholders: {"{{order_number}}"}, {"{{tag_name}}"},{" "}
                {"{{customer_name}}"}, {"{{designer_name}}"}, {"{{brand}}"}.
                Missing contacts are skipped with a warning — the tag still
                saves.
              </p>
            </>
          ) : null}
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

function DeleteTagDialog({
  tag,
  onClose,
  onDeleted,
}: {
  tag: Tag;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setLoading(true);
    const res = await fetch(`/api/tags/${tag.id}`, {
      method: "DELETE",
    });
    const json = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(json.error ?? "Failed to delete");
      return;
    }
    onDeleted();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Delete tag"
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={confirm}
            disabled={loading}
            className="bg-red-600 hover:bg-red-700"
          >
            {loading ? "Deleting…" : "Delete"}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">
        Delete <strong>{tag.name}</strong>? Orders using this tag will have
        their tag cleared.
      </p>
      {error ? (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
