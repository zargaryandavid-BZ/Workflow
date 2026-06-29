import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ensureWebhookConfig } from "@/lib/webhook-config";
import { IntegrationsManager } from "./integrations-manager";
import type { WebhookConfig, WebhookHistoryEntry } from "@/lib/types";

function formatWebhookLoadError(message: string): string {
  if (
    message.includes("webhook_configs") ||
    message.includes("webhook_history") ||
    message.includes("schema cache") ||
    message.includes("does not exist")
  ) {
    return "Webhook database tables are not set up yet. Apply migrations including 0015_webhook_configs, 0016_assets_external_url, and 0029_webhook_history (run supabase db push).";
  }
  return message;
}

export default async function IntegrationsSettingsPage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");
  if (ctx.role !== "admin") redirect("/board");

  const supabase = await createClient();
  let config: WebhookConfig | null = null;
  let loadError: string | null = null;
  let history: WebhookHistoryEntry[] = [];
  let historyLoadError: string | null = null;
  try {
    config = await ensureWebhookConfig(supabase, ctx.tenant.id);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not load webhook settings";
    loadError = formatWebhookLoadError(message);
  }

  const { data: historyRows, error: historyError } = await supabase
    .from("webhook_history")
    .select("*")
    .eq("tenant_id", ctx.tenant.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (historyError) {
    historyLoadError = historyError.message;
  } else {
    history = (historyRows ?? []) as WebhookHistoryEntry[];
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    "http://localhost:3000";

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-800">
        Integrations
      </h1>
      <p className="mb-6 text-sm text-slate-500">
        Connect external applications to automatically create orders.
      </p>
      <IntegrationsManager
        initialConfig={config}
        loadError={loadError}
        initialHistory={history}
        historyLoadError={historyLoadError}
        webhookUrl={`${appUrl}/api/webhook/orders`}
      />
    </div>
  );
}
