"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Link2,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { uniqueOptions } from "@/lib/field-links";
import type { CustomField, FieldLink, FieldLinkMapping } from "@/lib/types";

interface Props {
  selectFields: CustomField[];
}

export function LinkedDropdownsTab({ selectFields }: Props) {
  const [links, setLinks] = useState<FieldLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [sourceFieldId, setSourceFieldId] = useState("");
  const [targetFieldId, setTargetFieldId] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [autoFilling, setAutoFilling] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [addingFor, setAddingFor] = useState<{
    linkId: string;
    sourceValue: string;
  } | null>(null);
  const [busyMappingId, setBusyMappingId] = useState<string | null>(null);

  const fieldsById = useMemo(() => {
    const map = new Map<string, CustomField>();
    for (const f of selectFields) map.set(f.id, f);
    return map;
  }, [selectFields]);

  const loadLinks = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/field-links");
    const json = await res.json().catch(() => ([]));
    if (!res.ok) {
      setError(
        (json as { error?: string }).error ?? "Failed to load linked dropdowns"
      );
      setLinks([]);
      return;
    }
    setLinks(json as FieldLink[]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await loadLinks();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadLinks]);

  function fieldName(id: string): string {
    return fieldsById.get(id)?.name ?? "Unknown field";
  }

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleConnect() {
    if (!sourceFieldId || !targetFieldId) return;
    setConnecting(true);
    setError(null);
    setMessage(null);
    const res = await fetch("/api/field-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_field_id: sourceFieldId,
        target_field_id: targetFieldId,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setConnecting(false);
    if (!res.ok) {
      setError((json as { error?: string }).error ?? "Failed to connect fields");
      return;
    }
    const link = json as FieldLink;
    setLinks((prev) => [...prev, { ...link, field_link_mappings: [] }]);
    setExpandedIds((prev) => new Set(prev).add(link.id));
    setShowNewForm(false);
    setSourceFieldId("");
    setTargetFieldId("");
    setMessage("Fields connected.");
  }

  async function handleDeleteLink(linkId: string) {
    if (!window.confirm("Delete this linked dropdown and all its mappings?")) {
      return;
    }
    setError(null);
    const res = await fetch(`/api/field-links/${linkId}`, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError((json as { error?: string }).error ?? "Failed to delete link");
      return;
    }
    setLinks((prev) => prev.filter((l) => l.id !== linkId));
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.delete(linkId);
      return next;
    });
  }

  async function handleAddMapping(
    linkId: string,
    sourceValue: string,
    targetValue: string
  ) {
    setError(null);
    const res = await fetch(`/api/field-links/${linkId}/mappings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_value: sourceValue,
        target_value: targetValue,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError((json as { error?: string }).error ?? "Failed to add mapping");
      return;
    }
    const mapping = json as FieldLinkMapping;
    setLinks((prev) =>
      prev.map((l) =>
        l.id === linkId
          ? {
              ...l,
              field_link_mappings: [...(l.field_link_mappings ?? []), mapping],
            }
          : l
      )
    );
    setAddingFor(null);
  }

  async function handleDeleteMapping(mappingId: string, linkId: string) {
    setBusyMappingId(mappingId);
    setError(null);
    const res = await fetch(`/api/field-link-mappings/${mappingId}`, {
      method: "DELETE",
    });
    const json = await res.json().catch(() => ({}));
    setBusyMappingId(null);
    if (!res.ok) {
      setError((json as { error?: string }).error ?? "Failed to remove mapping");
      return;
    }
    setLinks((prev) =>
      prev.map((l) =>
        l.id === linkId
          ? {
              ...l,
              field_link_mappings: (l.field_link_mappings ?? []).filter(
                (m) => m.id !== mappingId
              ),
            }
          : l
      )
    );
  }

  async function handleAutoFill() {
    setAutoFilling(true);
    setError(null);
    setMessage(null);
    const res = await fetch("/api/field-links/auto-fill", { method: "POST" });
    const json = await res.json().catch(() => ({}));
    setAutoFilling(false);
    if (!res.ok) {
      setError((json as { error?: string }).error ?? "Auto-fill failed");
      return;
    }
    const inserted = (json as { inserted?: number }).inserted ?? 0;
    setMessage(
      inserted > 0
        ? `Added ${inserted} mapping${inserted === 1 ? "" : "s"} from catalog.`
        : "No new mappings to add (catalog already applied or options don’t match)."
    );
    await loadLinks();
  }

  if (loading) {
    return (
      <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-slate-700">
            Linked dropdowns
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Connect two dropdown fields — the source value filters options in
            the target.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleAutoFill()}
            disabled={autoFilling || selectFields.length === 0}
          >
            {autoFilling ? "Filling…" : "Auto-fill from catalog"}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => setShowNewForm(true)}
            disabled={selectFields.length < 2}
          >
            <Plus className="h-4 w-4" />
            Connect fields
          </Button>
        </div>
      </div>

      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </p>
      ) : null}

      {showNewForm ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_1fr]">
            <div>
              <Label htmlFor="link-source">Source field</Label>
              <Select
                id="link-source"
                value={sourceFieldId}
                onChange={(e) => setSourceFieldId(e.target.value)}
              >
                <option value="">— Select —</option>
                {selectFields.map((f) => (
                  <option
                    key={f.id}
                    value={f.id}
                    disabled={f.id === targetFieldId}
                  >
                    {f.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="hidden items-end justify-center pb-2 sm:flex">
              <Link2 className="h-4 w-4 text-slate-400" />
            </div>
            <div>
              <Label htmlFor="link-target">Target field</Label>
              <Select
                id="link-target"
                value={targetFieldId}
                onChange={(e) => setTargetFieldId(e.target.value)}
              >
                <option value="">— Select —</option>
                {selectFields.map((f) => (
                  <option
                    key={f.id}
                    value={f.id}
                    disabled={f.id === sourceFieldId}
                  >
                    {f.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowNewForm(false);
                setSourceFieldId("");
                setTargetFieldId("");
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void handleConnect()}
              disabled={
                connecting || !sourceFieldId || !targetFieldId
              }
            >
              {connecting ? "Connecting…" : "Connect"}
            </Button>
          </div>
        </div>
      ) : null}

      {links.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">
          No linked dropdowns yet.
          <br />
          Click &quot;+ Connect fields&quot; or use &quot;Auto-fill from
          catalog&quot; to get started.
        </div>
      ) : (
        <ul className="space-y-2">
          {links.map((link) => {
            const source = fieldsById.get(link.source_field_id);
            const target = fieldsById.get(link.target_field_id);
            const sourceOptions = uniqueOptions(source?.options);
            const targetOptions = uniqueOptions(target?.options);
            const mappings = link.field_link_mappings ?? [];
            const mappedSourceCount = new Set(
              mappings.map((m) => m.source_value)
            ).size;
            const expanded = expandedIds.has(link.id);

            return (
              <li
                key={link.id}
                className="rounded-lg border border-slate-200 bg-white"
              >
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(link.id)}
                    className="rounded p-0.5 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
                    aria-expanded={expanded}
                  >
                    {expanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleExpanded(link.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="text-sm font-medium text-slate-800">
                      {fieldName(link.source_field_id)}
                      <span className="mx-1.5 font-normal text-slate-400">
                        →
                      </span>
                      {fieldName(link.target_field_id)}
                    </span>
                    <span className="ml-2 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                      {mappedSourceCount} of {sourceOptions.length} values
                      mapped
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteLink(link.id)}
                    className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    title="Delete link"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                {expanded ? (
                  <div className="border-t border-slate-100 px-3 py-3">
                    {!source || !target ? (
                      <p className="text-sm text-amber-600">
                        One of these fields was removed. Delete this link or
                        reconnect.
                      </p>
                    ) : sourceOptions.length === 0 ? (
                      <p className="text-sm text-slate-400">
                        Source field has no options yet.
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead>
                            <tr className="text-xs uppercase tracking-wide text-slate-400">
                              <th className="pb-2 pr-3 font-medium">
                                When {source.name} = …
                              </th>
                              <th className="pb-2 font-medium">
                                Show these {target.name} options
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {sourceOptions.map((sourceValue) => {
                              const rowMappings = mappings.filter(
                                (m) => m.source_value === sourceValue
                              );
                              const assigned = new Set(
                                rowMappings.map((m) => m.target_value)
                              );
                              const available = targetOptions.filter(
                                (o) => !assigned.has(o)
                              );
                              const isAdding =
                                addingFor?.linkId === link.id &&
                                addingFor.sourceValue === sourceValue;

                              return (
                                <tr key={sourceValue}>
                                  <td className="py-2 pr-3 align-top font-medium text-slate-700">
                                    {sourceValue}
                                  </td>
                                  <td className="py-2 align-top">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      {rowMappings.map((m) => (
                                        <span
                                          key={m.id}
                                          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700"
                                        >
                                          {m.target_value}
                                          <button
                                            type="button"
                                            disabled={busyMappingId === m.id}
                                            onClick={() =>
                                              void handleDeleteMapping(
                                                m.id,
                                                link.id
                                              )
                                            }
                                            className="rounded text-slate-400 hover:text-red-600"
                                            aria-label={`Remove ${m.target_value}`}
                                          >
                                            <X className="h-3 w-3" />
                                          </button>
                                        </span>
                                      ))}
                                      {isAdding ? (
                                        <Select
                                          autoFocus
                                          className="h-7 w-auto min-w-[8rem] py-0 text-xs"
                                          defaultValue=""
                                          onChange={(e) => {
                                            const v = e.target.value;
                                            if (!v) {
                                              setAddingFor(null);
                                              return;
                                            }
                                            void handleAddMapping(
                                              link.id,
                                              sourceValue,
                                              v
                                            );
                                          }}
                                          onBlur={() => setAddingFor(null)}
                                        >
                                          <option value="">— pick —</option>
                                          {available.map((opt) => (
                                            <option key={opt} value={opt}>
                                              {opt}
                                            </option>
                                          ))}
                                        </Select>
                                      ) : available.length > 0 ? (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setAddingFor({
                                              linkId: link.id,
                                              sourceValue,
                                            })
                                          }
                                          className={cn(
                                            "rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-500 hover:border-slate-400 hover:text-slate-700"
                                          )}
                                        >
                                          + add
                                        </button>
                                      ) : null}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
