import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { SettingsHub } from "@/components/app-shell/settings-nav";

export default async function SettingsPage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");
  if (ctx.role !== "admin") redirect("/board");

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800">Settings</h1>
      <p className="mb-5 text-sm text-slate-500">
        Board setup, automations, connections, and team — all in one place.
      </p>
      <SettingsHub />
    </div>
  );
}
