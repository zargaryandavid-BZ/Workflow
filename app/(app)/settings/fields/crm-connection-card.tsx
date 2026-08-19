"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import type { IntegrationMode } from "@/lib/types";

function formatSyncedAt(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Never";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function CrmConnectionCard({
  integrationMode,
  catalogUrl,
  onCatalogUrlChange,
  catalogCachedAt,
}: {
  integrationMode: IntegrationMode;
  catalogUrl: string;
  onCatalogUrlChange: (url: string) => void;
  catalogCachedAt: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<IntegrationMode>(integrationMode);
  const [cachedAt, setCachedAt] = useState(catalogCachedAt);
  const [savingUrl, setSavingUrl] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function saveUrl(nextUrl: string): Promise<boolean> {
    const res = await fetch("/api/settings/integration-mode", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ crm_catalog_url: nextUrl.trim() || null }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(json.error ?? "Failed to save catalog URL");
      return false;
    }
    return true;
  }

  async function refreshCatalog(nextUrl?: string): Promise<boolean> {
    const res = await fetch("/api/catalog-cache/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nextUrl?.trim() ? { url: nextUrl.trim() } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
      cached_at?: string;
      product_count?: number;
    };
    if (!res.ok) {
      setError(json.error ?? "Failed to refresh catalog");
      return false;
    }
    if (json.cached_at) setCachedAt(json.cached_at);
    setMessage(
      typeof json.product_count === "number"
        ? `Catalog synced (${json.product_count} products).`
        : "Catalog synced."
    );
    return true;
  }

  async function handleSaveUrl() {
    setError(null);
    setMessage(null);
    setSavingUrl(true);
    const ok = await saveUrl(catalogUrl);
    setSavingUrl(false);
    if (ok) {
      setMessage("Catalog URL saved.");
      router.refresh();
    }
  }

  async function handleSwitchToConnected() {
    setError(null);
    setMessage(null);
    if (!catalogUrl.trim()) {
      setError("Set a CRM Catalog URL before switching to Connected mode.");
      return;
    }
    setSwitching(true);
    const saved = await saveUrl(catalogUrl);
    if (!saved) {
      setSwitching(false);
      return;
    }
    const refreshed = await refreshCatalog(catalogUrl);
    if (!refreshed) {
      setSwitching(false);
      return;
    }
    const res = await fetch("/api/settings/integration-mode", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ integration_mode: "connected" }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    setSwitching(false);
    if (!res.ok) {
      setError(json.error ?? "Failed to switch to Connected mode");
      return;
    }
    setMode("connected");
    router.refresh();
  }

  async function handleRefresh() {
    setError(null);
    setMessage(null);
    setRefreshing(true);
    await refreshCatalog(catalogUrl);
    setRefreshing(false);
    router.refresh();
  }

  async function handleSwitchToLocal() {
    setError(null);
    setMessage(null);
    setSwitching(true);
    const res = await fetch("/api/settings/integration-mode", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ integration_mode: "local" }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    setSwitching(false);
    if (!res.ok) {
      setError(json.error ?? "Failed to switch to Local mode");
      return;
    }
    setMode("local");
    router.refresh();
  }

  const connected = mode === "connected";

  return (
    <div
      className={
        connected
          ? "rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 space-y-3"
          : "rounded-xl border border-slate-200 bg-white p-4 space-y-3"
      }
    >
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-slate-800">
            Product fields source: {connected ? "CRM CONNECTED" : "LOCAL"}
          </p>
          {connected ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Live
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-slate-600">
          {connected
            ? "Product specs are driven by CRM product templates."
            : "Workflow manages its own custom fields."}
        </p>
        {connected ? (
          <p className="mt-1 text-xs text-slate-500">
            Last synced: {formatSyncedAt(cachedAt)}
          </p>
        ) : null}
      </div>
      <div>
        <Label htmlFor="crm-catalog-url">CRM Catalog URL</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="crm-catalog-url"
            value={catalogUrl}
            onChange={(e) => onCatalogUrlChange(e.target.value)}
            placeholder="https://your-crm.example.com/api/catalog"
            className="sm:flex-1"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={savingUrl || switching || refreshing}
            onClick={() => void handleSaveUrl()}
          >
            {savingUrl ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
      {connected ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={refreshing || switching || savingUrl}
            onClick={() => void handleRefresh()}
          >
            {refreshing ? "Refreshing…" : "Refresh catalog"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={switching || refreshing || savingUrl}
            onClick={() => void handleSwitchToLocal()}
          >
            {switching ? "Switching…" : "Switch to Local mode"}
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          disabled={switching || savingUrl}
          onClick={() => void handleSwitchToConnected()}
        >
          {switching ? "Switching…" : "Switch to Connected mode"}
        </Button>
      )}
    </div>
  );
}
