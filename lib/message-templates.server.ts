import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_MESSAGE_TEMPLATES,
  mergeMessageTemplates,
  sanitizeMessageTemplatesPatch,
  type MessageTemplateMap,
} from "@/lib/message-templates";

type Client = SupabaseClient;

export async function ensureMessageTemplates(
  client: Client,
  tenantId: string
): Promise<MessageTemplateMap> {
  const { data: existing, error } = await client
    .from("message_templates")
    .select("templates")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) throw error;

  if (existing) {
    return mergeMessageTemplates(
      existing.templates as Record<string, unknown> | null
    );
  }

  const { error: insertError } = await client.from("message_templates").insert({
    tenant_id: tenantId,
    templates: {},
    updated_at: new Date().toISOString(),
  });

  if (insertError) {
    // Race: another request may have inserted — re-read.
    const { data: again, error: againError } = await client
      .from("message_templates")
      .select("templates")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (againError) throw againError;
    if (again) {
      return mergeMessageTemplates(
        again.templates as Record<string, unknown> | null
      );
    }
    throw insertError;
  }

  return { ...DEFAULT_MESSAGE_TEMPLATES };
}

export async function getMessageTemplates(
  client: Client,
  tenantId: string
): Promise<MessageTemplateMap> {
  try {
    return await ensureMessageTemplates(client, tenantId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Migration not applied yet — fall back to hardcoded defaults.
    if (
      message.includes("message_templates") ||
      message.includes("schema cache") ||
      message.includes("does not exist")
    ) {
      return { ...DEFAULT_MESSAGE_TEMPLATES };
    }
    throw err;
  }
}

export async function saveMessageTemplates(
  client: Client,
  tenantId: string,
  patch: Record<string, unknown>
): Promise<MessageTemplateMap> {
  await ensureMessageTemplates(client, tenantId);
  const sanitized = sanitizeMessageTemplatesPatch(patch);
  if (Object.keys(sanitized).length === 0) {
    return getMessageTemplates(client, tenantId);
  }

  const current = await getMessageTemplates(client, tenantId);
  const next: MessageTemplateMap = { ...current, ...sanitized };

  const { error } = await client
    .from("message_templates")
    .update({
      templates: next,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId);

  if (error) throw error;
  return next;
}
