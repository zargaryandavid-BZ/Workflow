import { NextResponse } from "next/server";
import { after } from "next/server";
import { getTenantContext, type TenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  evaluateBoardHealth,
  type BoardHealthDesignerLoad,
} from "@/lib/board-health";
import { loadEnabledCardWarningRules } from "@/lib/card-warning-rules.server";
import { normalizeWorkingDays } from "@/lib/card-warning-rules";
import {
  countDesignerLoads,
  designerLoadColumnIds,
  sortDesignersByLoad,
} from "@/lib/designer-load";
import { normalizeEmergencyBalance } from "@/lib/emergency-balance";
import type { BoardColumn, CardWarningRule } from "@/lib/types";
import { getSharedDriveCache, setSharedDriveCache } from "@/lib/drive-status-cache";

export const dynamic = "force-dynamic";

const PAGE = 1000;

// Board health scans every open order for the tenant on each call — real work,
// not a fast lookup. Short TTL, shared across serverless instances: a cache
// hit serves instantly while a fresh copy is computed in the background
// (stale-while-revalidate), so the board never blocks on this full scan.
const BOARD_HEALTH_TTL_MS = 20_000;

type OrderRow = {
  id: string;
  column_id: string;
  due_date: string | null;
  last_moved_at: string | null;
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

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const cacheKey = `${ctx.tenant.id}:board-health`;
  const cached = await getSharedDriveCache<Record<string, unknown>>(cacheKey);
  if (cached) {
    // Serve the cached snapshot instantly; refresh it in the background so
    // the next load picks up any changes without anyone waiting on this scan.
    after(() => {
      void refreshBoardHealth(ctx, cacheKey);
    });
    return NextResponse.json(cached);
  }

  const result = await computeBoardHealth(ctx);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  await setSharedDriveCache(cacheKey, result.data, BOARD_HEALTH_TTL_MS);
  return NextResponse.json(result.data);
}

async function refreshBoardHealth(
  ctx: TenantContext,
  cacheKey: string,
): Promise<void> {
  try {
    const result = await computeBoardHealth(ctx);
    if (result.ok) await setSharedDriveCache(cacheKey, result.data, BOARD_HEALTH_TTL_MS);
  } catch {
    // Best-effort — the still-cached snapshot keeps serving until the next hit.
  }
}

async function computeBoardHealth(
  ctx: TenantContext,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
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

  const orders: OrderRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("orders")
      .select("id, column_id, due_date, last_moved_at, specs, tag:tags(name)")
      .eq("tenant_id", tenantId)
      .is("removed_at", null)
      .range(from, from + PAGE - 1);

    if (error) {
      return { ok: false, error: error.message };
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
    warningWorkingDays: normalizeWorkingDays(ctx.tenant.warning_working_days),
    emergencyBalance,
  });

  const designerIds = (membershipsRes.data ?? []).map(
    (m: { user_id: string }) => m.user_id
  );
  const designers: BoardHealthDesignerLoad[] =
    designerIds.length === 0
      ? []
      : await (async () => {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", designerIds);
          const nameById = new Map(
            (
              (profiles ?? []) as { id: string; full_name: string | null }[]
            ).map((p) => [p.id, p.full_name])
          );
          const loadColIds = designerLoadColumnIds(columns);
          const counts = countDesignerLoads(
            designerIds,
            orders.map((o) => ({
              column_id: o.column_id,
              specs:
                o.specs && typeof o.specs === "object"
                  ? (o.specs as Record<string, unknown>)
                  : null,
            })),
            loadColIds
          );
          return sortDesignersByLoad(
            designerIds.map((id) => {
              const stats = counts.get(id);
              return {
                id,
                name: nameById.get(id)?.trim() || "Designer",
                load: stats?.load ?? 0,
                skuCount: stats?.skuCount ?? 0,
              };
            })
          );
        })();

  return { ok: true, data: { ...health, designers } };
}
