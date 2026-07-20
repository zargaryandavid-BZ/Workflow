import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  buildShippingSettingsUpdate,
  ensureShippingSettings,
  toPublicShippingSettings,
  type ShippingSettingsPatch,
} from "@/lib/shipping-settings";

function formatLoadError(message: string): string {
  if (
    message.includes("shipping_settings") ||
    message.includes("schema cache") ||
    message.includes("does not exist")
  ) {
    return "Shipping settings table is not set up yet. Apply migration 0046_shipping_settings_and_payments.sql (and 0050_shipping_offer_options.sql if needed; run supabase db push).";
  }
  return message;
}

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const supabase = await createClient();
  try {
    const settings = await ensureShippingSettings(supabase, ctx.tenant.id);
    return NextResponse.json({ settings: toPublicShippingSettings(settings) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load settings";
    return NextResponse.json(
      { error: formatLoadError(message) },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as ShippingSettingsPatch & {
    markup_fixed_dollars?: unknown;
  };

  if (body.markup_fixed_dollars !== undefined) {
    const dollars = Number(body.markup_fixed_dollars);
    if (!Number.isFinite(dollars) || dollars < 0) {
      return NextResponse.json(
        { error: "markup_fixed_dollars must be a non-negative number" },
        { status: 400 }
      );
    }
    body.markup_fixed_cents = Math.round(dollars * 100);
  }

  if (body.markup_percent !== undefined) {
    const pct = Number(body.markup_percent);
    if (!Number.isFinite(pct) || pct < 0) {
      return NextResponse.json(
        { error: "markup_percent must be a non-negative number" },
        { status: 400 }
      );
    }
    body.markup_percent = pct;
  }

  for (const key of [
    "offer_pickup",
    "offer_fedex",
    "offer_uber",
    "offer_curri",
  ] as const) {
    if (body[key] !== undefined && typeof body[key] !== "boolean") {
      return NextResponse.json(
        { error: `${key} must be a boolean` },
        { status: 400 }
      );
    }
  }

  const supabase = await createClient();
  try {
    const existing = await ensureShippingSettings(supabase, ctx.tenant.id);
    const nextOffers = {
      offer_pickup:
        body.offer_pickup !== undefined
          ? body.offer_pickup
          : existing.offer_pickup,
      offer_fedex:
        body.offer_fedex !== undefined ? body.offer_fedex : existing.offer_fedex,
      offer_uber:
        body.offer_uber !== undefined ? body.offer_uber : existing.offer_uber,
      offer_curri:
        body.offer_curri !== undefined
          ? body.offer_curri
          : existing.offer_curri,
    };
    if (
      !nextOffers.offer_pickup &&
      !nextOffers.offer_fedex &&
      !nextOffers.offer_uber &&
      !nextOffers.offer_curri
    ) {
      return NextResponse.json(
        { error: "Enable at least one delivery option for clients" },
        { status: 400 }
      );
    }

    const updates = buildShippingSettingsUpdate(existing, body);

    if (Object.keys(updates).length <= 1) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("shipping_settings")
      .update(updates)
      .eq("tenant_id", ctx.tenant.id)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const refreshed = await ensureShippingSettings(supabase, ctx.tenant.id);
    return NextResponse.json({
      settings: toPublicShippingSettings(refreshed),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save settings";
    return NextResponse.json(
      { error: formatLoadError(message) },
      { status: 500 }
    );
  }
}
