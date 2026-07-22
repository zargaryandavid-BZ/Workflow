import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { TimePageClient } from "@/components/time/TimePageClient";

export default async function TimePage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");

  const designers: { id: string; name: string }[] = [];
  if (ctx.role === "admin") {
    const supabase = await createClient();
    const { data: memberships } = await supabase
      .from("memberships")
      .select("user_id, role")
      .eq("tenant_id", ctx.tenant.id);

    const designerIds = [
      ...new Set(
        ((memberships ?? []) as { user_id: string; role: string }[])
          .filter((m) => m.role === "designer")
          .map((m) => m.user_id)
      ),
    ];

    if (designerIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", designerIds);
      const nameById = new Map(
        ((profiles ?? []) as { id: string; full_name: string | null }[]).map(
          (p) => [p.id, p.full_name?.trim() || "Unnamed"]
        )
      );
      for (const id of designerIds) {
        designers.push({ id, name: nameById.get(id) ?? "Unnamed" });
      }
      designers.sort((a, b) => a.name.localeCompare(b.name));
    }
  }

  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-slate-400">Loading time…</div>
      }
    >
      <TimePageClient isAdmin={ctx.role === "admin"} designers={designers} />
    </Suspense>
  );
}
