"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";
import { buildWebhookPayloadDocs, buildWebhookPayloadDocsHtml } from "@/lib/webhook-payload-docs";
import type { WebhookConfig, WebhookHistoryEntry } from "@/lib/types";

interface Props {
  initialConfig: WebhookConfig | null;
  loadError: string | null;
  initialHistory: WebhookHistoryEntry[];
  historyLoadError: string | null;
  webhookUrl: string;
  productOptions: string[];
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
  productOptions,
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
  const historyCountLabel = `${history.length} event${history.length === 1 ? "" : "s"}`;

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

          {historyError ? (
            <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {historyError}
            </p>
          ) : null}

          {history.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500">
              No webhook calls yet.
            </p>
          ) : (
            <div className="space-y-4">
              {history.map((entry) => {
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
