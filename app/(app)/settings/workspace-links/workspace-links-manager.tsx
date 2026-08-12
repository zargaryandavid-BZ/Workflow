"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link2, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Col = { id: string; name: string; position?: number };

type Rule = {
  id: string;
  link_id: string;
  trigger_column_id: string;
  mirror_start_column_id: string;
  return_column_id: string | null;
  return_to_column_id: string | null;
  enabled: boolean;
};

type LinkRow = {
  id: string;
  source_tenant_id: string;
  target_tenant_id: string;
  source_tenant_name: string;
  target_tenant_name: string;
  enabled: boolean;
  rules: Rule[];
};

export function WorkspaceLinksManager({
  currentTenantId,
  currentTenantName,
}: {
  currentTenantId: string;
  currentTenantName: string;
}) {
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [partners, setPartners] = useState<{ id: string; name: string }[]>([]);
  const [migrationRequired, setMigrationRequired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [sourceColumns, setSourceColumns] = useState<Col[]>([]);
  const [targetColumns, setTargetColumns] = useState<Col[]>([]);
  const [newPartnerId, setNewPartnerId] = useState("");

  const [draftTrigger, setDraftTrigger] = useState("");
  const [draftMirrorStart, setDraftMirrorStart] = useState("");
  const [draftReturn, setDraftReturn] = useState("");
  const [draftReturnTo, setDraftReturnTo] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/workspace-links", {
        cache: "no-store",
      });
      const json = (await res.json()) as {
        links?: LinkRow[];
        partnerOptions?: { id: string; name: string }[];
        migrationRequired?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      setLinks(json.links ?? []);
      setPartners(json.partnerOptions ?? []);
      setMigrationRequired(Boolean(json.migrationRequired));
      if (!selectedLinkId && json.links?.[0]) {
        setSelectedLinkId(json.links[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [selectedLinkId]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only
  }, []);

  const selected = useMemo(
    () => links.find((l) => l.id === selectedLinkId) ?? null,
    [links, selectedLinkId]
  );

  const isSource = selected?.source_tenant_id === currentTenantId;

  const loadRuleEditor = useCallback(async (linkId: string) => {
    const res = await fetch(`/api/settings/workspace-links/${linkId}/rules`, {
      cache: "no-store",
    });
    const json = (await res.json()) as {
      rules?: Rule[];
      sourceColumns?: Col[];
      targetColumns?: Col[];
      error?: string;
    };
    if (!res.ok) throw new Error(json.error ?? "Failed to load rules");
    setSourceColumns(json.sourceColumns ?? []);
    setTargetColumns(json.targetColumns ?? []);
    setLinks((prev) =>
      prev.map((l) =>
        l.id === linkId ? { ...l, rules: json.rules ?? [] } : l
      )
    );
  }, []);

  useEffect(() => {
    if (!selectedLinkId || !isSource) {
      setSourceColumns([]);
      setTargetColumns([]);
      return;
    }
    void loadRuleEditor(selectedLinkId).catch((err) =>
      setError(err instanceof Error ? err.message : "Failed to load rules")
    );
  }, [selectedLinkId, isSource, loadRuleEditor]);

  async function createLink() {
    if (!newPartnerId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/workspace-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetTenantId: newPartnerId }),
      });
      const json = (await res.json()) as { link?: LinkRow; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to create link");
      setNewPartnerId("");
      await load();
      if (json.link?.id) setSelectedLinkId(json.link.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create link");
    } finally {
      setSaving(false);
    }
  }

  async function toggleLink(linkId: string, enabled: boolean) {
    setSaving(true);
    try {
      const res = await fetch(`/api/settings/workspace-links/${linkId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? "Failed to update");
      }
      setLinks((prev) =>
        prev.map((l) => (l.id === linkId ? { ...l, enabled } : l))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setSaving(false);
    }
  }

  async function deleteLink(linkId: string) {
    if (!confirm("Delete this workspace link and all its rules?")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/settings/workspace-links/${linkId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? "Failed to delete");
      }
      setSelectedLinkId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setSaving(false);
    }
  }

  async function addRule() {
    if (!selected || !draftTrigger || !draftMirrorStart) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/settings/workspace-links/${selected.id}/rules`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            triggerColumnId: draftTrigger,
            mirrorStartColumnId: draftMirrorStart,
            returnColumnId: draftReturn || null,
            returnToColumnId: draftReturnTo || null,
          }),
        }
      );
      const json = (await res.json()) as { rule?: Rule; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to add rule");
      setDraftTrigger("");
      setDraftMirrorStart("");
      setDraftReturn("");
      setDraftReturnTo("");
      await loadRuleEditor(selected.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add rule");
    } finally {
      setSaving(false);
    }
  }

  async function deleteRule(ruleId: string) {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/settings/workspace-links/${selected.id}/rules/${ruleId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? "Failed to delete rule");
      }
      await loadRuleEditor(selected.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete rule");
    } finally {
      setSaving(false);
    }
  }

  function colName(cols: Col[], id: string | null) {
    if (!id) return "—";
    return cols.find((c) => c.id === id)?.name ?? id.slice(0, 8);
  }

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {migrationRequired ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Run migration <code className="text-xs">0073_workspace_links.sql</code>{" "}
          before using workspace links.
        </p>
      ) : null}
      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-800">
          Link a workspace
        </h2>
        <p className="mb-3 text-sm text-slate-500">
          You must be an admin of both workspaces. This workspace (
          {currentTenantName}) is the <strong>source</strong> — cards leave from
          here and mirrors are created in the partner.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[12rem] flex-1">
            <Label htmlFor="partner">Partner workspace</Label>
            <Select
              id="partner"
              value={newPartnerId}
              disabled={migrationRequired || saving || partners.length === 0}
              onChange={(e) => setNewPartnerId(e.target.value)}
            >
              <option value="">
                {partners.length ? "Select workspace…" : "No other admin workspaces"}
              </option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <Button
            type="button"
            disabled={!newPartnerId || saving || migrationRequired}
            onClick={() => void createLink()}
          >
            <Plus className="mr-1 h-4 w-4" />
            Create link
          </Button>
        </div>
      </section>

      <div className="grid min-h-[24rem] overflow-hidden rounded-xl border border-slate-200 bg-white lg:grid-cols-[minmax(14rem,18rem)_1fr]">
        <aside className="border-b border-slate-200 lg:border-b-0 lg:border-r">
          <div className="sticky top-0 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Links ({links.length})
          </div>
          {links.length === 0 ? (
            <p className="px-3 py-4 text-sm text-slate-400">No links yet.</p>
          ) : (
            <ul>
              {links.map((l) => {
                const active = l.id === selectedLinkId;
                const label =
                  l.source_tenant_id === currentTenantId
                    ? `→ ${l.target_tenant_name}`
                    : `← ${l.source_tenant_name}`;
                return (
                  <li key={l.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedLinkId(l.id)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm",
                        active
                          ? "bg-blue-50 font-medium text-blue-900"
                          : "text-slate-700 hover:bg-slate-50"
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-1.5 truncate">
                        <Link2 className="h-3.5 w-3.5 shrink-0 opacity-60" />
                        <span className="truncate">{label}</span>
                      </span>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                          l.enabled
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-slate-100 text-slate-400"
                        )}
                      >
                        {l.enabled ? "On" : "Off"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <div className="p-4">
          {!selected ? (
            <p className="text-sm text-slate-400">Select a link to configure.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">
                    {selected.source_tenant_name} → {selected.target_tenant_name}
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {isSource
                      ? "You own this link (source). Configure mirror rules below."
                      : "This workspace is the target (mirror receives cards). Rules are edited from the source workspace."}
                  </p>
                </div>
                {isSource ? (
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300"
                        checked={selected.enabled}
                        disabled={saving}
                        onChange={(e) =>
                          void toggleLink(selected.id, e.target.checked)
                        }
                      />
                      Enabled
                    </label>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={saving}
                      onClick={() => void deleteLink(selected.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ) : null}
              </div>

              {isSource ? (
                <>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Mirror rules
                    </p>
                    {(selected.rules ?? []).length === 0 ? (
                      <p className="text-sm text-slate-400">
                        No rules yet. Add one below.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {selected.rules.map((r) => (
                          <li
                            key={r.id}
                            className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 text-sm text-slate-700"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="space-y-1">
                                <p>
                                  When card enters{" "}
                                  <strong>
                                    {colName(sourceColumns, r.trigger_column_id)}
                                  </strong>{" "}
                                  → create mirror in{" "}
                                  <strong>
                                    {colName(
                                      targetColumns,
                                      r.mirror_start_column_id
                                    )}
                                  </strong>
                                </p>
                                <p className="text-xs text-slate-500">
                                  When mirror enters{" "}
                                  <strong>
                                    {colName(targetColumns, r.return_column_id)}
                                  </strong>{" "}
                                  → move original to{" "}
                                  <strong>
                                    {colName(
                                      sourceColumns,
                                      r.return_to_column_id
                                    )}
                                  </strong>
                                </p>
                              </div>
                              <button
                                type="button"
                                className="text-slate-400 hover:text-red-600"
                                disabled={saving}
                                onClick={() => void deleteRule(r.id)}
                                title="Delete rule"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="rounded-lg border border-dashed border-slate-200 p-3 space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Add rule
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label>Trigger column (this workspace)</Label>
                        <Select
                          value={draftTrigger}
                          onChange={(e) => setDraftTrigger(e.target.value)}
                          disabled={saving}
                        >
                          <option value="">Select…</option>
                          {sourceColumns.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div>
                        <Label>Mirror starts in (partner)</Label>
                        <Select
                          value={draftMirrorStart}
                          onChange={(e) => setDraftMirrorStart(e.target.value)}
                          disabled={saving}
                        >
                          <option value="">Select…</option>
                          {targetColumns.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div>
                        <Label>Return when mirror enters (partner)</Label>
                        <Select
                          value={draftReturn}
                          onChange={(e) => setDraftReturn(e.target.value)}
                          disabled={saving}
                        >
                          <option value="">Optional…</option>
                          {targetColumns.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div>
                        <Label>Move original to (this workspace)</Label>
                        <Select
                          value={draftReturnTo}
                          onChange={(e) => setDraftReturnTo(e.target.value)}
                          disabled={saving}
                        >
                          <option value="">Optional…</option>
                          {sourceColumns.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </div>
                    <Button
                      type="button"
                      disabled={
                        saving || !draftTrigger || !draftMirrorStart
                      }
                      onClick={() => void addRule()}
                    >
                      <Plus className="mr-1 h-4 w-4" />
                      Add rule
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-sm text-slate-500">
                  Switch to the source workspace to edit mirror rules.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
