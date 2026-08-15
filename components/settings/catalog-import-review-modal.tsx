"use client";

import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import type {
  CatalogAddition,
  CatalogDuplicateGroup,
  CatalogFieldKey,
} from "@/lib/import-catalog-review";

export type CatalogReviewPayload = {
  aiUsed: boolean;
  aiConfigured?: boolean;
  duplicates: CatalogDuplicateGroup[];
  additions: CatalogAddition[];
};

type Props = {
  open: boolean;
  review: CatalogReviewPayload | null;
  applying: boolean;
  error: string | null;
  onClose: () => void;
  onApply: (payload: {
    groups: {
      fieldKey: CatalogFieldKey;
      ours: string[];
      catalog: string[];
      keep: string[];
    }[];
    add: { fieldKey: CatalogFieldKey; value: string }[];
  }) => void;
};

function fieldLabel(key: CatalogFieldKey): string {
  if (key === "categories") return "Category";
  if (key === "products") return "Product";
  return "Materials";
}

function listLines(values: string[]) {
  if (values.length === 0) {
    return <span className="text-slate-400">—</span>;
  }
  return (
    <ul className="space-y-1">
      {values.map((v) => (
        <li key={v} className="text-sm text-slate-800">
          {v}
        </li>
      ))}
    </ul>
  );
}

function selectionState(ids: string[], selected: Record<string, boolean>) {
  if (ids.length === 0) return { all: false, some: false };
  const checkedCount = ids.filter((id) => selected[id] !== false).length;
  return {
    all: checkedCount === ids.length,
    some: checkedCount > 0 && checkedCount < ids.length,
  };
}

export function CatalogImportReviewModal({
  open,
  review,
  applying,
  error,
  onClose,
  onApply,
}: Props) {
  const duplicates = review?.duplicates ?? [];
  const additions = review?.additions ?? [];

  /** groupId → use imported (overwrite). Default true. */
  const [useImported, setUseImported] = useState<Record<string, boolean>>({});
  /** addition id → import this new option. Default true. */
  const [addSelected, setAddSelected] = useState<Record<string, boolean>>({});

  const reviewKey = useMemo(() => {
    if (!review) return null;
    return [
      review.duplicates.map((d) => d.id).join(","),
      review.additions.map((a) => a.id).join(","),
    ].join("|");
  }, [review]);

  useEffect(() => {
    if (!review || !reviewKey) return;
    const nextUse: Record<string, boolean> = {};
    for (const g of review.duplicates) {
      nextUse[g.id] = true;
    }
    const nextAdd: Record<string, boolean> = {};
    for (const a of review.additions) {
      nextAdd[a.id] = true;
    }
    setUseImported(nextUse);
    setAddSelected(nextAdd);
  }, [review, reviewKey]);

  function handleApply() {
    if (!review) return;
    onApply({
      groups: review.duplicates.map((g) => ({
        fieldKey: g.fieldKey,
        ours: g.ours,
        catalog: g.catalog,
        // Checked → overwrite with imported only; unchecked → keep both
        keep:
          useImported[g.id] !== false
            ? g.catalog
            : [...g.ours, ...g.catalog],
      })),
      add: review.additions
        .filter((a) => addSelected[a.id] !== false)
        .map((a) => ({ fieldKey: a.fieldKey, value: a.value })),
    });
  }

  const byField = (key: CatalogFieldKey) =>
    duplicates.filter((d) => d.fieldKey === key);

  const fieldsWithContent: CatalogFieldKey[] = (
    ["products", "materials", "categories"] as CatalogFieldKey[]
  ).filter(
    (k) =>
      byField(k).length > 0 || additions.some((a) => a.fieldKey === k)
  );

  const allDupIds = duplicates.map((d) => d.id);
  const allAddIds = additions.map((a) => a.id);
  const allOptionIds = [...allDupIds, ...allAddIds];
  const globalSel = selectionState(
    allOptionIds,
    Object.fromEntries([
      ...allDupIds.map((id) => [id, useImported[id] !== false] as const),
      ...allAddIds.map((id) => [id, addSelected[id] !== false] as const),
    ])
  );

  function setAllOptions(checked: boolean) {
    setUseImported((prev) => {
      const next = { ...prev };
      for (const id of allDupIds) next[id] = checked;
      return next;
    });
    setAddSelected((prev) => {
      const next = { ...prev };
      for (const id of allAddIds) next[id] = checked;
      return next;
    });
  }

  function setDupIds(ids: string[], checked: boolean) {
    setUseImported((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = checked;
      return next;
    });
  }

  function setAddIds(ids: string[], checked: boolean) {
    setAddSelected((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = checked;
      return next;
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Review catalog import"
      className="max-w-3xl"
      footer={
        <>
          <Button
            variant="ghost"
            type="button"
            onClick={onClose}
            disabled={applying}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleApply}
            disabled={applying || !review}
          >
            {applying ? "Applying…" : "Apply selected"}
          </Button>
        </>
      }
    >
      <div className="max-h-[70vh] space-y-5 overflow-y-auto py-3 pr-1">
        <p className="text-sm text-slate-600">
          <span className="font-medium text-amber-800">Duplicates</span> are
          different names for the same option. Check to overwrite with
          imported; uncheck to keep both.{" "}
          <span className="font-medium text-emerald-800">New</span> options are
          only in the catalog. Naming rules match at ~90%; AI can also flag
          pairs at ~70% similarity.
        </p>

        {review?.aiUsed ? (
          <p className="inline-flex items-center gap-1.5 rounded-md bg-violet-50 px-2 py-1 text-xs text-violet-700">
            <Sparkles className="h-3.5 w-3.5" />
            AI checked leftovers with your OPENAI_API_KEY
            {duplicates.some((d) => d.source === "ai")
              ? " and flagged extra duplicates"
              : " — no extra duplicates beyond naming rules"}
          </p>
        ) : review?.aiConfigured === false ? (
          <p className="text-xs text-slate-400">
            Matched with naming rules only. Add OPENAI_API_KEY to .env.local for
            AI extras.
          </p>
        ) : (
          <p className="text-xs text-slate-400">
            Matched with naming rules. AI pass did not run (restart{" "}
            <code className="rounded bg-slate-100 px-1">npm run dev</code> after
            adding OPENAI_API_KEY).
          </p>
        )}

        {error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        ) : null}

        {!review ? (
          <p className="text-sm text-slate-400">No review loaded.</p>
        ) : fieldsWithContent.length === 0 ? (
          <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            No new options or duplicates found — your fields already match the
            catalog.
          </p>
        ) : (
          <>
            {allOptionIds.length > 0 ? (
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300"
                  checked={globalSel.all}
                  ref={(el) => {
                    if (el) el.indeterminate = globalSel.some;
                  }}
                  onChange={() => setAllOptions(!globalSel.all)}
                />
                <span className="font-medium">Select all options</span>
                <span className="text-xs text-slate-400">
                  ({allOptionIds.length})
                </span>
              </label>
            ) : null}

            {fieldsWithContent.map((fieldKey) => {
              const fieldDups = byField(fieldKey);
              const fieldAdds = additions.filter((a) => a.fieldKey === fieldKey);
              const dupIds = fieldDups.map((g) => g.id);
              const addIds = fieldAdds.map((a) => a.id);
              const dupSel = selectionState(dupIds, useImported);
              const addSel = selectionState(addIds, addSelected);

              return (
                <section key={fieldKey} className="space-y-3">
                  <h3 className="text-sm font-semibold text-slate-800">
                    {fieldLabel(fieldKey)}
                  </h3>

                  {fieldDups.length > 0 ? (
                    <div className="space-y-1.5">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                        Duplicates ({fieldDups.length})
                      </h4>
                      <p className="text-xs text-slate-500">
                        Checked = use imported spelling only. Unchecked = keep
                        both names in the field.
                      </p>
                      <div className="overflow-hidden rounded-lg border border-amber-200">
                        <div className="grid grid-cols-[2.25rem_1fr_1fr] gap-0 border-b border-amber-200 bg-amber-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          <div className="flex items-center justify-center px-2 py-2">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-slate-300"
                              title="Select all duplicates in this field"
                              checked={dupSel.all}
                              ref={(el) => {
                                if (el) el.indeterminate = dupSel.some;
                              }}
                              onChange={() =>
                                setDupIds(dupIds, !dupSel.all)
                              }
                            />
                          </div>
                          <div className="border-l border-amber-200 px-3 py-2 text-blue-700">
                            Imported
                          </div>
                          <div className="border-l border-amber-200 px-3 py-2">
                            Ours
                          </div>
                        </div>

                        {fieldDups.map((g) => {
                          const checked = useImported[g.id] !== false;
                          return (
                            <div
                              key={g.id}
                              className={`grid grid-cols-[2.25rem_1fr_1fr] gap-0 border-b border-amber-100 last:border-b-0 ${
                                checked ? "bg-amber-50/60" : "bg-white"
                              }`}
                            >
                              <div className="flex items-start justify-center px-2 pt-3">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded border-slate-300"
                                  checked={checked}
                                  title={
                                    checked
                                      ? "Overwrite ours with imported"
                                      : "Keep both names"
                                  }
                                  onChange={() =>
                                    setUseImported((prev) => ({
                                      ...prev,
                                      [g.id]: !checked,
                                    }))
                                  }
                                />
                              </div>
                              <div className="border-l border-amber-100 px-3 py-2.5">
                                {listLines(g.catalog)}
                              </div>
                              <div className="border-l border-amber-100 px-3 py-2.5">
                                {listLines(g.ours)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {fieldAdds.length > 0 ? (
                    <div className="space-y-1.5">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                        New ({fieldAdds.length})
                      </h4>
                      <div className="overflow-hidden rounded-lg border border-emerald-200">
                        <div className="grid grid-cols-[2.25rem_1fr_1fr] gap-0 border-b border-emerald-200 bg-emerald-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          <div className="flex items-center justify-center px-2 py-2">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-slate-300"
                              title="Select all new options in this field"
                              checked={addSel.all}
                              ref={(el) => {
                                if (el) el.indeterminate = addSel.some;
                              }}
                              onChange={() =>
                                setAddIds(addIds, !addSel.all)
                              }
                            />
                          </div>
                          <div className="border-l border-emerald-200 px-3 py-2 text-blue-700">
                            Imported
                          </div>
                          <div className="border-l border-emerald-200 px-3 py-2">
                            Ours
                          </div>
                        </div>

                        {fieldAdds.map((a) => {
                          const checked = addSelected[a.id] !== false;
                          return (
                            <div
                              key={a.id}
                              className={`grid grid-cols-[2.25rem_1fr_1fr] gap-0 border-b border-emerald-100 last:border-b-0 ${
                                checked ? "bg-emerald-50/50" : "bg-white"
                              }`}
                            >
                              <div className="flex items-start justify-center px-2 pt-3">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded border-slate-300"
                                  checked={checked}
                                  title={
                                    checked
                                      ? "Add this imported option"
                                      : "Ignore — do not add"
                                  }
                                  onChange={() =>
                                    setAddSelected((prev) => ({
                                      ...prev,
                                      [a.id]: !checked,
                                    }))
                                  }
                                />
                              </div>
                              <div className="border-l border-emerald-100 px-3 py-2.5">
                                <p className="text-sm text-slate-800">
                                  {a.value}
                                </p>
                                <p className="mt-1 text-[10px] text-emerald-700">
                                  New · {checked ? "Will add" : "Ignored"}
                                </p>
                              </div>
                              <div className="border-l border-emerald-100 px-3 py-2.5 text-sm text-slate-400">
                                —
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </section>
              );
            })}
          </>
        )}
      </div>
    </Modal>
  );
}
