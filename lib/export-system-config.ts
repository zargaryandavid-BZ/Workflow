import type { SystemConfig } from "@/lib/system-config.types";

export async function exportSystemConfig(): Promise<SystemConfig> {
  const res = await fetch("/api/system-config/export");
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (json as { error?: string }).error ?? "Failed to export configuration"
    );
  }
  return json as SystemConfig;
}

export function downloadConfig(config: SystemConfig) {
  const json = JSON.stringify(config, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const date = new Date().toISOString().split("T")[0];
  const slug = config.tenant_name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  a.href = url;
  a.download = `${slug || "workspace"}-config-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
