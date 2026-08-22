"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HeartPulse, Sparkles } from "lucide-react";
import { fetchRetryingStale404 } from "@/lib/fetch-with-auth";
import { cn } from "@/lib/utils";
import {
  BOARD_HEALTH_META,
  type BoardHealthLevel,
  type BoardHealthResult,
} from "@/lib/board-health";

const EMPTY: BoardHealthResult = {
  level: 5,
  label: "Healthy",
  summary: "No late, stuck, or warning jobs.",
  counts: {
    open: 0,
    late: 0,
    dueToday: 0,
    warnings: 0,
    stuck: 0,
    attention: 0,
  },
  visible: true,
  show: {
    late: true,
    dueToday: true,
    warnings: true,
    stuck: true,
  },
  throughLabel: "Ready to Ship",
};

interface BoardHealthButtonProps {
  /** From tenant settings; when false, do not render. */
  enabled?: boolean;
}

type AnalyzeResponse = {
  commentary?: string;
  source?: "openai" | "fallback";
  error?: string;
};

export function BoardHealthButton({ enabled = true }: BoardHealthButtonProps) {
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<BoardHealthResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [commentary, setCommentary] = useState<string | null>(null);
  const [analyzeSource, setAnalyzeSource] = useState<
    "openai" | "fallback" | null
  >(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchRetryingStale404("/api/board/health", {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as BoardHealthResult;
      if (typeof data.level === "number") setHealth(data);
    } catch {
      // Non-fatal — icon still renders.
    } finally {
      setLoading(false);
    }
  }, []);

  const runAnalyze = useCallback(async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const res = await fetchRetryingStale404("/api/board/health/analyze", {
        method: "POST",
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as AnalyzeResponse;
      if (!res.ok) {
        setAnalyzeError(data.error ?? "Analysis failed");
        return;
      }
      if (data.commentary) {
        setCommentary(data.commentary);
        setAnalyzeSource(data.source ?? null);
      } else {
        setAnalyzeError("No commentary returned");
      }
    } catch {
      setAnalyzeError("Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void load();
    function onFocus() {
      void load();
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load, enabled]);

  useEffect(() => {
    if (!open || !enabled) return;
    void load();
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, load, enabled]);

  if (!enabled) return null;
  if (health && health.visible === false) return null;

  const result = health ?? EMPTY;
  const level = result.level as BoardHealthLevel;
  const meta = BOARD_HEALTH_META[level];
  const c = result.counts;
  const show = result.show ?? EMPTY.show;
  const throughLabel = result.throughLabel ?? EMPTY.throughLabel;

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-slate-100",
          loading && !health ? "text-slate-300" : meta.iconClass
        )}
        title={`Board health: ${level} — ${meta.label}`}
        aria-label={`Board health: ${level} ${meta.label}`}
        aria-expanded={open}
      >
        <HeartPulse className="h-5 w-5" strokeWidth={2.25} />
      </button>

      {open ? (
        <div className="absolute left-0 z-50 mt-1 w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-3.5 shadow-lg">
          <div className="mb-1 flex items-center gap-2">
            <HeartPulse
              className={cn("h-4 w-4 shrink-0", meta.iconClass)}
              strokeWidth={2.25}
            />
            <p className="text-sm font-semibold text-slate-800">
              Board health:{" "}
              <span style={{ color: meta.color }}>
                {level} — {meta.label}
              </span>
            </p>
          </div>
          <p className="mb-3 text-sm text-slate-600">{result.summary}</p>
          <div className="divide-y divide-slate-100 border-t border-slate-100 text-sm">
            {show.late ? (
              <HealthRow label="Late" count={c.late} tone="late" />
            ) : null}
            {show.dueToday ? (
              <HealthRow label="Due today" count={c.dueToday} tone="today" />
            ) : null}
            {show.warnings ? (
              <HealthRow label="Warnings" count={c.warnings} tone="warn" />
            ) : null}
            {show.stuck ? (
              <HealthRow label="Stuck" count={c.stuck} tone="stuck" />
            ) : null}
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            Open jobs through {throughLabel}: {c.open}
          </p>

          <div className="mt-3 border-t border-slate-100 pt-3">
            <button
              type="button"
              disabled={analyzing}
              onClick={() => void runAnalyze()}
              className={cn(
                "inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border text-xs font-medium transition-colors",
                analyzing
                  ? "cursor-wait border-slate-200 bg-slate-50 text-slate-400"
                  : "border-slate-300 text-slate-700 hover:bg-slate-50"
              )}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {analyzing
                ? "Analyzing…"
                : commentary
                  ? "Refresh AI analysis"
                  : "Analyze situation"}
            </button>

            {analyzeError ? (
              <p className="mt-2 text-xs text-red-600">{analyzeError}</p>
            ) : null}

            {commentary ? (
              <div className="mt-2 max-h-64 overflow-y-auto rounded-lg bg-slate-50 px-2.5 py-2 text-xs leading-relaxed text-slate-700">
                <AnalyzeCommentary text={commentary} />
                {analyzeSource === "fallback" ? (
                  <p className="mt-2 text-[10px] text-slate-400">
                    Stats-only briefing (AI unavailable).
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-slate-400">
                AI reviews Start / In Progress, Hrach, Apparel production,
                In Production dwell, stuck time, bottlenecks, and designer latency.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function HealthRow({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "late" | "today" | "warn" | "stuck";
}) {
  const countClass =
    tone === "late"
      ? "font-semibold text-red-600"
      : tone === "today"
        ? "font-semibold text-orange-600"
        : tone === "warn"
          ? "font-semibold text-amber-600"
          : "font-semibold text-slate-800";
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-slate-600">{label}</span>
      <span className={countClass}>{count}</span>
    </div>
  );
}

/** Split AI briefing so Top 3 bottlenecks + Next actions render highlighted. */
function AnalyzeCommentary({ text }: { text: string }) {
  const parts = splitAnalyzeSections(text);

  return (
    <div className="space-y-2">
      {parts.before ? (
        <div className="whitespace-pre-wrap">{parts.before}</div>
      ) : null}
      {parts.bottlenecks.length > 0 ? (
        <div className="rounded-md border border-orange-200 bg-orange-50 px-2.5 py-2">
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-orange-900">
            Top 3 bottlenecks
          </p>
          <ol className="space-y-1.5">
            {parts.bottlenecks.map((item, i) => (
              <li
                key={i}
                className="flex gap-2 text-xs leading-snug text-orange-950"
              >
                <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-orange-200 text-[10px] font-bold text-orange-900">
                  {i + 1}
                </span>
                <span className="font-semibold">{item}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {parts.middle ? (
        <div className="whitespace-pre-wrap">{parts.middle}</div>
      ) : null}
      {parts.actions.length > 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2">
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-900">
            Next actions
          </p>
          <ol className="space-y-1.5">
            {parts.actions.map((item, i) => (
              <li
                key={i}
                className="flex gap-2 text-xs leading-snug text-amber-950"
              >
                <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-200 text-[10px] font-bold text-amber-900">
                  {i + 1}
                </span>
                <span className="font-semibold">{item}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

function parseNumberedBlock(after: string): string[] {
  const items: string[] = [];
  for (const raw of after.split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    if (
      /^(?:Next actions?|Next steps?|Top\s*3\s*bottlenecks)\s*:?\s*$/i.test(
        line
      )
    ) {
      break;
    }
    if (
      items.length > 0 &&
      !/^[•\-\*]/.test(line) &&
      !/^\d+[.)]/.test(line)
    ) {
      break;
    }
    const cleaned = line
      .replace(/^[•\-\*]\s*/, "")
      .replace(/^\d+[.)]\s*/, "")
      .trim();
    if (cleaned) items.push(cleaned);
    if (items.length >= 3) break;
  }
  return items;
}

/** Bytes from start of `body` through the end of `count` numbered/bullet lines. */
function consumeListedItems(body: string, count: number): number {
  const trimmed = body.trimStart();
  let consumed = body.length - trimmed.length;
  let found = 0;
  for (const raw of trimmed.split(/(\n+)/)) {
    consumed += raw.length;
    const line = raw.trim();
    if (!line) continue;
    if (/^\d+[.)]/.test(line) || /^[•\-\*]/.test(line)) {
      found += 1;
      if (found >= count) break;
    } else if (found > 0) {
      consumed -= raw.length;
      break;
    }
  }
  return consumed;
}

function splitAnalyzeSections(text: string): {
  before: string;
  bottlenecks: string[];
  middle: string;
  actions: string[];
} {
  const bnMatch = text.match(/(?:^|\n)\s*Top\s*3\s*bottlenecks\s*:?\s*\n?/i);
  const actMatch = text.match(
    /(?:^|\n)\s*(?:Next actions?|Next steps?)\s*:?\s*\n?/i
  );

  const bnIdx = bnMatch?.index ?? -1;
  const actIdx = actMatch?.index ?? -1;

  if (bnIdx < 0 && actIdx < 0) {
    return {
      before: text.trim(),
      bottlenecks: [],
      middle: "",
      actions: [],
    };
  }

  if (bnIdx >= 0) {
    const bnBodyStart = bnIdx + bnMatch![0].length;
    const bnBodyEnd = actIdx > bnIdx ? actIdx : text.length;
    const bnBody = text.slice(bnBodyStart, bnBodyEnd);
    const bottlenecks = parseNumberedBlock(bnBody);
    const afterList = bnBodyStart + consumeListedItems(bnBody, bottlenecks.length);

    const before = text.slice(0, bnIdx).trim();
    if (actIdx > bnIdx) {
      return {
        before,
        bottlenecks,
        middle: text.slice(afterList, actIdx).trim(),
        actions: parseNumberedBlock(
          text.slice(actIdx + actMatch![0].length)
        ),
      };
    }
    return {
      before,
      bottlenecks,
      middle: text.slice(afterList).trim(),
      actions: [],
    };
  }

  return {
    before: text.slice(0, actIdx).trim(),
    bottlenecks: [],
    middle: "",
    actions: parseNumberedBlock(text.slice(actIdx + actMatch![0].length)),
  };
}
