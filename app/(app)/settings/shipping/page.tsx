import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  ensureShippingSettings,
  toPublicShippingSettings,
} from "@/lib/shipping-settings";
import { ShippingSettingsManager } from "./shipping-settings-manager";

function formatLoadError(message: string): string {
  if (
    message.includes("shipping_settings") ||
    message.includes("schema cache") ||
    message.includes("does not exist")
  ) {
    return "Shipping settings require migration 0046_shipping_settings_and_payments.sql (run supabase db push).";
  }
  return message;
}

export default async function ShippingSettingsPage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");
  if (ctx.role !== "admin") redirect("/board");

  const supabase = await createClient();
  let loadError: string | null = null;
  let settings = null;

  try {
    settings = toPublicShippingSettings(
      await ensureShippingSettings(supabase, ctx.tenant.id)
    );
  } catch (err) {
    loadError = formatLoadError(
      err instanceof Error ? err.message : "Could not load shipping settings"
    );
  }

  if (!settings) {
    return (
      <div>
        <h1 className="mb-1 text-lg font-semibold text-slate-800">Shipping</h1>
        <p className="mb-6 text-sm text-red-600">{loadError}</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-800">Shipping</h1>
      <p className="mb-6 text-sm text-slate-500">
        FedEx rates, pickup address, and Stripe payments for the client portal.
      </p>
      <ShippingSettingsManager initialSettings={settings} loadError={loadError} />
    </div>
  );
}
