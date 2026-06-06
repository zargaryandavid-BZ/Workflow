import type { SystemConfig } from "@/lib/system-config.types";

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

export async function importSystemConfig(
  config: SystemConfig
): Promise<ImportResult> {
  const res = await fetch("/api/system-config/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok && !(json as ImportResult).summary) {
    throw new Error(
      (json as { error?: string }).error ?? "Failed to import configuration"
    );
  }
  return json as ImportResult;
}
