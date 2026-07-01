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
import { Input, Label } from "@/components/ui/input";
import { TAG_COLORS } from "@/lib/tags";
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
        <p className="text-sm font-medium text-slate-800">{tag.name}</p>
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setError(null);
    setLoading(true);

    const payload = {
      name: name.trim(),
      color,
      description: description.trim() || null,
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
