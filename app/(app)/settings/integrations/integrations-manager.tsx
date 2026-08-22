"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";
import { buildWebhookAiPrompt } from "@/lib/webhook-ai-prompt";
import { buildWebhookPayloadDocs, buildWebhookPayloadDocsHtml } from "@/lib/webhook-payload-docs";
import {
  DEFAULT_WEBHOOK_SOURCE_STYLES,
  ensurePortalSourceStyle,
  isHexColor,
  normalizeWebhookSourceStyles,
  type WebhookSourceStyleEntry,
  type WebhookSourceStyles,
} from "@/lib/webhook-source-styles";
import type { WebhookConfig, WebhookHistoryEntry } from "@/lib/types";

interface Props {
  initialConfig: WebhookConfig | null;
  loadError: string | null;
  initialHistory: WebhookHistoryEntry[];
  historyLoadError: string | null;
  webhookUrl: string;
  /** CRM pull: all board cards + current column names. */
  boardExportUrl: string;
  productOptions: string[];
  /** Live custom-field select options keyed by webhook field name. */
  tenantFieldOptions?: Record<string, string[]>;
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatResponseValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return prettyJson(value);
}

function responseValueRows(payload: Record<string, unknown> | null) {
  if (!payload) return [];
  return Object.entries(payload).map(([key, value]) => ({
    key,
    value: formatResponseValue(value),
  }));
}

export function IntegrationsManager({
  initialConfig,
  loadError: initialLoadError,
  initialHistory,
  historyLoadError: initialHistoryLoadError,
  webhookUrl,
  boardExportUrl,
  productOptions,
  tenantFieldOptions = {},
}: Props) {
  const router = useRouter();
  const [config, setConfig] = useState(initialConfig);
  const [loadError, setLoadError] = useState(initialLoadError);
  const [toggling, setToggling] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"setup" | "history">("setup");
  const [history, setHistory] = useState(initialHistory);
  const [historyError, setHistoryError] = useState(initialHistoryLoadError);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [excludedProducts, setExcludedProducts] = useState<string[]>(
    initialConfig?.excluded_products ?? []
  );
  const [savingExclusions, setSavingExclusions] = useState(false);
  const [exclusionMessage, setExclusionMessage] = useState<string | null>(null);
  const [exclusionError, setExclusionError] = useState<string | null>(null);
  const [sourceStyles, setSourceStyles] = useState<WebhookSourceStyles>(() =>
    ensurePortalSourceStyle(
      normalizeWebhookSourceStyles(
        initialConfig?.source_styles ?? DEFAULT_WEBHOOK_SOURCE_STYLES
      )
    )
  );
  const [savingSourceStyles, setSavingSourceStyles] = useState(false);
  const [sourceStylesMessage, setSourceStylesMessage] = useState<string | null>(
    null
  );
  const [sourceStylesError, setSourceStylesError] = useState<string | null>(
    null
  );
  const [historySearch, setHistorySearch] = useState("");

  async function copyText(text: string, field: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      setError("Could not copy to clipboard");
    }
  }

  async function refreshHistory() {
    setHistoryError(null);
    setLoadingHistory(true);
    const res = await fetch("/api/webhook/history?limit=50");
    const json = await res.json().catch(() => ({}));
    setLoadingHistory(false);
    if (!res.ok) {
      setHistoryError(
        typeof json.error === "string" ? json.error : "Failed to load history"
      );
      return;
    }
    setHistory((json.history ?? []) as WebhookHistoryEntry[]);
  }

  async function toggleEnabled() {
    if (!config) return;
    setError(null);
    setMessage(null);
    setToggling(true);
    const res = await fetch("/api/webhook-config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !config.enabled }),
    });
    const json = await res.json();
    setToggling(false);
    if (!res.ok) {
      setError(json.error ?? "Failed to update webhook");
      return;
    }
    setConfig(json.config as WebhookConfig);
    router.refresh();
  }

  async function regenerate() {
    if (!config) return;
    if (
      !window.confirm(
        "Generate a new secret key? The current key will stop working immediately."
      )
    ) {
      return;
    }
    setError(null);
    setMessage(null);
    setRegenerating(true);
    const res = await fetch("/api/webhook-config/regenerate", {
      method: "POST",
    });
    const json = await res.json();
    setRegenerating(false);
    if (!res.ok) {
      setError(json.error ?? "Failed to regenerate key");
      return;
    }
    setConfig(json.config as WebhookConfig);
    setMessage("New key generated — update your integration");
    router.refresh();
  }

  function toggleProduct(product: string) {
    setExcludedProducts((prev) =>
      prev.includes(product)
        ? prev.filter((p) => p !== product)
        : [...prev, product]
    );
  }

  async function saveExclusions() {
    setExclusionError(null);
    setExclusionMessage(null);
    setSavingExclusions(true);
    const res = await fetch("/api/webhook-config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ excluded_products: excludedProducts }),
    });
    const json = await res.json();
    setSavingExclusions(false);
    if (!res.ok) {
      setExclusionError(json.error ?? "Failed to save exclusions");
      return;
    }
    setConfig(json.config as WebhookConfig);
    setExclusionMessage("Exclusion list saved");
    setTimeout(() => setExclusionMessage(null), 3000);
  }

  function updateSourceRow(
    index: number,
    patch: Partial<WebhookSourceStyleEntry>
  ) {
    setSourceStyles((prev) => ({
      ...prev,
      sources: prev.sources.map((row, i) =>
        i === index ? { ...row, ...patch } : row
      ),
    }));
  }

  function addSourceRow() {
    setSourceStyles((prev) => ({
      ...prev,
      sources: [
        ...prev.sources,
        { key: "", label: "", color: "#2563eb" },
      ],
    }));
  }

  function removeSourceRow(index: number) {
    setSourceStyles((prev) => {
      const row = prev.sources[index];
      if (row && row.key.trim().toLowerCase() === "portal") return prev;
      return {
        ...prev,
        sources: prev.sources.filter((_, i) => i !== index),
      };
    });
  }

  async function saveSourceStyles() {
    setSourceStylesError(null);
    setSourceStylesMessage(null);

    for (const row of sourceStyles.sources) {
      if (!row.key.trim() || !row.label.trim()) {
        setSourceStylesError("Each source needs a key and a display label");
        return;
      }
      if (!isHexColor(row.color)) {
        setSourceStylesError(
          `Invalid color for "${row.key || row.label}" — use #RGB or #RRGGBB`
        );
        return;
      }
    }
    if (!sourceStyles.other.label.trim()) {
      setSourceStylesError("Other / unknown needs a display label");
      return;
    }
    if (!isHexColor(sourceStyles.other.color)) {
      setSourceStylesError("Other / unknown color must be #RGB or #RRGGBB");
      return;
    }

    setSavingSourceStyles(true);
    const payload = normalizeWebhookSourceStyles(sourceStyles);
    try {
      const res = await fetch("/api/webhook-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_styles: payload }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSourceStylesError(
          typeof json.error === "string"
            ? json.error
            : "Failed to save source styles"
        );
        return;
      }
      const next = json.config as WebhookConfig;
      setConfig(next);
      setSourceStyles(
        ensurePortalSourceStyle(
          normalizeWebhookSourceStyles(next.source_styles)
        )
      );
      setSourceStylesMessage("Source styles saved");
      setTimeout(() => setSourceStylesMessage(null), 3000);
      router.refresh();
    } catch {
      setSourceStylesError(
        "Could not reach the server — is the local app still running?"
      );
    } finally {
      setSavingSourceStyles(false);
    }
  }

  if (!config) {
    return (
      <div className="space-y-4">
        {loadError ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {loadError}
          </p>
        ) : (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            Could not load webhook settings.
          </p>
        )}
        <p className="text-sm text-slate-500">
          Webhook URL (after setup):{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
            {webhookUrl}
          </code>
        </p>
      </div>
    );
  }

  const payloadDocs = buildWebhookPayloadDocs(webhookUrl, config.secret_key);
  const payloadDocsHtml = buildWebhookPayloadDocsHtml(webhookUrl, config.secret_key);
  const aiPrompt = useMemo(
    () =>
      buildWebhookAiPrompt({
        webhookUrl,
        tenantFieldOptions,
        sourceStyles,
        excludedProducts: excludedProducts,
      }),
    [webhookUrl, tenantFieldOptions, sourceStyles, excludedProducts]
  );

  const filteredHistory = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    if (!q) return history;
    return history.filter((entry) => {
      if (entry.order_numbers.some((n) => n.toLowerCase().includes(q))) return true;
      if ((entry.success ? "success" : "failed").includes(q)) return true;
      if (entry.error_message?.toLowerCase().includes(q)) return true;
      if (entry.created_at.toLowerCase().includes(q)) return true;
      const raw = entry.request_raw ?? "";
      if (raw.toLowerCase().includes(q)) return true;
      const respText = entry.response_payload ? prettyJson(entry.response_payload).toLowerCase() : "";
      if (respText.includes(q)) return true;
      return false;
    });
  }, [history, historySearch]);

  const historyCountLabel = filteredHistory.length !== history.length
    ? `${filteredHistory.length} of ${history.length} event${history.length === 1 ? "" : "s"}`
    : `${history.length} event${history.length === 1 ? "" : "s"}`;

  return (
    <div className="space-y-6">
      {loadError ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {loadError}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </p>
      ) : null}

      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
        <button
          type="button"
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            activeTab === "setup"
              ? "bg-slate-900 text-white"
              : "text-slate-600 hover:bg-slate-100"
          }`}
          onClick={() => setActiveTab("setup")}
        >
          Setup
        </button>
        <button
          type="button"
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            activeTab === "history"
              ? "bg-slate-900 text-white"
              : "text-slate-600 hover:bg-slate-100"
          }`}
          onClick={() => setActiveTab("history")}
        >
          History
        </button>
      </div>

      {activeTab === "setup" ? (
        <>
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-800">
              Inbound Webhook
            </h2>
            <p className="mt-1 max-w-lg text-sm text-slate-500">
              Allow external apps to POST orders directly into your production
              board.
            </p>
          </div>
          <button
            type="button"
            onClick={toggleEnabled}
            disabled={toggling}
            className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
            aria-pressed={config.enabled}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                config.enabled ? "bg-emerald-500" : "bg-slate-300"
              }`}
            />
            {config.enabled ? "Enabled" : "Disabled"}
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
              Webhook URL
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-800">
                {webhookUrl}
              </code>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => copyText(webhookUrl, "url")}
              >
                {copiedField === "url" ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                Copy
              </Button>
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
              Secret key
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md bg-slate-50 px-3 py-2 font-mono text-sm text-slate-800">
                {config.secret_key}
              </code>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => copyText(config.secret_key, "secret")}
              >
                {copiedField === "secret" ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                Copy
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={regenerate}
                disabled={regenerating}
              >
                <RefreshCw
                  className={`h-4 w-4 ${regenerating ? "animate-spin" : ""}`}
                />
                Regenerate
              </Button>
            </div>
          </div>

          <p className="text-sm text-slate-500">
            Last used:{" "}
            {config.last_used_at
              ? formatDateTime(config.last_used_at)
              : "Never used"}
          </p>
        </div>
          </section>

          <BazaarPortalSyncSection config={config} setConfig={setConfig} setError={setError} setMessage={setMessage} />

          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5">
              <h2 className="text-base font-semibold text-slate-800">
                Board export (CRM pull)
              </h2>
              <p className="mt-1 max-w-lg text-sm text-slate-500">
                Your CRM can GET this URL to read every active card and which
                column it is in right now. Uses the same secret key as the
                inbound webhook.
              </p>
            </div>
            <div className="space-y-4">
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
                  Export URL
                </p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-800">
                    {boardExportUrl}
                  </code>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => copyText(boardExportUrl, "export-url")}
                  >
                    {copiedField === "export-url" ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                    Copy
                  </Button>
                </div>
              </div>
              <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <p className="font-medium text-slate-700">Example</p>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">
                  {`curl -H "x-webhook-secret: ${config.secret_key}" \\\n  "${boardExportUrl}"`}
                </pre>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-800">
                  Product exclusion list
                </h2>
                <p className="mt-1 max-w-lg text-sm text-slate-500">
                  Webhook orders with an excluded product type will be silently
                  ignored — no order will be created.
                </p>
              </div>
            </div>

            {exclusionError ? (
              <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {exclusionError}
              </p>
            ) : null}
            {exclusionMessage ? (
              <p className="mb-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {exclusionMessage}
              </p>
            ) : null}

            <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
              {productOptions.map((product) => {
                const checked = excludedProducts.includes(product);
                return (
                  <label
                    key={product}
                    className="flex cursor-pointer items-center gap-2 text-sm text-slate-700"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleProduct(product)}
                      className="h-4 w-4 rounded border-slate-300 accent-[var(--primary)]"
                    />
                    {product}
                  </label>
                );
              })}
            </div>

            <div className="flex items-center gap-3">
              <Button
                type="button"
                size="sm"
                onClick={saveExclusions}
                disabled={savingExclusions}
              >
                {savingExclusions ? "Saving…" : "Save exclusions"}
              </Button>
              {excludedProducts.length > 0 ? (
                <span className="text-xs text-slate-500">
                  {excludedProducts.length} product
                  {excludedProducts.length === 1 ? "" : "s"} excluded
                </span>
              ) : null}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-800">
                  Source labels
                </h2>
                <p className="mt-1 max-w-xl text-sm text-slate-500">
                  Callers send a <code className="text-xs">source</code> key in
                  the webhook payload. Matching keys show a small colored label
                  above the customer name on cards.{" "}
                  <strong className="font-medium text-slate-600">
                    website
                  </strong>{" "}
                  and{" "}
                  <strong className="font-medium text-slate-600">portal</strong>{" "}
                  also tint the card background with the chosen color. Unknown
                  or missing sources use the Other style. Manual and CRM cards
                  stay untinted.
                </p>
              </div>
              <Button type="button" variant="secondary" size="sm" onClick={addSourceRow}>
                <Plus className="h-4 w-4" />
                Add source
              </Button>
            </div>

            {sourceStylesError ? (
              <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {sourceStylesError}
              </p>
            ) : null}
            {sourceStylesMessage ? (
              <p className="mb-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {sourceStylesMessage}
              </p>
            ) : null}

            <div className="space-y-3">
              <div className="hidden grid-cols-[1fr_1fr_7.5rem_2.25rem] gap-2 text-[11px] font-medium uppercase tracking-wide text-slate-400 sm:grid">
                <span>Payload key</span>
                <span>Label on card</span>
                <span>Color</span>
                <span />
              </div>

              {sourceStyles.sources.map((row, index) => (
                <div
                  key={index}
                  className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_7.5rem_2.25rem] sm:items-center"
                >
                  <input
                    type="text"
                    value={row.key}
                    onChange={(e) =>
                      updateSourceRow(index, { key: e.target.value })
                    }
                    placeholder="e.g. crm"
                    readOnly={row.key.trim().toLowerCase() === "portal"}
                    title={
                      row.key.trim().toLowerCase() === "portal"
                        ? "Portal key must stay \"portal\" so board colors match"
                        : undefined
                    }
                    className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400 read-only:bg-slate-50 read-only:text-slate-500"
                  />
                  <input
                    type="text"
                    value={row.label}
                    onChange={(e) =>
                      updateSourceRow(index, { label: e.target.value })
                    }
                    placeholder="e.g. CRM"
                    className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400"
                  />
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={
                        isHexColor(row.color) && row.color.length === 7
                          ? row.color
                          : "#2563eb"
                      }
                      onChange={(e) =>
                        updateSourceRow(index, { color: e.target.value })
                      }
                      className="h-9 w-10 cursor-pointer rounded border border-slate-200 bg-white p-0.5"
                      title="Pick color"
                    />
                    <input
                      type="text"
                      value={row.color}
                      onChange={(e) =>
                        updateSourceRow(index, { color: e.target.value })
                      }
                      placeholder="#2563eb"
                      className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-2 font-mono text-xs text-slate-800 outline-none focus:border-slate-400"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeSourceRow(index)}
                    disabled={row.key.trim().toLowerCase() === "portal"}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                    title={
                      row.key.trim().toLowerCase() === "portal"
                        ? "Portal source is required"
                        : "Remove source"
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}

              <div className="rounded-md border border-dashed border-slate-200 bg-slate-50/80 p-3">
                <p className="mb-2 text-xs font-medium text-slate-600">
                  Other / unknown source
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_7.5rem] sm:items-center">
                  <input
                    type="text"
                    value={sourceStyles.other.label}
                    onChange={(e) =>
                      setSourceStyles((prev) => ({
                        ...prev,
                        other: { ...prev.other, label: e.target.value },
                      }))
                    }
                    placeholder="Webhook"
                    className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400"
                  />
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={
                        isHexColor(sourceStyles.other.color) &&
                        sourceStyles.other.color.length === 7
                          ? sourceStyles.other.color
                          : "#64748b"
                      }
                      onChange={(e) =>
                        setSourceStyles((prev) => ({
                          ...prev,
                          other: { ...prev.other, color: e.target.value },
                        }))
                      }
                      className="h-9 w-10 cursor-pointer rounded border border-slate-200 bg-white p-0.5"
                      title="Pick color"
                    />
                    <input
                      type="text"
                      value={sourceStyles.other.color}
                      onChange={(e) =>
                        setSourceStyles((prev) => ({
                          ...prev,
                          other: { ...prev.other, color: e.target.value },
                        }))
                      }
                      placeholder="#64748b"
                      className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-2 font-mono text-xs text-slate-800 outline-none focus:border-slate-400"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <Button
                type="button"
                size="sm"
                onClick={saveSourceStyles}
                disabled={savingSourceStyles}
              >
                {savingSourceStyles ? "Saving…" : "Save source labels"}
              </Button>
              {sourceStyles.sources.length > 0 ? (
                <span className="text-xs text-slate-500">
                  {sourceStyles.sources.length} source
                  {sourceStyles.sources.length === 1 ? "" : "s"} configured
                </span>
              ) : null}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-800">
                  AI webhook prompt
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Paste into ChatGPT / Claude with your CRM schema. Updates when
                  field options, source styles, or excluded products change.
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => copyText(aiPrompt, "ai-prompt")}
              >
                {copiedField === "ai-prompt" ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                Copy prompt
              </Button>
            </div>
            <textarea
              readOnly
              value={aiPrompt}
              rows={16}
              className="w-full resize-y rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700"
              spellCheck={false}
            />
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-800">
                  Payload reference
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Share this with the developer integrating your webhook.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => copyText(payloadDocsHtml, "html")}
                >
                  {copiedField === "html" ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  Copy HTML
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => copyText(payloadDocs, "docs")}
                >
                  {copiedField === "docs" ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  Copy Markdown
                </Button>
              </div>
            </div>
            <iframe
              title="Webhook payload reference"
              srcDoc={payloadDocsHtml}
              className="h-[48rem] w-full rounded-md border border-slate-200 bg-white"
              sandbox="allow-same-origin"
            />
          </section>
        </>
      ) : (
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-800">
                Webhook History
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Review what payloads were sent and what the webhook returned.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {historyCountLabel}
              </span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={refreshHistory}
                disabled={loadingHistory}
              >
                <RefreshCw
                  className={`h-4 w-4 ${loadingHistory ? "animate-spin" : ""}`}
                />
                Refresh
              </Button>
            </div>
          </div>

          <div className="relative mb-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              placeholder="Search by order number, status, error…"
              className="w-full rounded-md border border-slate-200 bg-white py-2 pl-9 pr-9 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
            {historySearch ? (
              <button
                type="button"
                onClick={() => setHistorySearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>

          {historyError ? (
            <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {historyError}
            </p>
          ) : null}

          {history.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500">
              No webhook calls yet.
            </p>
          ) : filteredHistory.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500">
              No events match &ldquo;{historySearch}&rdquo;.
            </p>
          ) : (
            <div className="space-y-4">
              {filteredHistory.map((entry) => {
                const sentPayloadText = entry.request_payload
                  ? prettyJson(entry.request_payload)
                  : entry.request_raw || "—";
                const receivedPayloadText = entry.response_payload
                  ? prettyJson(entry.response_payload)
                  : "—";
                const receivedValues = responseValueRows(entry.response_payload);

                return (
                  <article
                    key={entry.id}
                    className="rounded-md border border-slate-200 bg-slate-50 p-4"
                  >
                  <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <span
                      className={`rounded-full px-2 py-0.5 font-medium ${
                        entry.success
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {entry.success ? "Success" : "Failed"}
                    </span>
                    <span>Status {entry.response_status}</span>
                    <span>•</span>
                    <span>{formatDateTime(entry.created_at)}</span>
                    {entry.order_numbers.length > 0 ? (
                      <>
                        <span>•</span>
                        <span>{entry.order_numbers.join(", ")}</span>
                      </>
                    ) : null}
                  </div>

                  {entry.error_message ? (
                    <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                      {entry.error_message}
                    </p>
                  ) : null}

                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Sent payload
                        </p>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            copyText(sentPayloadText, `sent-${entry.id}`)
                          }
                        >
                          {copiedField === `sent-${entry.id}` ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                          Copy
                        </Button>
                      </div>
                      <pre className="max-h-64 overflow-auto rounded-md bg-white p-3 text-xs text-slate-700">
                        {sentPayloadText}
                      </pre>
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Retrieved response
                      </p>
                      {receivedValues.length > 0 ? (
                        <div className="mb-2 max-h-40 overflow-auto rounded-md border border-slate-200 bg-white p-2">
                          {receivedValues.map((row) => (
                            <div
                              key={row.key}
                              className="grid grid-cols-[9rem_1fr] gap-2 border-b border-slate-100 py-1 last:border-b-0"
                            >
                              <span className="text-[11px] font-semibold text-slate-500">
                                {row.key}
                              </span>
                              <span className="break-all text-[11px] text-slate-700">
                                {row.value}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <pre className="max-h-64 overflow-auto rounded-md bg-white p-3 text-xs text-slate-700">
                        {receivedPayloadText}
                      </pre>
                    </div>
                  </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function BazaarPortalSyncSection({
  config,
  setConfig,
  setError,
  setMessage,
}: {
  config: WebhookConfig | null;
  setConfig: (c: WebhookConfig | null) => void;
  setError: (s: string | null) => void;
  setMessage: (s: string | null) => void;
}) {
  const [apiUrl, setApiUrl] = useState(config?.bazaar_api_url ?? "");
  const [enabled, setEnabled] = useState(
    config?.bazaar_portal_sync_enabled === true
  );
  const [rows, setRows] = useState<
    Array<{ brokerId: string; osk: string; label: string }>
  >(() => {
    const map = config?.bazaar_portal_inbound_keys ?? {};
    const labels = config?.bazaar_portal_partner_labels ?? {};
    const entries = Object.entries(map);
    if (entries.length === 0) {
      return [{ brokerId: "", osk: "", label: "" }];
    }
    return entries.map(([brokerId, osk]) => ({
      brokerId,
      osk,
      label: labels[brokerId] ?? "",
    }));
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [localStatus, setLocalStatus] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  const callbackUrl = apiUrl.trim()
    ? `${apiUrl.trim().replace(/\/$/, "")}/api/v1/production/status`
    : "";

  async function save() {
    if (!config) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    setLocalStatus(null);
    const keyMap: Record<string, { osk: string; label: string }> = {};
    for (const r of rows) {
      const id = r.brokerId.trim();
      const osk = r.osk.trim();
      if (!id && !osk && !r.label.trim()) continue;
      if (!id || !osk.startsWith("osk_")) {
        const text =
          "Each partner row needs brokerId (left) and an osk_… inbound key (right)";
        setError(text);
        setLocalStatus({ kind: "err", text });
        setSaving(false);
        return;
      }
      keyMap[id] = { osk, label: r.label.trim() };
    }
    try {
      const res = await fetch("/api/webhook-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bazaar_api_url: apiUrl.trim() || null,
          bazaar_portal_inbound_keys: keyMap,
          bazaar_portal_sync_enabled: enabled,
        }),
      });
      const json = (await res.json()) as {
        config?: WebhookConfig;
        error?: string;
      };
      if (!res.ok) {
        const text = json.error ?? "Failed to save Bazaar portal sync";
        setError(text);
        setLocalStatus({ kind: "err", text });
        return;
      }
      if (json.config) {
        setConfig(json.config);
        const labels = json.config.bazaar_portal_partner_labels ?? {};
        const keys = json.config.bazaar_portal_inbound_keys ?? {};
        const nextRows = Object.entries(keys).map(([brokerId, osk]) => ({
          brokerId,
          osk,
          label: labels[brokerId] ?? "",
        }));
        setRows(
          nextRows.length > 0
            ? nextRows
            : [{ brokerId: "", osk: "", label: "" }]
        );
      }
      setMessage("Bazaar portal status sync saved");
      setLocalStatus({ kind: "ok", text: "Saved — partner names kept" });
    } catch (err) {
      const text = err instanceof Error ? err.message : "Save failed";
      setError(text);
      setLocalStatus({ kind: "err", text });
    } finally {
      setSaving(false);
    }
  }

  async function testFirstRow() {
    const row = rows.find((r) => r.osk.trim().startsWith("osk_"));
    if (!apiUrl.trim() || !row) {
      const text =
        "Set Bazaar API URL and at least one osk_… inbound key to test";
      setError(text);
      setLocalStatus({ kind: "err", text });
      return;
    }
    setTesting(true);
    setError(null);
    setMessage(null);
    setLocalStatus({
      kind: "ok",
      text: "Testing connection to Bazaar… please wait",
    });
    try {
      const res = await fetch("/api/webhook-config/test-bazaar-portal-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bazaar_api_url: apiUrl.trim(),
          osk_key: row.osk.trim(),
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        const text =
          json.message ?? json.error ?? `Connection test failed (HTTP ${res.status})`;
        setError(text);
        setLocalStatus({ kind: "err", text });
        return;
      }
      const text = json.message ?? "Connection OK";
      setMessage(text);
      setLocalStatus({ kind: "ok", text });
    } catch (err) {
      const text = err instanceof Error ? err.message : "Test failed";
      setError(text);
      setLocalStatus({ kind: "err", text });
    } finally {
      setTesting(false);
    }
  }

  if (!config) return null;

  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50/80 p-5 shadow-sm">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-800">
            Bazaar portal status sync
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Paste from Bazaar Admin → Partners → Integrations → Order Sync →{" "}
            <strong className="font-medium text-slate-700">
              Paste into Workflow
            </strong>
            . Field labels match that panel. Leave sync disabled until Test
            connection succeeds.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => setEnabled((v) => !v)}
            className={`inline-flex items-center gap-3 rounded-lg border px-3 py-2 text-sm font-semibold shadow-sm transition-colors ${
              enabled
                ? "border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            <span
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                enabled ? "bg-emerald-500" : "bg-slate-300"
              }`}
              aria-hidden
            >
              <span
                className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  enabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </span>
            <span>{enabled ? "Sync on" : "Sync off"}</span>
          </button>
          <p className="text-[11px] text-slate-500">
            Click to toggle · Save to apply
          </p>
        </div>
      </div>

      <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Bazaar API URL
          </p>
          <input
            type="url"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder="https://api.bazaarprinting.com or http://localhost:3002"
            className="w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-sm text-slate-800"
          />
          <p className="mt-1 text-xs text-slate-500">
            Copy from Admin → <em>Bazaar API URL</em>. Use localhost only when
            Workflow runs on the same machine as the API.
          </p>
        </div>

        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Status callback URL
          </p>
          <input
            type="text"
            readOnly
            value={callbackUrl || "— set Bazaar API URL above —"}
            className="w-full rounded-md border border-slate-100 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600"
          />
          <p className="mt-1 text-xs text-slate-500">
            Reference only (matches Admin → <em>Status callback URL</em>). Workflow
            POSTs here automatically — you do not paste this separately.
          </p>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Partner keys — one row per partner
          </p>
          <div className="mb-1.5 hidden gap-2 text-[11px] font-medium uppercase tracking-wide text-slate-400 sm:grid sm:grid-cols-[minmax(7rem,1fr)_minmax(10rem,1.2fr)_minmax(14rem,2fr)_2rem]">
            <span>Partner name</span>
            <span>brokerId (left)</span>
            <span>osk_… inbound key (right)</span>
            <span />
          </div>
          <div className="space-y-2">
            {rows.map((row, i) => (
              <div
                key={i}
                className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(7rem,1fr)_minmax(10rem,1.2fr)_minmax(14rem,2fr)_2rem] sm:items-center"
              >
                <input
                  value={row.label}
                  onChange={(e) => {
                    const next = [...rows];
                    next[i] = { ...row, label: e.target.value };
                    setRows(next);
                  }}
                  placeholder="Partner name"
                  title="Optional note — copy Partner name from Admin"
                  className="rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-800"
                />
                <input
                  value={row.brokerId}
                  onChange={(e) => {
                    const next = [...rows];
                    next[i] = { ...row, brokerId: e.target.value };
                    setRows(next);
                  }}
                  placeholder="brokerId"
                  title="Copy brokerId from Admin Paste into Workflow"
                  className="rounded-md border border-slate-200 px-2 py-1.5 font-mono text-xs text-slate-800"
                />
                <input
                  value={row.osk}
                  onChange={(e) => {
                    const next = [...rows];
                    next[i] = { ...row, osk: e.target.value };
                    setRows(next);
                  }}
                  placeholder="osk_…"
                  title="Copy osk_… inbound key from Admin"
                  className="rounded-md border border-slate-200 px-2 py-1.5 font-mono text-xs text-slate-800"
                />
                <button
                  type="button"
                  className="justify-self-start rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 sm:justify-self-center"
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                  aria-label="Remove row"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900"
            onClick={() =>
              setRows([...rows, { brokerId: "", osk: "", label: "" }])
            }
          >
            <Plus className="h-4 w-4" /> Add partner
          </button>
          <p className="mt-2 text-xs text-slate-500">
            Partner name is saved with the row (for your notes).{" "}
            <strong className="font-medium text-slate-600">brokerId</strong> and{" "}
            <strong className="font-medium text-slate-600">osk_…</strong> must
            match Admin → Paste into Workflow. Same webhook URL also receives CRM
            orders (<code className="text-[11px]">source: crm</code>) — only
            portal cards use these keys.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          <Button type="button" size="sm" onClick={save} disabled={saving || testing}>
            {saving ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Saving…
              </span>
            ) : (
              "Save"
            )}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={testFirstRow}
            disabled={testing || saving}
          >
            {testing ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Testing…
              </span>
            ) : (
              "Test connection"
            )}
          </Button>
          {localStatus ? (
            <p
              className={`w-full text-sm sm:w-auto ${
                testing
                  ? "text-slate-600"
                  : localStatus.kind === "ok"
                    ? "text-emerald-700"
                    : "text-red-700"
              }`}
            >
              {testing ? "… " : localStatus.kind === "ok" ? "✓ " : "✗ "}
              {localStatus.text}
            </p>
          ) : null}
          {testing || saving ? (
            <div className="h-1 w-full overflow-hidden rounded bg-slate-100">
              <div className="h-full w-1/3 animate-pulse rounded bg-slate-400" />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

