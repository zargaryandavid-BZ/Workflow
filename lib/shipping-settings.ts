import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { FedExConfig, ShippingSettings, ShippingSettingsPublic } from "@/lib/types";

type Client = SupabaseClient;

const SECRET_MASK = "••••••••";

function envShipperDefaults() {
  return {
    street: process.env.FEDEX_SHIPPER_STREET?.trim() || "306 Boyd St",
    city: process.env.FEDEX_SHIPPER_CITY?.trim() || "Los Angeles",
    state: process.env.FEDEX_SHIPPER_STATE?.trim() || "CA",
    zip: process.env.FEDEX_SHIPPER_ZIP?.trim() || "90013",
    country: process.env.FEDEX_SHIPPER_COUNTRY?.trim() || "US",
  };
}

function defaultPickupHoursNote() {
  return "Available for pickup: Mon–Fri 9:30 AM – 5:30 PM, Sat until 4:00 PM";
}

function rowToSettings(row: Record<string, unknown>): ShippingSettings {
  return {
    tenant_id: String(row.tenant_id),
    fedex_api_key: (row.fedex_api_key as string | null) ?? null,
    fedex_secret_key: (row.fedex_secret_key as string | null) ?? null,
    fedex_account_number: (row.fedex_account_number as string | null) ?? null,
    fedex_sandbox: row.fedex_sandbox !== false,
    shipper_street: (row.shipper_street as string | null) ?? null,
    shipper_city: (row.shipper_city as string | null) ?? null,
    shipper_state: (row.shipper_state as string | null) ?? null,
    shipper_zip: (row.shipper_zip as string | null) ?? null,
    shipper_country: (row.shipper_country as string | null) ?? "US",
    pickup_hours_note: (row.pickup_hours_note as string | null) ?? null,
    offer_pickup: row.offer_pickup !== false,
    offer_fedex: row.offer_fedex !== false,
    offer_uber: row.offer_uber !== false,
    offer_curri: Boolean(row.offer_curri),
    payment_enabled: Boolean(row.payment_enabled),
    stripe_publishable_key:
      (row.stripe_publishable_key as string | null) ?? null,
    stripe_secret_key: (row.stripe_secret_key as string | null) ?? null,
    stripe_webhook_secret: (row.stripe_webhook_secret as string | null) ?? null,
    markup_fixed_cents: Number(row.markup_fixed_cents ?? 0),
    markup_percent: Number(row.markup_percent ?? 0),
    updated_at: (row.updated_at as string) ?? new Date().toISOString(),
  };
}

function maskSecret(value: string | null): { set: boolean; preview: string | null } {
  if (!value?.trim()) return { set: false, preview: null };
  const trimmed = value.trim();
  const tail = trimmed.length > 4 ? trimmed.slice(-4) : trimmed;
  return { set: true, preview: `${SECRET_MASK}${tail}` };
}

export function toPublicShippingSettings(
  settings: ShippingSettings
): ShippingSettingsPublic {
  return {
    tenant_id: settings.tenant_id,
    fedex_api_key: maskSecret(settings.fedex_api_key),
    fedex_secret_key: maskSecret(settings.fedex_secret_key),
    fedex_account_number: settings.fedex_account_number,
    fedex_sandbox: settings.fedex_sandbox,
    shipper_street: settings.shipper_street,
    shipper_city: settings.shipper_city,
    shipper_state: settings.shipper_state,
    shipper_zip: settings.shipper_zip,
    shipper_country: settings.shipper_country,
    pickup_hours_note: settings.pickup_hours_note,
    offer_pickup: settings.offer_pickup,
    offer_fedex: settings.offer_fedex,
    offer_uber: settings.offer_uber,
    offer_curri: settings.offer_curri,
    payment_enabled: settings.payment_enabled,
    stripe_publishable_key: settings.stripe_publishable_key,
    stripe_secret_key: maskSecret(settings.stripe_secret_key),
    stripe_webhook_secret: maskSecret(settings.stripe_webhook_secret),
    markup_fixed_cents: settings.markup_fixed_cents,
    markup_percent: settings.markup_percent,
    updated_at: settings.updated_at,
    fedex_configured: isFedExConfiguredFromSettings(settings),
    stripe_configured: isStripeConfiguredFromSettings(settings),
  };
}

export async function ensureShippingSettings(
  client: Client,
  tenantId: string
): Promise<ShippingSettings> {
  const { data: existing } = await client
    .from("shipping_settings")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (existing) {
    return rowToSettings(existing as Record<string, unknown>);
  }

  const shipper = envShipperDefaults();
  // Default sandbox ON for new tenants (dev keys are usually sandbox).
  // Only force production when FEDEX_SANDBOX is explicitly "false".
  const fedexSandbox = process.env.FEDEX_SANDBOX !== "false";
  const { data: created, error } = await client
    .from("shipping_settings")
    .insert({
      tenant_id: tenantId,
      fedex_sandbox: fedexSandbox,
      shipper_street: shipper.street,
      shipper_city: shipper.city,
      shipper_state: shipper.state,
      shipper_zip: shipper.zip,
      shipper_country: shipper.country,
      pickup_hours_note: defaultPickupHoursNote(),
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return rowToSettings(created as Record<string, unknown>);
}

export async function loadShippingSettings(
  client: Client,
  tenantId: string
): Promise<ShippingSettings | null> {
  const { data } = await client
    .from("shipping_settings")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data) return null;
  return rowToSettings(data as Record<string, unknown>);
}

function resolveSecret(dbValue: string | null, envValue: string | undefined) {
  const raw = dbValue?.trim() || envValue?.trim() || null;
  return raw ? stripEnvAssignment(raw) : null;
}

/** If user pasted `FOO=bar` from .env, keep only the value after `=`. */
export function stripEnvAssignment(value: string): string {
  const trimmed = value.trim();
  const match = /^[A-Z][A-Z0-9_]*=(.*)$/s.exec(trimmed);
  return match ? match[1]!.trim() : trimmed;
}

export function resolveFedExConfig(settings: ShippingSettings | null): FedExConfig {
  const shipper = envShipperDefaults();
  return {
    apiKey: resolveSecret(
      settings?.fedex_api_key ?? null,
      process.env.FEDEX_API_KEY
    ),
    secretKey: resolveSecret(
      settings?.fedex_secret_key ?? null,
      process.env.FEDEX_SECRET_KEY
    ),
    accountNumber: resolveSecret(
      settings?.fedex_account_number ?? null,
      process.env.FEDEX_ACCOUNT_NUMBER
    ),
    // Env wins when set so .env.local FEDEX_SANDBOX=true can fix a bad DB default.
    // Otherwise use tenant setting; default to sandbox when neither is set.
    sandbox: (() => {
      const env = process.env.FEDEX_SANDBOX?.trim().toLowerCase();
      if (env === "true") return true;
      if (env === "false") return false;
      if (settings != null) return settings.fedex_sandbox !== false;
      return true;
    })(),
    shipper: {
      street: settings?.shipper_street?.trim() || shipper.street,
      city: settings?.shipper_city?.trim() || shipper.city,
      state: settings?.shipper_state?.trim() || shipper.state,
      zip: settings?.shipper_zip?.trim() || shipper.zip,
      country: settings?.shipper_country?.trim() || shipper.country,
    },
    pickupHoursNote:
      settings?.pickup_hours_note?.trim() || defaultPickupHoursNote(),
  };
}

export function isFedExConfiguredFromSettings(
  settings: ShippingSettings | null
): boolean {
  const config = resolveFedExConfig(settings);
  return Boolean(config.apiKey && config.secretKey && config.accountNumber);
}

export function resolveStripeSecretKey(settings: ShippingSettings | null) {
  return resolveSecret(
    settings?.stripe_secret_key ?? null,
    process.env.STRIPE_SECRET_KEY
  );
}

export function resolveStripePublishableKey(settings: ShippingSettings | null) {
  return resolveSecret(
    settings?.stripe_publishable_key ?? null,
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  );
}

export function isStripeConfiguredFromSettings(
  settings: ShippingSettings | null
): boolean {
  return Boolean(resolveStripeSecretKey(settings));
}

export function pickupLocationFromConfig(config: FedExConfig): string[] {
  const { street, city, state, zip } = config.shipper;
  return [street, `${city}, ${state} ${zip}`, config.pickupHoursNote];
}

/** Whether the client portal may offer this choice for the tenant. */
export function isShippingChoiceOffered(
  settings: ShippingSettings | null | undefined,
  choice: "pickup" | "delivery" | "uber" | "curri"
): boolean {
  switch (choice) {
    case "pickup":
      return settings?.offer_pickup !== false;
    case "delivery":
      // Delivery step shows FedEx and/or Curri live rates.
      return (
        settings?.offer_fedex !== false || Boolean(settings?.offer_curri)
      );
    case "uber":
      return settings?.offer_uber !== false;
    case "curri":
      // Legacy: Curri is now a rate under delivery; still allow stored responses.
      return Boolean(settings?.offer_curri);
  }
}

export type ShippingSettingsPatch = Partial<{
  fedex_api_key: string | null;
  fedex_secret_key: string | null;
  fedex_account_number: string | null;
  fedex_sandbox: boolean;
  shipper_street: string | null;
  shipper_city: string | null;
  shipper_state: string | null;
  shipper_zip: string | null;
  shipper_country: string | null;
  pickup_hours_note: string | null;
  offer_pickup: boolean;
  offer_fedex: boolean;
  offer_uber: boolean;
  offer_curri: boolean;
  payment_enabled: boolean;
  stripe_publishable_key: string | null;
  stripe_secret_key: string | null;
  stripe_webhook_secret: string | null;
  markup_fixed_cents: number;
  markup_percent: number;
}>;

/** Empty string for a secret field means "keep existing". */
export function buildShippingSettingsUpdate(
  existing: ShippingSettings,
  patch: ShippingSettingsPatch
): Record<string, unknown> {
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  const copyIfDefined = <K extends keyof ShippingSettingsPatch>(key: K) => {
    if (patch[key] !== undefined) updates[key] = patch[key];
  };

  copyIfDefined("fedex_account_number");
  copyIfDefined("fedex_sandbox");
  copyIfDefined("shipper_street");
  copyIfDefined("shipper_city");
  copyIfDefined("shipper_state");
  copyIfDefined("shipper_zip");
  copyIfDefined("shipper_country");
  copyIfDefined("pickup_hours_note");
  copyIfDefined("offer_pickup");
  copyIfDefined("offer_fedex");
  copyIfDefined("offer_uber");
  copyIfDefined("offer_curri");
  copyIfDefined("payment_enabled");
  copyIfDefined("markup_fixed_cents");
  copyIfDefined("markup_percent");

  if (patch.stripe_publishable_key !== undefined) {
    const v = patch.stripe_publishable_key;
    updates.stripe_publishable_key =
      v == null || v === "" ? v : stripEnvAssignment(v);
  }

  for (const key of [
    "fedex_api_key",
    "fedex_secret_key",
    "stripe_secret_key",
    "stripe_webhook_secret",
  ] as const) {
    if (patch[key] === undefined) continue;
    const value = patch[key];
    if (value === null || value === "") continue;
    updates[key] = stripEnvAssignment(value);
  }

  return updates;
}
