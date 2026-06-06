import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ensureWebhookConfig } from "@/lib/webhook-config";
import { IntegrationsManager } from "./integrations-manager";
import type { WebhookConfig } from "@/lib/types";

export default async function IntegrationsSettingsPage() {
  const ctx = await getTenantContext();
  if (!ctx) return null;
  if (ctx.role !== "admin") redirect("/board");

  const supabase = await createClient();
  let config: WebhookConfig;
  try {
    config = await ensureWebhookConfig(supabase, ctx.tenant.id);
  } catch {
    redirect("/board");
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
        webhookUrl={`${appUrl}/api/webhook/orders`}
      />
    </div>
  );
}
