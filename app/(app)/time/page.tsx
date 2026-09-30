import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { TimePageClient } from "@/components/time/TimePageClient";

export default async function TimePage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");

  const teamMembers: {
    id: string;
    name: string;
    role: "designer" | "preprod_owner";
  }[] = [];
  if (ctx.role === "admin") {
    const supabase = await createClient();
    const { data: memberships } = await supabase
      .from("memberships")
      .select("user_id, role")
      .eq("tenant_id", ctx.tenant.id);

    const trackedMemberships = (
      (memberships ?? []) as { user_id: string; role: string }[]
    ).filter(
      (
        membership
      ): membership is {
        user_id: string;
        role: "designer" | "preprod_owner";
      } =>
        membership.role === "designer" ||
        membership.role === "preprod_owner"
    );
    const memberIds = [...new Set(trackedMemberships.map((m) => m.user_id))];

    if (memberIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", memberIds);
      const nameById = new Map(
        ((profiles ?? []) as { id: string; full_name: string | null }[]).map(
          (p) => [p.id, p.full_name?.trim() || "Unnamed"]
        )
      );
      for (const membership of trackedMemberships) {
        teamMembers.push({
          id: membership.user_id,
          name: nameById.get(membership.user_id) ?? "Unnamed",
          role: membership.role,
        });
      }
      teamMembers.sort((a, b) => a.name.localeCompare(b.name));
    }
  }

  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-slate-400">Loading time…</div>
      }
    >
      <TimePageClient
        isAdmin={ctx.role === "admin"}
        role={ctx.role}
        canStartPrepress={
          ctx.role === "admin" || ctx.role === "preprod_owner"
        }
        teamMembers={teamMembers}
      />
    </Suspense>
  );
}
