"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  MESSAGE_TEMPLATE_SECTIONS,
  type MessageTemplateKey,
  type MessageTemplateMap,
} from "@/lib/message-templates";

const SECTION_ID = "fedex_tracking";

export function FedexTrackingTemplatesPanel({
  initialTemplates,
  defaults,
}: {
  initialTemplates: MessageTemplateMap;
  defaults: MessageTemplateMap;
}) {
  const section = MESSAGE_TEMPLATE_SECTIONS.find((s) => s.id === SECTION_ID);
  const [templates, setTemplates] =
    useState<MessageTemplateMap>(initialTemplates);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!section) return null;
  const fields = section.keys;

  function updateField(key: MessageTemplateKey, value: string) {
    setTemplates((prev) => ({ ...prev, [key]: value }));
    setMessage(null);
  }

  function resetSection() {
    setTemplates((prev) => {
      const next = { ...prev };
      for (const { key } of fields) {
        next[key] = defaults[key];
      }
      return next;
    });
    setMessage(null);
  }

  async function save() {
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      const patch: Partial<MessageTemplateMap> = {};
      for (const { key } of fields) {
        patch[key] = templates[key];
      }
      const res = await fetch("/api/message-templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templates: patch }),
      });
      const json = (await res.json()) as {
        templates?: MessageTemplateMap;
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? "Failed to save templates");
        return;
      }
      if (json.templates) setTemplates(json.templates);
      setMessage("Tracking templates saved");
    } catch {
      setError("Failed to save templates");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">
            {section.title} SMS / email
          </h2>
          <p className="mt-1 text-xs text-slate-500">{section.description}</p>
          <p className="mt-2 text-xs text-slate-400">
            Variables: {section.variables.join(" · ")}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          className="text-sm text-slate-500"
          onClick={resetSection}
        >
          Reset to default
        </Button>
      </div>

      <div className="mt-4 space-y-3">
        {fields.map(({ key, label, kind }) => (
          <label key={key} className="block text-sm text-slate-600">
            {label}
            {kind === "sms" ? (
              <span className="ml-2 text-xs text-slate-400">
                {templates[key].length} chars
              </span>
            ) : null}
            {kind === "subject" ? (
              <input
                type="text"
                value={templates[key]}
                onChange={(e) => updateField(key, e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400"
              />
            ) : (
              <textarea
                value={templates[key]}
                onChange={(e) => updateField(key, e.target.value)}
                rows={kind === "sms" ? 4 : 8}
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-sm text-slate-800 outline-none focus:border-slate-400"
              />
            )}
          </label>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button type="button" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save tracking templates"}
        </Button>
        {message ? (
          <p className="text-sm text-emerald-600">{message}</p>
        ) : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
    </section>
  );
}
