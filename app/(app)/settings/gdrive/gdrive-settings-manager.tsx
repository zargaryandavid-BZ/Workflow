"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { GdriveLinkTarget, GdriveSettingsPublic } from "@/lib/types";

interface Props {
  initialSettings: GdriveSettingsPublic;
  loadError: string | null;
}

export function GdriveSettingsManager({ initialSettings, loadError }: Props) {
  const router = useRouter();
  const [settings, setSettings] = useState(initialSettings);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const [enabled, setEnabled] = useState(settings.enabled);
  const [clientEmail, setClientEmail] = useState(settings.client_email ?? "");
  const [privateKey, setPrivateKey] = useState("");
  const [serviceAccountJson, setServiceAccountJson] = useState("");
  const [rootFolderId, setRootFolderId] = useState(
    settings.root_folder_id ?? ""
  );
  const [sharedDriveId, setSharedDriveId] = useState(
    settings.shared_drive_id ?? ""
  );
  const [finalFolderName, setFinalFolderName] = useState(
    settings.final_folder_name || "Final for Prod"
  );
  const [linkTarget, setLinkTarget] = useState<GdriveLinkTarget>(
    settings.link_target
  );
  const [openOnCreate, setOpenOnCreate] = useState(settings.open_on_create);

  async function save(extra?: { test?: boolean }) {
    setError(null);
    setMessage(null);
    if (extra?.test) setTesting(true);
    else setSaving(true);

    const body: Record<string, unknown> = {
      enabled,
      client_email: clientEmail.trim() || null,
      root_folder_id: rootFolderId.trim() || null,
      shared_drive_id: sharedDriveId.trim() || null,
      final_folder_name: finalFolderName.trim() || "Final for Prod",
      link_target: linkTarget,
      open_on_create: openOnCreate,
    };
    if (privateKey.trim()) body.private_key = privateKey.trim();
    if (serviceAccountJson.trim()) {
      body.service_account_json = serviceAccountJson.trim();
    }
    if (extra?.test) body.test = true;

    const res = await fetch("/api/gdrive-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
      settings?: GdriveSettingsPublic;
      test?: { ok: boolean; folderName?: string; error?: string };
    };

    setSaving(false);
    setTesting(false);

    if (!res.ok) {
      setError(json.error ?? "Failed to save");
      return;
    }

    if (json.settings) {
      setSettings(json.settings);
      setClientEmail(json.settings.client_email ?? "");
      setPrivateKey("");
      setServiceAccountJson("");
    }

    if (json.test) {
      if (json.test.ok) {
        setMessage(`Connected — root folder: ${json.test.folderName}`);
      } else {
        setError(json.test.error ?? "Connection test failed");
      }
    } else {
      setMessage("Saved");
    }
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {loadError ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {loadError}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </p>
      ) : null}

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="rounded border-slate-300"
        />
        Enable automatic folder creation on new orders (webhook + manual)
      </label>

      <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 text-sm text-slate-600">
        <p className="font-medium text-slate-800">Setup</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Google Cloud → enable Drive API → create a service account</li>
          <li>Download the JSON key and paste it below (or enter email + key)</li>
          <li>
            Add the service account as a member of your Shared Drive (Content
            manager or Manager)
          </li>
          <li>
            Paste the Shared Drive ID (or a folder ID inside it) as Root folder
            ID
          </li>
        </ol>
        <p className="mt-2 text-xs text-slate-500">
          Folder layout:{" "}
          <code className="rounded bg-white px-1">
            26-0098_Customer / 26-0098_{finalFolderName || "Final for Prod"}
          </code>
          . Status:{" "}
          {settings.configured ? (
            <span className="text-emerald-700">credentials saved</span>
          ) : (
            <span className="text-amber-700">incomplete</span>
          )}
        </p>
      </div>

      <label className="block text-sm text-slate-600">
        Service account JSON (optional paste)
        <textarea
          value={serviceAccountJson}
          onChange={(e) => setServiceAccountJson(e.target.value)}
          rows={4}
          placeholder='{"type":"service_account","client_email":"...","private_key":"-----BEGIN..."}'
          className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-800 outline-none focus:border-slate-400"
        />
      </label>

      <label className="block text-sm text-slate-600">
        Client email
        <input
          type="email"
          value={clientEmail}
          onChange={(e) => setClientEmail(e.target.value)}
          placeholder="name@project.iam.gserviceaccount.com"
          className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400"
        />
      </label>

      <label className="block text-sm text-slate-600">
        Private key
        {settings.private_key.set ? (
          <p className="mt-0.5 text-xs text-slate-400">
            Saved ({settings.private_key.preview}) — leave blank to keep
          </p>
        ) : null}
        <textarea
          value={privateKey}
          onChange={(e) => setPrivateKey(e.target.value)}
          rows={3}
          placeholder={
            settings.private_key.set
              ? "Leave blank to keep current"
              : "-----BEGIN PRIVATE KEY-----\\n..."
          }
          className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-800 outline-none focus:border-slate-400"
        />
      </label>

      <label className="block text-sm text-slate-600">
        Root folder / Shared Drive ID
        <input
          value={rootFolderId}
          onChange={(e) => setRootFolderId(e.target.value)}
          placeholder="From the Drive URL …/folders/THIS_ID"
          className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400"
        />
      </label>

      <label className="block text-sm text-slate-600">
        Shared Drive ID (optional if same as root)
        <input
          value={sharedDriveId}
          onChange={(e) => setSharedDriveId(e.target.value)}
          placeholder="Usually the same as root when creating under a Shared Drive"
          className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400"
        />
      </label>

      <label className="block text-sm text-slate-600">
        Production subfolder name
        <input
          value={finalFolderName}
          onChange={(e) => setFinalFolderName(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400"
        />
      </label>

      <label className="block text-sm text-slate-600">
        Link saved on card (Artwork GDrive)
        <select
          value={linkTarget}
          onChange={(e) => setLinkTarget(e.target.value as GdriveLinkTarget)}
          className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400"
        >
          <option value="final">
            Production subfolder (26-0098_Final for Prod)
          </option>
          <option value="order">Job folder (26-0098_Customer Name)</option>
          <option value="customer">Job folder (26-0098_Customer Name)</option>
        </select>
      </label>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={openOnCreate}
          onChange={(e) => setOpenOnCreate(e.target.checked)}
          className="rounded border-slate-300"
        />
        Open Drive folder in a new tab after manual order create
      </label>

      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={testing || saving}
          onClick={() => void save({ test: true })}
        >
          {testing ? "Testing…" : "Save & test connection"}
        </Button>
      </div>
    </div>
  );
}
