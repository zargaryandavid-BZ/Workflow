import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadButtonAutomationsWithStatus } from "@/lib/button-automations.server";
import { loadNotificationRulesWithStatus } from "@/lib/notification-rules.server";
import { loadAllFastActionButtonsWithStatus } from "@/lib/fast-action-buttons.server";
import { ButtonAutomationManager } from "./button-automation-manager";
import { NotificationRulesManager } from "./notification-rules-manager";
import { FastActionButtonsManager } from "./fast-action-buttons-manager";
import type { BoardColumn } from "@/lib/types";
import type { TeamMember } from "@/components/RoleOrIndividualPicker";

export default async function ButtonAutomationSettingsPage() {
  const ctx = await getTenantContext();
  if (!ctx) return null;
  if (ctx.role !== "admin") redirect("/board");

  const supabase = await createClient();
  const [
    { buttons, migrationRequired: buttonMigrationRequired },
    { rules, migrationRequired: rulesMigrationRequired },
    { buttons: fastButtons, migrationRequired: fastButtonsMigrationRequired },
    columnsRes,
    membershipsRes,
  ] = await Promise.all([
    loadButtonAutomationsWithStatus(supabase, ctx.tenant.id),
    loadNotificationRulesWithStatus(supabase, ctx.tenant.id),
    loadAllFastActionButtonsWithStatus(supabase, ctx.tenant.id),
    supabase
      .from("board_columns")
      .select("*")
      .eq("tenant_id", ctx.tenant.id)
      .order("position", { ascending: true }),
    supabase
      .from("memberships")
      .select("user_id, role")
      .eq("tenant_id", ctx.tenant.id),
  ]);

  const columns = (columnsRes.data ?? []) as BoardColumn[];

  // Resolve profile names for team member list.
  const memberRows = (membershipsRes.data ?? []) as { user_id: string; role: string }[];
  const memberIds = memberRows.map((m) => m.user_id);
  let profileMap = new Map<string, { name: string; avatar_url: string | null }>();
  if (memberIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", memberIds);
    profileMap = new Map(
      ((profiles ?? []) as { id: string; full_name: string | null; avatar_url: string | null }[]).map(
        (p) => [p.id, { name: p.full_name?.trim() || "Team member", avatar_url: p.avatar_url }]
      )
    );
  }

  const teamMembers: TeamMember[] = memberRows.map((m) => ({
    id: m.user_id,
    name: profileMap.get(m.user_id)?.name ?? "Team member",
    role: m.role as TeamMember["role"],
    avatar_url: profileMap.get(m.user_id)?.avatar_url ?? null,
  }));

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-lg font-semibold text-slate-800">Button Automation</h1>
        <p className="mb-5 text-sm text-slate-500">
          Action buttons shown in order detail modals — filtered by column.
        </p>
        {buttonMigrationRequired ? (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-medium">Database migration required</p>
            <p className="mt-1 text-amber-800">
              Run migration{" "}
              <code className="rounded bg-amber-100 px-1">
                0022_button_automations.sql
              </code>{" "}
              in the Supabase SQL editor, or run{" "}
              <code className="rounded bg-amber-100 px-1">supabase db push</code>{" "}
              from this project.
            </p>
          </div>
        ) : null}
        <ButtonAutomationManager
          initialButtons={buttons}
          columns={columns}
          disabled={buttonMigrationRequired}
        />
      </section>

      <section>
        <h2 className="text-sm font-semibold text-slate-800">Notification Rules</h2>
        <p className="mb-5 text-sm text-slate-500">
          Rules run automatically when a job enters a column — sending email or SMS
          to the customer or staff.
        </p>
        {rulesMigrationRequired ? (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-medium">Database migration required</p>
            <p className="mt-1 text-amber-800">
              Run migration{" "}
              <code className="rounded bg-amber-100 px-1">
                0023_notification_rules.sql
              </code>{" "}
              in the Supabase SQL editor, or run{" "}
              <code className="rounded bg-amber-100 px-1">supabase db push</code>{" "}
              from this project.
            </p>
          </div>
        ) : null}
        <NotificationRulesManager
          initialRules={rules}
          columns={columns}
          members={teamMembers}
          disabled={rulesMigrationRequired}
        />
      </section>

      <section>
        <h2 className="text-sm font-semibold text-slate-800">
          Fast Action Buttons
        </h2>
        <p className="mb-5 text-sm text-slate-500">
          One-click buttons inside the order card that instantly move it to a
          column.
        </p>
        {fastButtonsMigrationRequired ? (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-medium">Database migration required</p>
            <p className="mt-1 text-amber-800">
              Run migration{" "}
              <code className="rounded bg-amber-100 px-1">
                0024_fast_action_buttons.sql
              </code>{" "}
              in the Supabase SQL editor, or run{" "}
              <code className="rounded bg-amber-100 px-1">supabase db push</code>{" "}
              from this project.
            </p>
          </div>
        ) : null}
        <FastActionButtonsManager
          initialButtons={fastButtons}
          columns={columns}
          notificationRules={rules}
          members={teamMembers}
          disabled={fastButtonsMigrationRequired}
        />
      </section>
    </div>
  );
}
