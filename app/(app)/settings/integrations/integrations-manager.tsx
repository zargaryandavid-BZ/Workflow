"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";
import type { WebhookConfig } from "@/lib/types";

function buildPayloadDocs(webhookUrl: string, secretKey: string): string {
  return `POST ${webhookUrl}

Headers:
  x-webhook-secret: ${secretKey}
  Content-Type: application/json

Body (JSON):
{
  // REQUIRED
  "customer_name": "Acme Corp",
  "customer_contact": "hello@acme.com",

  // RECOMMENDED
  "order_number": "ORD-2024-001",
  "title": "500 Business Cards — Acme Corp",
  "priority": "normal",
  "due_date": "2024-07-01",

  // ORDER DETAILS
  "product": "Business Cards",
  "product_type": "Flat",
  "finished_size": "3.5 x 2 in",
  "materials": "16pt.",
  "finishing": "Spot UV",
  "sides": "2 Sides",
  "color": "CMYK",
  "order_qty": 500,

  // CUSTOMER INFO
  "customer_phone": "+1 310 555 0100",

  // ARTWORK (public URL only — no file upload)
  "artwork_url": "https://cdn.example.com/art.pdf",

  // ORDER DESCRIPTION / NOTES
  "description": "Rush order, please handle ASAP",

  // SKUs (optional array)
  "skus": [
    {
      "sku_name": "Standard Pack",
      "quantity": 250,
      "artwork_url": "https://cdn.example.com/sku1.pdf"
    },
    {
      "sku_name": "Premium Pack",
      "quantity": 250,
      "artwork_url": "https://cdn.example.com/sku2.pdf"
    }
  ]
}

// NOT SUPPORTED via webhook (set manually in app):
// - Designer assignment
// - GDrive artwork link
// - Missing Info notes

Success response:
{ "success": true, "order_id": "uuid", "order_number": "ORD-2024-001" }

Error responses:
401 — Invalid or missing secret key
403 — Webhook is disabled
422 — Missing required fields
500 — Server error`;
}

interface Props {
  initialConfig: WebhookConfig;
  webhookUrl: string;
}

export function IntegrationsManager({ initialConfig, webhookUrl }: Props) {
  const router = useRouter();
  const [config, setConfig] = useState(initialConfig);
  const [toggling, setToggling] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  async function copyText(text: string, field: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      setError("Could not copy to clipboard");
    }
  }

  async function toggleEnabled() {
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

  const payloadDocs = buildPayloadDocs(webhookUrl, config.secret_key);

  return (
    <div className="space-y-6">
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
              Payload reference
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Share this with the developer integrating your webhook.
            </p>
          </div>
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
            Copy
          </Button>
        </div>
        <pre className="max-h-[32rem] overflow-auto rounded-md bg-slate-950 p-4 text-xs leading-relaxed text-slate-100">
          {payloadDocs}
        </pre>
      </section>
    </div>
  );
}
