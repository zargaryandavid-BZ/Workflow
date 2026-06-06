"use client";

import { useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadConfig, exportSystemConfig } from "@/lib/export-system-config";
import { importSystemConfig } from "@/lib/import-system-config";
import type { SystemConfig } from "@/lib/system-config.types";
import { validateSystemConfig } from "@/lib/validate-system-config";

type ImportStep = "idle" | "preview" | "importing" | "done";

export function SystemConfigPanel() {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [importStep, setImportStep] = useState<ImportStep>("idle");
  const [importConfig, setImportConfig] = useState<SystemConfig | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importResult, setImportResult] = useState<Awaited<
    ReturnType<typeof importSystemConfig>
  > | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    setExportSuccess(false);
    try {
      const config = await exportSystemConfig();
      downloadConfig(config);
      setExportSuccess(true);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const raw = JSON.parse(ev.target?.result as string);
        const { valid, errors } = validateSystemConfig(raw);
        if (!valid) {
          setImportErrors(errors);
          setImportConfig(null);
          setImportStep("preview");
          return;
        }
        setImportErrors([]);
        setImportConfig(raw as SystemConfig);
        setImportStep("preview");
      } catch {
        setImportErrors(["File is not valid JSON"]);
        setImportConfig(null);
        setImportStep("preview");
      }
    };
    reader.readAsText(file);
  }

  async function handleConfirmImport() {
    if (!importConfig) return;
    setImportStep("importing");
    try {
      const result = await importSystemConfig(importConfig);
      setImportResult(result);
      setImportStep("done");
    } catch (e) {
      setImportResult({
        success: false,
        summary: {
          columns: 0,
          custom_fields: 0,
          automations: 0,
          integrations: 0,
        },
        errors: [e instanceof Error ? e.message : "Import failed"],
      });
      setImportStep("done");
    }
  }

  function resetImport() {
    setImportStep("idle");
    setImportConfig(null);
    setImportErrors([]);
    setImportResult(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="mt-10 border-t border-slate-200 pt-8">
      <h2 className="mb-1 text-base font-semibold text-slate-800">
        System Configuration
      </h2>
      <p className="mb-6 text-sm text-slate-500">
        Export your entire system setup as a JSON file, or import a previously
        exported config to restore or copy settings to another instance.
      </p>

      <div className="mb-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-700">
              Export configuration
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              Downloads a JSON file with columns, custom fields, automations,
              integrations, and team roles. API keys are redacted automatically.
            </p>
            {exportError ? (
              <p className="mt-2 text-xs text-red-600">{exportError}</p>
            ) : null}
            {exportSuccess ? (
              <p className="mt-2 text-xs text-green-700">
                Configuration exported successfully.
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className="shrink-0"
          >
            {exporting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Exporting…
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Export JSON
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <p className="mb-1 text-sm font-medium text-slate-700">
          Import configuration
        </p>
        <p className="mb-4 text-xs text-slate-400">
          Upload a config JSON exported from this app. Columns, custom fields,
          and automations will be updated. Team member accounts are shown in
          preview but are not created automatically — they must be invited
          separately.
        </p>

        {importStep === "idle" && (
          <label className="flex cursor-pointer items-center gap-3">
            <span className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200">
              Choose JSON file
            </span>
            <span className="text-xs text-slate-400">No file selected</span>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleFileSelect}
            />
          </label>
        )}

        {importStep === "preview" && (
          <div>
            {importErrors.length > 0 ? (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4">
                <p className="mb-2 text-sm font-medium text-red-700">
                  Invalid configuration file
                </p>
                <ul className="space-y-1 text-xs text-red-600">
                  {importErrors.map((err, i) => (
                    <li key={i}>• {err}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
                <p className="mb-3 text-sm font-medium text-amber-800">
                  Review before importing
                </p>
                <p className="mb-3 text-xs text-amber-700">
                  Exported from: <strong>{importConfig?.tenant_name}</strong> on{" "}
                  {importConfig?.exported_at
                    ? new Date(importConfig.exported_at).toLocaleString()
                    : "—"}
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs text-amber-800">
                  <div className="rounded border border-amber-100 bg-white p-2">
                    <span className="font-medium">
                      {importConfig?.columns.length ?? 0}
                    </span>{" "}
                    columns
                  </div>
                  <div className="rounded border border-amber-100 bg-white p-2">
                    <span className="font-medium">
                      {importConfig?.custom_fields.length ?? 0}
                    </span>{" "}
                    custom fields
                  </div>
                  <div className="rounded border border-amber-100 bg-white p-2">
                    <span className="font-medium">
                      {importConfig?.automations.length ?? 0}
                    </span>{" "}
                    automations
                  </div>
                  <div className="rounded border border-amber-100 bg-white p-2">
                    <span className="font-medium">
                      {importConfig?.integrations.length ?? 0}
                    </span>{" "}
                    integrations
                  </div>
                </div>
                {(importConfig?.team?.length ?? 0) > 0 && (
                  <p className="mt-3 text-xs text-amber-600">
                    {importConfig!.team.length} team members in file — preview
                    only, not auto-created.
                  </p>
                )}
                <p className="mt-3 text-xs font-medium text-amber-700">
                  This will overwrite your current columns, custom fields, and
                  automations. Jobs and orders are not affected.
                </p>
              </div>
            )}
            <div className="flex gap-3">
              {importErrors.length === 0 && (
                <Button type="button" onClick={handleConfirmImport}>
                  Confirm Import
                </Button>
              )}
              <Button type="button" variant="secondary" onClick={resetImport}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {importStep === "importing" && (
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            Applying configuration…
          </div>
        )}

        {importStep === "done" && importResult && (
          <div
            className={`rounded-lg border p-4 ${
              importResult.success
                ? "border-green-200 bg-green-50"
                : "border-red-200 bg-red-50"
            }`}
          >
            <p
              className={`mb-2 text-sm font-medium ${
                importResult.success ? "text-green-800" : "text-red-700"
              }`}
            >
              {importResult.success
                ? "Import successful"
                : "Import completed with errors"}
            </p>
            <div className="mb-3 space-y-1 text-xs text-slate-600">
              <p>Columns applied: {importResult.summary.columns}</p>
              <p>Custom fields applied: {importResult.summary.custom_fields}</p>
              <p>Automations applied: {importResult.summary.automations}</p>
              <p>Integrations applied: {importResult.summary.integrations}</p>
            </div>
            {importResult.errors.length > 0 && (
              <ul className="mb-3 space-y-1 text-xs text-red-600">
                {importResult.errors.map((err, i) => (
                  <li key={i}>• {err}</li>
                ))}
              </ul>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => window.location.reload()}
            >
              Reload page to see changes
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
