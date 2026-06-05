"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { respondUrl } from "@/lib/notification-messages";

export function CustomerLinkRow({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const url = respondUrl(token);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore clipboard failures
    }
  }

  return (
    <div>
      <p className="mb-1 text-xs text-slate-500">Customer link:</p>
      <div className="flex items-center gap-2">
        <input
          type="text"
          readOnly
          value={url}
          className="min-w-0 flex-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700"
          onFocus={(e) => e.target.select()}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 text-xs"
          onClick={copy}
        >
          {copied ? "Copied!" : "Copy"}
        </Button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-800 hover:bg-slate-50"
        >
          Open
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}
