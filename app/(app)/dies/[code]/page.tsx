import { notFound, redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DieDetailClient } from "@/components/die/die-detail-client";
import { mapDieManufacturerRow } from "@/lib/die-manufacturers";
import { getDie, getDieByCode, loadDieHistory } from "@/lib/dies.server";
import { parseDieCodeInput } from "@/lib/dies";
import { canViewDieOrder } from "@/lib/permissions";

export const metadata = { title: "Die" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One die: details, usage (Use die / Return die), QR label and history.
 * Die QR codes open this page (/dies/DIE-00001). Any signed-in staff member
 * can use, return and mark a die out of order; editing stays with Die Order roles.
 */
export default async function DiePage({ params }: { params: Promise<{ code: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");
  const { code: raw } = await params;
  const supabase = await createClient();
  const decoded = decodeURIComponent(raw);
  const code = parseDieCodeInput(decoded);
  const die = code
    ? await getDieByCode(supabase, ctx.tenant.id, code)
    : UUID_RE.test(decoded)
      ? await getDie(supabase, ctx.tenant.id, decoded)
      : null;
  if (!die) notFound();

  const canEdit = canViewDieOrder(ctx.role);
  const [history, mfgRes] = await Promise.all([
    loadDieHistory(supabase, ctx.tenant.id, die.id),
    canEdit
      ? supabase
          .from("die_manufacturers")
          .select("*")
          .eq("tenant_id", ctx.tenant.id)
          .order("full_name", { ascending: true })
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);
  const manufacturers = ((mfgRes.data ?? []) as Record<string, unknown>[]).map((row) =>
    mapDieManufacturerRow(row)
  );

  return (
    <div className="board-scroll h-full overflow-y-auto">
      <div className="px-4 py-5">
        <DieDetailClient
          die={die}
          events={history.events}
          orders={history.orders}
          historyMissing={history.migrationMissing}
          canEdit={canEdit}
          manufacturers={manufacturers}
        />
      </div>
    </div>
  );
}
