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
import { CATEGORY_COLORS } from "@/lib/categories";
import { cn } from "@/lib/utils";
import type { Category } from "@/lib/types";

interface Props {
  initialCategories: Category[];
}

export function CategoriesManager({ initialCategories }: Props) {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const [editing, setEditing] = useState<Category | "new" | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);

  useEffect(() => setCategories(initialCategories), [initialCategories]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  async function persistOrder(next: Category[]) {
    setCategories(next);
    await fetch("/api/categories/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds: next.map((c) => c.id) }),
    });
    router.refresh();
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = categories.findIndex((c) => c.id === active.id);
    const newIndex = categories.findIndex((c) => c.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    persistOrder(arrayMove(categories, oldIndex, newIndex));
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4" /> Add Category
        </Button>
      </div>

      {categories.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-400">
          No categories yet.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={categories.map((c) => c.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="space-y-1.5">
              {categories.map((cat) => (
                <SortableCategoryRow
                  key={cat.id}
                  category={cat}
                  onEdit={() => setEditing(cat)}
                  onDelete={() => setDeleting(cat)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {editing ? (
        <CategoryEditor
          category={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}

      {deleting ? (
        <DeleteCategoryDialog
          category={deleting}
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

function SortableCategoryRow({
  category,
  onEdit,
  onDelete,
}: {
  category: Category;
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
  } = useSortable({ id: category.id });

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
        style={{ backgroundColor: category.color }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-800">{category.name}</p>
        {category.description ? (
          <p className="truncate text-xs text-slate-500">{category.description}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        aria-label="Edit category"
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="rounded p-1.5 text-slate-400 hover:bg-red-100 hover:text-red-600"
        aria-label="Delete category"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );
}

function CategoryEditor({
  category,
  onClose,
  onSaved,
}: {
  category: Category | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = category === null;
  const [name, setName] = useState(category?.name ?? "");
  const [color, setColor] = useState(category?.color ?? CATEGORY_COLORS[0]);
  const [description, setDescription] = useState(category?.description ?? "");
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
      isNew ? "/api/categories" : `/api/categories/${category.id}`,
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
      title={isNew ? "Add Category" : "Edit Category"}
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="category-form" disabled={loading}>
            {loading ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <form id="category-form" onSubmit={save} className="space-y-4">
        <div>
          <Label htmlFor="cat-name">
            Name<span className="ml-0.5 text-red-500">*</span>
          </Label>
          <Input
            id="cat-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Rush Order"
          />
        </div>
        <div>
          <Label>Color</Label>
          <div className="mt-2 flex flex-wrap gap-2">
            {CATEGORY_COLORS.map((swatch) => (
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
          <Label htmlFor="cat-desc">Description (optional)</Label>
          <Input
            id="cat-desc"
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

function DeleteCategoryDialog({
  category,
  onClose,
  onDeleted,
}: {
  category: Category;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setLoading(true);
    const res = await fetch(`/api/categories/${category.id}`, {
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
      title="Delete category"
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
        Delete <strong>{category.name}</strong>? Orders using this category will
        have their category cleared.
      </p>
      {error ? (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
