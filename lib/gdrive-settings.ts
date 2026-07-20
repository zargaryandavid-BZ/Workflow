import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  GdriveLinkTarget,
  GdriveSettings,
  GdriveSettingsPublic,
  MaskedSecret,
} from "@/lib/types";

type Client = SupabaseClient;

const SECRET_MASK = "••••••••";

function maskSecret(value: string | null): MaskedSecret {
  if (!value?.trim()) return { set: false, preview: null };
  const trimmed = value.trim();
  const tail = trimmed.length > 4 ? trimmed.slice(-4) : trimmed;
  return { set: true, preview: `${SECRET_MASK}${tail}` };
}

function parseLinkTarget(v: unknown): GdriveLinkTarget {
  if (v === "customer" || v === "order" || v === "final") return v;
  return "final";
}

function rowToSettings(row: Record<string, unknown>): GdriveSettings {
  return {
    tenant_id: String(row.tenant_id),
    enabled: Boolean(row.enabled),
    client_email: (row.client_email as string | null) ?? null,
    private_key: (row.private_key as string | null) ?? null,
    root_folder_id: (row.root_folder_id as string | null) ?? null,
    shared_drive_id: (row.shared_drive_id as string | null) ?? null,
    final_folder_name:
      (row.final_folder_name as string | null)?.trim() || "Final for Prod",
    link_target: parseLinkTarget(row.link_target),
    open_on_create: row.open_on_create !== false,
    updated_at: (row.updated_at as string) ?? new Date().toISOString(),
  };
}

export function toPublicGdriveSettings(
  settings: GdriveSettings
): GdriveSettingsPublic {
  return {
    tenant_id: settings.tenant_id,
    enabled: settings.enabled,
    client_email: settings.client_email,
    private_key: maskSecret(settings.private_key),
    root_folder_id: settings.root_folder_id,
    shared_drive_id: settings.shared_drive_id,
    final_folder_name: settings.final_folder_name,
    link_target: settings.link_target,
    open_on_create: settings.open_on_create,
    updated_at: settings.updated_at,
    configured: isGdriveConfigured(settings),
  };
}

export function isGdriveConfigured(settings: GdriveSettings | null): boolean {
  if (!settings) return false;
  return Boolean(
    settings.client_email?.trim() &&
      settings.private_key?.trim() &&
      settings.root_folder_id?.trim()
  );
}

export async function ensureGdriveSettings(
  client: Client,
  tenantId: string
): Promise<GdriveSettings> {
  const { data: existing } = await client
    .from("gdrive_settings")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (existing) {
    return rowToSettings(existing as Record<string, unknown>);
  }

  const { data: created, error } = await client
    .from("gdrive_settings")
    .insert({ tenant_id: tenantId })
    .select("*")
    .single();

  if (error || !created) {
    throw new Error(error?.message ?? "Failed to create gdrive settings");
  }
  return rowToSettings(created as Record<string, unknown>);
}

export type GdriveSettingsPatch = {
  enabled?: boolean;
  client_email?: string | null;
  private_key?: string | null;
  root_folder_id?: string | null;
  shared_drive_id?: string | null;
  final_folder_name?: string | null;
  link_target?: GdriveLinkTarget;
  open_on_create?: boolean;
  /** Paste full service-account JSON to fill client_email + private_key. */
  service_account_json?: string | null;
};

export function buildGdriveSettingsUpdate(
  existing: GdriveSettings,
  patch: GdriveSettingsPatch
): Record<string, unknown> {
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (typeof patch.service_account_json === "string" && patch.service_account_json.trim()) {
    try {
      const parsed = JSON.parse(patch.service_account_json) as {
        client_email?: string;
        private_key?: string;
      };
      if (parsed.client_email?.trim()) {
        updates.client_email = parsed.client_email.trim();
      }
      if (parsed.private_key?.trim()) {
        updates.private_key = parsed.private_key;
      }
    } catch {
      throw new Error("service_account_json is not valid JSON");
    }
  }

  if (patch.enabled !== undefined) updates.enabled = Boolean(patch.enabled);
  if (patch.client_email !== undefined) {
    updates.client_email = patch.client_email?.trim() || null;
  }
  if (patch.private_key !== undefined && patch.private_key?.trim()) {
    updates.private_key = patch.private_key;
  }
  if (patch.root_folder_id !== undefined) {
    updates.root_folder_id = patch.root_folder_id?.trim() || null;
  }
  if (patch.shared_drive_id !== undefined) {
    updates.shared_drive_id = patch.shared_drive_id?.trim() || null;
  }
  if (patch.final_folder_name !== undefined) {
    updates.final_folder_name =
      patch.final_folder_name?.trim() || "Final for Prod";
  }
  if (patch.link_target !== undefined) {
    updates.link_target = parseLinkTarget(patch.link_target);
  }
  if (patch.open_on_create !== undefined) {
    updates.open_on_create = Boolean(patch.open_on_create);
  }

  void existing;
  return updates;
}
