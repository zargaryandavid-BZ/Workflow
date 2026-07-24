"use client";

import { useState } from "react";
import { TagsManager } from "./tags-manager";
import { TimeChipsManager } from "./time-chips-manager";
import { cn } from "@/lib/utils";
import type { Tag, BoardColumn } from "@/lib/types";
import type { TimeChip } from "@/lib/time-chips";

interface Props {
  initialTags: Tag[];
  initialTimeChips: TimeChip[];
  columns: BoardColumn[];
}

type Tab = "color" | "time";

export function TagsSettingsClient({
  initialTags,
  initialTimeChips,
  columns,
}: Props) {
  const [tab, setTab] = useState<Tab>("color");

  return (
    <div>
      <div className="mb-5 flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
        <button
          type="button"
          onClick={() => setTab("color")}
          className={cn(
            "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            tab === "color"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          )}
        >
          Color tags
        </button>
        <button
          type="button"
          onClick={() => setTab("time")}
          className={cn(
            "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            tab === "time"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          )}
        >
          Time chips
        </button>
      </div>

      {tab === "color" ? (
        <TagsManager initialTags={initialTags} />
      ) : (
        <TimeChipsManager
          initialChips={initialTimeChips}
          columns={columns}
        />
      )}
    </div>
  );
}
