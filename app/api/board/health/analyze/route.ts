import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
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

export async function POST() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();
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

  const { system, user } = buildBoardHealthAnalyzePrompt(situation);

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
