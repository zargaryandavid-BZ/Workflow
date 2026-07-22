"use client";

import { useState } from "react";
import { FieldsManager } from "./fields-manager";
import { LinkedDropdownsTab } from "./linked-dropdowns-tab";
import { cn } from "@/lib/utils";
import type { CustomField } from "@/lib/types";

type Tab = "fields" | "links";

export function FieldsSettingsClient({
  initialFields,
}: {
  initialFields: CustomField[];
}) {
  const [tab, setTab] = useState<Tab>("fields");
  const selectFields = initialFields.filter((f) => f.field_type === "select");

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
        <button
          type="button"
          onClick={() => setTab("fields")}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            tab === "fields"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          )}
        >
          Fields
        </button>
        <button
          type="button"
          onClick={() => setTab("links")}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            tab === "links"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          )}
        >
          Linked dropdowns
        </button>
      </div>

      {tab === "fields" ? (
        <FieldsManager initialFields={initialFields} />
      ) : (
        <LinkedDropdownsTab selectFields={selectFields} />
      )}
    </div>
  );
}
