"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  MESSAGE_TEMPLATE_SECTIONS,
  type MessageTemplateKey,
  type MessageTemplateMap,
} from "@/lib/message-templates";

interface Props {
  initialTemplates: MessageTemplateMap;
  defaults: MessageTemplateMap;
}

export function MessageTemplatesManager({
  initialTemplates,
  defaults,
}: Props) {
  const [templates, setTemplates] =
    useState<MessageTemplateMap>(initialTemplates);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState(
    MESSAGE_TEMPLATE_SECTIONS[0]?.id ?? "missing_info"
  );

  function updateField(key: MessageTemplateKey, value: string) {
    setTemplates((prev) => ({ ...prev, [key]: value }));
    setMessage(null);
  }

  function resetSection(sectionId: string) {
    const section = MESSAGE_TEMPLATE_SECTIONS.find((s) => s.id === sectionId);
    if (!section) return;
    setTemplates((prev) => {
      const next = { ...prev };
      for (const { key } of section.keys) {
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
      const res = await fetch("/api/message-templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templates }),
      });
      const json = (await res.json()) as {
        templates?: MessageTemplateMap;
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? "Failed to save");
        return;
      }
      if (json.templates) setTemplates(json.templates);
      setMessage("Templates saved");
    } catch {
      setError("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const section =
    MESSAGE_TEMPLATE_SECTIONS.find((s) => s.id === activeSection) ??
    MESSAGE_TEMPLATE_SECTIONS[0];

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <nav className="shrink-0 lg:w-52">
        <ul className="space-y-0.5">
          {MESSAGE_TEMPLATE_SECTIONS.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setActiveSection(s.id)}
                className={
                  s.id === activeSection
                    ? "w-full rounded-md bg-slate-900 px-3 py-2 text-left text-sm font-medium text-white"
                    : "w-full rounded-md px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-100"
                }
              >
                {s.title}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-800">
              {section.title}
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">{section.description}</p>
            <p className="mt-2 text-xs text-slate-400">
              Variables: {section.variables.join(" · ")}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            className="text-sm text-slate-500"
            onClick={() => resetSection(section.id)}
          >
            Reset section
          </Button>
        </div>

        {section.keys.map(({ key, label, kind }) => (
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
                rows={kind === "sms" ? 4 : 10}
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-sm text-slate-800 outline-none focus:border-slate-400"
              />
            )}
          </label>
        ))}

        <div className="flex items-center gap-3 border-t border-slate-100 pt-4">
          <Button type="button" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save templates"}
          </Button>
          {message ? (
            <p className="text-sm text-emerald-600">{message}</p>
          ) : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
