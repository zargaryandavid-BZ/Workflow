import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { WorkspaceLinksManager } from "./workspace-links-manager";

export default async function WorkspaceLinksPage() {
  const ctx = await getTenantContext();
  if (!ctx) return null;
  if (ctx.role !== "admin") redirect("/board");

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800">Workspace links</h1>
      <p className="mb-6 text-sm text-slate-500">
        Mirror order cards into a partner workspace when they enter a column.
        When the mirror reaches an end column, the original card can move to a
        configured column here.
      </p>
      <WorkspaceLinksManager
        currentTenantId={ctx.tenant.id}
        currentTenantName={ctx.tenant.name}
      />
    </div>
  );
}
