import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadTeamMembers } from "@/lib/team-members";
import { generateWebhookSecret } from "@/lib/webhook-config";
import { exportIntegrationConfig } from "@/lib/system-config-sanitize";
import type {
  AutomationConfig,
  ColumnConfig,
  CustomFieldConfig,
  IntegrationConfig,
  SystemConfig,
  TeamMemberConfig,
} from "@/lib/system-config.types";
import type { BoardColumn, CustomField } from "@/lib/types";

export interface ImportResult {
  success: boolean;
  summary: {
    columns: number;
    custom_fields: number;
    automations: number;
    integrations: number;
  };
  errors: string[];
}

function columnIdToName(
  columns: { id: string; name: string }[],
  id: string | null
): string | null {
  if (!id) return null;
  return columns.find((c) => c.id === id)?.name ?? null;
}

function exportAutomationConfig(
  config: Record<string, unknown>,
  columns: { id: string; name: string }[]
): Record<string, unknown> {
  const out = { ...config };
  if (typeof out.rejected_to_column === "string") {
    out.rejected_to_column =
      columnIdToName(columns, out.rejected_to_column) ?? out.rejected_to_column;
  }
  return out;
}

function toColumnConfig(row: BoardColumn): ColumnConfig {
  return {
    name: row.name,
    position: row.position,
    color: row.color,
    kind: row.kind,
    image_url: row.image_url,
    drop_in_roles: row.drop_in_roles,
    drop_out_roles: row.drop_out_roles,
  };
}

function toCustomFieldConfig(row: CustomField): CustomFieldConfig {
  return {
    name: row.name,
    field_type: row.field_type,
    options: Array.isArray(row.options) ? row.options : [],
    required: row.required,
    position: row.position,
  };
}

export async function exportSystemConfigForTenant(
  supabase: SupabaseClient,
  tenantId: string,
  tenantName: string
): Promise<SystemConfig> {
  const [
    columnsRes,
    customFieldsRes,
    automationsRes,
    webhookRes,
    teamRes,
  ] = await Promise.all([
    supabase
      .from("board_columns")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("position", { ascending: true }),
    supabase
      .from("custom_fields")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("position", { ascending: true }),
    supabase
      .from("automation_rules")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true }),
    supabase
      .from("webhook_configs")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    loadTeamMembers(tenantId),
  ]);

  const columns = (columnsRes.data ?? []) as BoardColumn[];
  const customFields = (customFieldsRes.data ?? []) as CustomField[];
  const automations = automationsRes.data ?? [];
  const webhook = webhookRes.data as
    | {
        enabled: boolean;
        label: string;
        secret_key: string;
      }
    | null;

  const team: TeamMemberConfig[] = (teamRes.members ?? []).map((m) => ({
    email: m.email ?? "",
    full_name: m.profile?.full_name ?? null,
    role: m.role,
  }));

  const integrations: IntegrationConfig[] = webhook
    ? [
        {
          name: webhook.label,
          provider: "webhook",
          enabled: webhook.enabled,
          config: exportIntegrationConfig({ secret_key: webhook.secret_key }),
        },
      ]
    : [];

  const automationConfigs: AutomationConfig[] = automations.map((rule) => {
    const r = rule as {
      trigger: AutomationConfig["trigger"];
      from_column: string | null;
      to_column: string | null;
      config: Record<string, unknown>;
      enabled: boolean;
    };
    return {
      trigger: r.trigger,
      from_column: columnIdToName(columns, r.from_column),
      to_column: columnIdToName(columns, r.to_column),
      config: exportAutomationConfig(r.config ?? {}, columns),
      enabled: r.enabled,
    };
  });

  return {
    version: "1.0",
    exported_at: new Date().toISOString(),
    tenant_name: tenantName,
    columns: columns.map((row, i) => ({ ...toColumnConfig(row), position: i })),
    custom_fields: customFields.map((row, i) => ({
      ...toCustomFieldConfig(row),
      position: i,
    })),
    automations: automationConfigs,
    integrations,
    team,
  };
}

function resolveColumnId(
  nameToId: Map<string, string>,
  name: string | null
): string | null {
  if (!name) return null;
  return nameToId.get(name) ?? null;
}

function importAutomationConfig(
  config: Record<string, unknown>,
  nameToId: Map<string, string>
): Record<string, unknown> {
  const out = { ...config };
  if (typeof out.rejected_to_column === "string") {
    const resolved = resolveColumnId(nameToId, out.rejected_to_column);
    if (resolved) out.rejected_to_column = resolved;
  }
  return out;
}

export async function importSystemConfigForTenant(
  supabase: SupabaseClient,
  config: SystemConfig,
  tenantId: string
): Promise<ImportResult> {
  const errors: string[] = [];
  const summary = {
    columns: 0,
    custom_fields: 0,
    automations: 0,
    integrations: 0,
  };

  const { data: existingColumns } = await supabase
    .from("board_columns")
    .select("id, name")
    .eq("tenant_id", tenantId);

  const nameToId = new Map<string, string>();
  for (const col of existingColumns ?? []) {
    nameToId.set(col.name as string, col.id as string);
  }

  for (const col of config.columns) {
    const existingId = nameToId.get(col.name);
    if (existingId) {
      const { error } = await supabase
        .from("board_columns")
        .update({
          position: col.position,
          color: col.color,
          kind: col.kind,
          image_url: col.image_url,
          drop_in_roles: col.drop_in_roles,
          drop_out_roles: col.drop_out_roles,
        })
        .eq("id", existingId);
      if (error) errors.push(`Column "${col.name}": ${error.message}`);
      else summary.columns++;
    } else {
      const { data, error } = await supabase
        .from("board_columns")
        .insert({
          tenant_id: tenantId,
          name: col.name,
          position: col.position,
          color: col.color,
          kind: col.kind,
          image_url: col.image_url,
          drop_in_roles: col.drop_in_roles,
          drop_out_roles: col.drop_out_roles,
        })
        .select("id")
        .single();
      if (error) errors.push(`Column "${col.name}": ${error.message}`);
      else {
        nameToId.set(col.name, data.id as string);
        summary.columns++;
      }
    }
  }

  const { data: existingFields } = await supabase
    .from("custom_fields")
    .select("id, name")
    .eq("tenant_id", tenantId);

  const fieldNameToId = new Map<string, string>();
  for (const field of existingFields ?? []) {
    fieldNameToId.set(field.name as string, field.id as string);
  }

  for (const field of config.custom_fields) {
    const existingId = fieldNameToId.get(field.name);
    if (existingId) {
      const { error } = await supabase
        .from("custom_fields")
        .update({
          field_type: field.field_type,
          options: field.options,
          required: field.required,
          position: field.position,
        })
        .eq("id", existingId);
      if (error) errors.push(`Custom field "${field.name}": ${error.message}`);
      else summary.custom_fields++;
    } else {
      const { error } = await supabase.from("custom_fields").insert({
        tenant_id: tenantId,
        name: field.name,
        field_type: field.field_type,
        options: field.options,
        required: field.required,
        position: field.position,
      });
      if (error) errors.push(`Custom field "${field.name}": ${error.message}`);
      else summary.custom_fields++;
    }
  }

  const { error: delAutoErr } = await supabase
    .from("automation_rules")
    .delete()
    .eq("tenant_id", tenantId);
  if (delAutoErr) {
    errors.push(`Clearing automations: ${delAutoErr.message}`);
  } else if (config.automations.length > 0) {
    const rows = config.automations.map((rule) => ({
      tenant_id: tenantId,
      trigger: rule.trigger,
      from_column: resolveColumnId(nameToId, rule.from_column),
      to_column: resolveColumnId(nameToId, rule.to_column),
      config: importAutomationConfig(rule.config ?? {}, nameToId),
      enabled: rule.enabled,
    }));

    const missingRefs = config.automations
      .filter((rule, i) => {
        const row = rows[i]!;
        return (
          (rule.from_column && !row.from_column) ||
          (rule.to_column && !row.to_column)
        );
      })
      .map((rule) => rule.trigger);

    if (missingRefs.length > 0) {
      errors.push(
        `Some automations reference columns that could not be resolved: ${missingRefs.join(", ")}`
      );
    }

    const { error } = await supabase.from("automation_rules").insert(rows);
    if (error) errors.push(`Inserting automations: ${error.message}`);
    else summary.automations = rows.length;
  }

  for (const integration of config.integrations) {
    if (integration.provider !== "webhook") continue;

    const label = integration.name || "Default webhook";

    const { data: existing } = await supabase
      .from("webhook_configs")
      .select("id")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from("webhook_configs")
        .update({
          enabled: integration.enabled,
          label,
        })
        .eq("tenant_id", tenantId);
      if (error) {
        errors.push(`Integration "${integration.provider}": ${error.message}`);
      } else summary.integrations++;
    } else {
      const { error } = await supabase.from("webhook_configs").insert({
        tenant_id: tenantId,
        enabled: integration.enabled,
        label,
        secret_key: generateWebhookSecret(),
      });
      if (error) {
        errors.push(`Integration "${integration.provider}": ${error.message}`);
      } else summary.integrations++;
    }
  }

  return { success: errors.length === 0, summary, errors };
}
