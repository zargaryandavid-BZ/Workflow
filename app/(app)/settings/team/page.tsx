import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { loadTeamMembers } from "@/lib/team-members";
import { TeamManager } from "./team-manager";

export default async function TeamSettingsPage() {
  const ctx = await getTenantContext();
  if (!ctx) return null;
  if (ctx.role !== "admin") redirect("/board");

  const { members, error, authConfigured } = await loadTeamMembers(ctx.tenant.id);

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800">Team</h1>
      <p className="mb-5 text-sm text-slate-500">
        Manage who has access to your production board. Invite emails are sent
        by Supabase Auth (not Instantly/Twilio).
      </p>
      {!authConfigured ? (
        <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Add <code className="text-xs">SUPABASE_SERVICE_ROLE_KEY</code> to{" "}
          <code className="text-xs">.env.local</code> so member emails load from
          Supabase Auth.
        </p>
      ) : null}
      <TeamManager
        initialMembers={members}
        loadError={error}
        currentUserId={ctx.userId}
      />
    </div>
  );
}
