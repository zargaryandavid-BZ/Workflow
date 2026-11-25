import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { evaluateBoardHealth } from "@/lib/board-health";
import {
  buildBoardHealthAnalyzePrompt,
  buildBoardHealthSituation,
  formatSituationFallback,
  type SituationOrder,
} from "@/lib/board-health-situation";
import { loadEnabledCardWarningRules } from "@/lib/card-warning-rules.server";
import { normalizeWorkingDays } from "@/lib/card-warning-rules";
import { normalizeEmergencyBalance } from "@/lib/emergency-balance";
import { openaiChatText, openaiConfigured } from "@/lib/openai";
import { createAdminClient } from "@/lib/supabase/admin";
import { insightsForAi } from "@/lib/board-insights";
import { INSIGHTS_PERIODS, loadBoardInsights } from "@/lib/board-insights.server";
import type { BoardColumn, CardWarningRule } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGE = 1000;

type OrderRow = SituationOrder & {
  specs: unknown;
  tag: { name: string | null } | { name: string | null }[] | null;
};

function tagName(
  tag: OrderRow["tag"]
): { name?: string | null } | null {
  if (!tag) return null;
  if (Array.isArray(tag)) return tag[0] ?? null;
  return tag;
}

export async function POST(req: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Membership checked above; every query below filters by tenant_id. The
  // service client skips per-row RLS checks that made this scan very slow.
  const supabase = createAdminClient();
  const tenantId = ctx.tenant.id;

  const [columnsRes, rules, membershipsRes] = await Promise.all([
    supabase
      .from("board_columns")
      .select("id, name, kind")
      .eq("tenant_id", tenantId)
      .order("position", { ascending: true }),
    loadEnabledCardWarningRules(supabase, tenantId),
    supabase
      .from("memberships")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("role", "designer"),
  ]);

  const columns = (columnsRes.data ?? []) as Pick<
    BoardColumn,
    "id" | "name" | "kind"
  >[];

  const designerIds = (membershipsRes.data ?? []).map(
    (m: { user_id: string }) => m.user_id
  );
  const profilesRes =
    designerIds.length > 0
      ? await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", designerIds)
      : { data: [] as { id: string; full_name: string | null }[] };
  const nameById = new Map(
    ((profilesRes.data ?? []) as { id: string; full_name: string | null }[]).map(
      (p) => [p.id, p.full_name]
    )
  );
  const designers = designerIds.map((id) => ({
    id,
    name: nameById.get(id)?.trim() || "Designer",
  }));

  const orders: OrderRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("orders")
      .select(
        "id, column_id, due_date, last_moved_at, created_at, updated_at, specs, tag:tags(name)"
      )
      .eq("tenant_id", tenantId)
      .is("removed_at", null)
      .range(from, from + PAGE - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const batch = (data ?? []) as unknown as OrderRow[];
    orders.push(...batch);
    if (batch.length < PAGE) break;
    from += PAGE;
  }

  const emergencyBalance = normalizeEmergencyBalance(
    ctx.tenant.emergency_balance,
    columns.map((c) => ({ id: c.id, name: c.name }))
  );
  const warningWorkingDays = normalizeWorkingDays(
    ctx.tenant.warning_working_days
  );

  const health = evaluateBoardHealth({
    columns,
    orders: orders.map((o) => ({
      id: o.id,
      column_id: o.column_id,
      due_date: o.due_date,
      last_moved_at: o.last_moved_at,
      specs: o.specs,
      tag: tagName(o.tag),
    })),
    warningRules: rules as CardWarningRule[],
    warningWorkingDays,
    emergencyBalance,
  });

  const situation = buildBoardHealthSituation({
    health,
    columns,
    orders,
    designers,
    emergencyBalance,
    warningWorkingDays,
  });

  const base = buildBoardHealthAnalyzePrompt(situation);
  // Richer facts: flow, stage times, rejections, missing info, repeat clients.
  const body = (await req.json().catch(() => ({}))) as { days?: number };
  const days = (INSIGHTS_PERIODS as readonly number[]).includes(Number(body.days))
    ? Number(body.days)
    : 30;
  const insights = await loadBoardInsights(createAdminClient(), tenantId, days).catch((err) => {
    console.error("[board/health/analyze] insights", err);
    return null;
  });
  const system = insights
    ? [
        "You are an experienced operations manager coaching a print shop owner about their production board.",
        "Ignore the Hold column completely. Focus on designer speed (designsPerDay vs newJobsPerDay), production speed (jobsLeavingPerDay), and columns where inPerDay is higher than outPerDay (pilingUp). The goal is fewer late jobs.", "Write in plain, friendly English a shop owner understands. Never show JSON field names (no camelCase like targetOutPerDay, avgDaysHere).",
        "Use ONLY the numbers in the JSON. Never invent counts, rates, names or job numbers. Round to whole numbers or one decimal.",
        `'prev' values are the previous ${days} days: say clearly what got better or worse.`,
        "Format (plain text, no # headings, no bold markers):",
        "1) One-sentence headline: overall state and the single biggest problem.",
        "2) 'Top 3 bottlenecks:' on its own line, then '1. …' '2. …' '3. …'. Each: column name — N jobs, about N days there; now about N jobs/day leave, it needs about N/day to clear in a week (use outPerDay and targetOutPerDay).",
        "3) 3-5 • bullets on: designer load (hold vs to design vs waiting on client), the jobs stuck longest in production (job numbers), stage times vs before, missing info % and proof rejection % vs before, the clients with the most rejections.",
        "4) 'Next actions:' on its own line, then '1. …' '2. …' '3. …'. Each is ONE full sentence telling who should do what today, naming the column, designer, client or job numbers, followed by ' Result: ' and the concrete expected outcome (e.g. 'Result: Hold drops from 29 to about 19 jobs this week.').",
        "Under 300 words.",
      ].join(" ")
    : base.system;
  const user = insights
    ? `Board facts for the last ${days} days:\n\n${JSON.stringify(insightsForAi(insights))}`
    : base.user;

  let commentary: string;
  let source: "openai" | "fallback" = "fallback";

  if (openaiConfigured()) {
    try {
      commentary = await openaiChatText({ system, user });
      source = "openai";
    } catch (err) {
      console.error("[board/health/analyze]", err);
      commentary = formatSituationFallback(situation);
      source = "fallback";
    }
  } else {
    commentary = formatSituationFallback(situation);
  }

  return NextResponse.json({
    commentary,
    source,
    situation,
  });
}
