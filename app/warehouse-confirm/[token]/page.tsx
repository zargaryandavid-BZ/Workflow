import { PackageCheck } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadWarehouseStockOrderByToken } from "@/lib/warehouse-stock.server";
import { WarehouseConfirmForm } from "./confirm-form";

export const runtime = "nodejs";

export default async function WarehouseConfirmPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const admin = createAdminClient();
  const result = await loadWarehouseStockOrderByToken(admin, token);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 to-emerald-50 p-4">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600 text-white">
            <PackageCheck className="h-5 w-5" />
          </span>
          <span className="text-lg font-semibold text-slate-800">
            Warehouse Stock Confirmation
          </span>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {!result.ok ? (
            <div className="text-center">
              <h1 className="text-lg font-semibold text-slate-800">
                Link not valid
              </h1>
              <p className="mt-1 text-sm text-slate-500">{result.error}</p>
            </div>
          ) : result.order.confirmed ? (
            <div className="text-center">
              <h1 className="text-lg font-semibold text-emerald-700">
                Already confirmed
              </h1>
              <p className="mt-2 text-sm text-slate-600">
                Stock for{" "}
                <span className="font-medium text-slate-800">
                  {result.order.title}
                </span>{" "}
                was already confirmed
                {result.order.confirmedBy
                  ? ` by ${result.order.confirmedBy}`
                  : ""}
                .
              </p>
            </div>
          ) : (
            <>
              <h1 className="text-lg font-semibold text-slate-800">
                {result.order.title}
              </h1>
              <p className="mt-2 text-sm text-slate-600">
                This is a combo order that needs application. Please confirm the
                physical containers (bags / jars / tubes) are in stock so it can
                be released to Ready to Ship.
              </p>
              <WarehouseConfirmForm token={token} />
            </>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-slate-400">
          Only confirm once you have physically verified the containers are in
          stock.
        </p>
      </div>
    </div>
  );
}
