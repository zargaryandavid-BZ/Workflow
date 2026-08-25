import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { mapDieManufacturerRow } from "@/lib/die-manufacturers";
import { DieManufacturersManager } from "./die-manufacturers-manager";

export default async function DieManufacturersPage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");
  if (ctx.role !== "admin") redirect("/board");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("die_manufacturers")
    .select("*")
    .eq("tenant_id", ctx.tenant.id)
    .order("full_name", { ascending: true });

  const migrationRequired = Boolean(
    error && /die_manufacturers|schema cache|does not exist/i.test(error.message)
  );

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800">
        Die manufacturers
      </h1>
      <p className="mb-5 text-sm text-slate-500">
        Company name, contact name, email, and phone for shops you send die
        requests to. On Die Order, pick a manufacturer instead of typing an
        email.
      </p>
      <DieManufacturersManager
        initial={
          migrationRequired
            ? []
            : (data ?? []).map((row) =>
                mapDieManufacturerRow(row as Record<string, unknown>)
              )
        }
        migrationRequired={migrationRequired}
      />
    </div>
  );
}
