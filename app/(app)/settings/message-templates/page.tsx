import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ensureMessageTemplates } from "@/lib/message-templates.server";
import { DEFAULT_MESSAGE_TEMPLATES } from "@/lib/message-templates";
import { MessageTemplatesManager } from "./message-templates-manager";

function formatLoadError(message: string): string {
  if (
    message.includes("message_templates") ||
    message.includes("schema cache") ||
    message.includes("does not exist")
  ) {
    return "Message templates require migration 0058_message_templates.sql (run supabase db push).";
  }
  return message;
}

export default async function MessageTemplatesPage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");
  if (ctx.role !== "admin") redirect("/board");

  const supabase = await createClient();
  let loadError: string | null = null;
  let templates = DEFAULT_MESSAGE_TEMPLATES;

  try {
    templates = await ensureMessageTemplates(supabase, ctx.tenant.id);
  } catch (err) {
    loadError = formatLoadError(
      err instanceof Error ? err.message : "Could not load message templates"
    );
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-800">
        SMS / Email templates
      </h1>
      <p className="mb-6 text-sm text-slate-500">
        Edit customer notification copy. Use placeholders like{" "}
        <code className="rounded bg-slate-100 px-1 text-xs">
          {"{{order_number}}"}
        </code>
        . Column rules and button automations have their own templates under
        Button Automation.
      </p>
      {loadError ? (
        <p className="mb-4 text-sm text-red-600">{loadError}</p>
      ) : null}
      <MessageTemplatesManager
        initialTemplates={templates}
        defaults={DEFAULT_MESSAGE_TEMPLATES}
      />
    </div>
  );
}
