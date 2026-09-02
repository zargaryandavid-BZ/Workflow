import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ARTWORK_FIELD_NAME, CUSTOMER_NAME_FIELD_NAME } from "@/lib/constants";
import { driveOrderKeyFromTitle } from "@/lib/drive-folder-names";
import {
  ensureGdriveSettings,
  isGdriveConfigured,
} from "@/lib/gdrive-settings";
import { ensureOrderDriveFolders, isLiveDriveFolder } from "@/lib/google-drive";
import { driveFolderUrlFromOrderSpecs } from "@/lib/webhook-line-folder";

type Client = SupabaseClient;

type OrderForGdrive = {
  id: string;
  title: string;
  customer_id?: string | null;
  specs?: Record<string, unknown> | null;
};

/** Full order key used to derive the short Drive code (e.g. ORD-2026-0098). */
function orderKeyFromOrder(order: OrderForGdrive): string {
  const webhook =
    typeof order.specs?.webhook_order_number === "string"
      ? order.specs.webhook_order_number.trim()
      : "";
  if (webhook) return webhook;
  return driveOrderKeyFromTitle(order.title);
}

/**
 * 1-based item index for multi-item Drive folders (`_1`, `_2`, …).
 * Prefer specs.webhook_item_index (0-based), then title suffix, then fallbackIndex.
 */
function partIndexFromOrder(
  order: OrderForGdrive,
  fallbackIndex: number
): number {
  const fromSpecs = order.specs?.webhook_item_index;
  if (typeof fromSpecs === "number" && Number.isFinite(fromSpecs)) {
    return Math.max(1, Math.floor(fromSpecs) + 1);
  }
  const match = order.title.trim().match(/-(\d+)$/);
  if (match) {
    const n = Number.parseInt(match[1], 10);
    if (Number.isFinite(n) && n >= 1) return n;
  }
  return fallbackIndex;
}

/**
 * Human-friendly line-item / part title for the Drive item-folder name
 * (e.g. "100 Cap Labels — PO 117481-1"). Uses specs.webhook_item_title (the CRM
 * product name), matching how the board surfaces the card's display title.
 * Returns "" when none is set, so the caller falls back to the index suffix.
 */
function partTitleFromOrder(order: OrderForGdrive): string {
  const fromSpecs = order.specs?.webhook_item_title;
  if (typeof fromSpecs === "string" && fromSpecs.trim()) {
    return fromSpecs.trim();
  }
  return "";
}

async function resolveCustomerName(
  client: Client,
  tenantId: string,
  order: {
    id: string;
    customer_id?: string | null;
    title?: string;
  }
): Promise<string> {
  if (order.customer_id) {
    const { data } = await client
      .from("customers")
      .select("name")
      .eq("id", order.customer_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const name = (data as { name?: string } | null)?.name?.trim();
    if (name) return name;
  }

  const { data: field } = await client
    .from("custom_fields")
    .select("id")
    .eq("tenant_id", tenantId)
    .ilike("name", CUSTOMER_NAME_FIELD_NAME)
    .maybeSingle();
  const fieldId = (field as { id: string } | null)?.id;
  if (fieldId) {
    const { data: valueRow } = await client
      .from("custom_field_values")
      .select("value")
      .eq("order_id", order.id)
      .eq("custom_field_id", fieldId)
      .maybeSingle();
    const raw = (valueRow as { value?: unknown } | null)?.value;
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }

  return "Unknown Customer";
}

async function upsertArtworkLink(
  client: Client,
  tenantId: string,
  orderIds: string[],
  url: string
): Promise<void> {
  const { data: field } = await client
    .from("custom_fields")
    .select("id")
    .eq("tenant_id", tenantId)
    .ilike("name", ARTWORK_FIELD_NAME)
    .maybeSingle();
  const fieldId = (field as { id: string } | null)?.id;
  if (!fieldId) {
    console.warn(
      `[gdrive] custom field "${ARTWORK_FIELD_NAME}" not found for tenant ${tenantId}`
    );
    return;
  }

  const rows = orderIds.map((orderId) => ({
    order_id: orderId,
    custom_field_id: fieldId,
    value: url,
  }));

  const { error } = await client
    .from("custom_field_values")
    .upsert(rows, { onConflict: "order_id,custom_field_id" });
  if (error) {
    console.error("[gdrive] failed to save Artwork link", error);
  }
}

export type AttachGdriveResult = {
  /** URL saved on Artwork (per link_target; often Final for Prod). */
  linkUrl: string;
  /** Job folder URL — also written to specs.design_task (Design files). */
  jobUrl: string;
  openOnCreate: boolean;
  warning?: string;
};

async function upsertDesignTaskLink(
  client: Client,
  orderIds: string[],
  jobUrl: string
): Promise<void> {
  for (const orderId of orderIds) {
    const { data: row, error: readError } = await client
      .from("orders")
      .select("specs")
      .eq("id", orderId)
      .maybeSingle();
    if (readError) {
      console.error("[gdrive] failed to read specs for design_task", readError);
      continue;
    }
    const specs =
      row?.specs && typeof row.specs === "object" && !Array.isArray(row.specs)
        ? { ...(row.specs as Record<string, unknown>) }
        : {};
    specs.design_task = jobUrl;
    specs.gdrive_item_folder_url = jobUrl;
    const { error } = await client
      .from("orders")
      .update({ specs })
      .eq("id", orderId);
    if (error) {
      console.error("[gdrive] failed to save Design files link", error);
    }
  }
}

export async function linkExistingDriveFolderToOrder(
  client: Client,
  tenantId: string,
  orderId: string,
  folderUrl: string
): Promise<void> {
  const url = folderUrl.trim();
  if (!url) return;
  await upsertArtworkLink(client, tenantId, [orderId], url);
  await upsertDesignTaskLink(client, [orderId], url);
}

/**
 * Create Drive folders and save links on each card.
 *
 * Layout:
 *   `{code}_{Customer}_Y/`                 ← main order folder (e.g. 3009_Bowboyz Ecotics_1)
 *   Final production parent (or inside the job folder):
 *     `{code}_{Customer}_Y_FinalProd/`
 *
 * - Artwork (GDrive link) ← link_target (default Final production)
 * - Design files (`specs.design_task`) ← main order folder
 * Final production is created under Settings → Final production folder when set.
 * When the webhook already sent a line-item Files folder URL, skip create and
 * attach that existing folder to the card.
 * No-ops when GDrive is disabled or not configured — except existing CRM
 * folder URLs, which are still written onto Artwork / Design files.
 */
export async function attachGdriveFoldersToOrders(
  client: Client,
  tenantId: string,
  orders: OrderForGdrive[]
): Promise<AttachGdriveResult | null> {
  if (orders.length === 0) return null;

  const withCrmFolder: OrderForGdrive[] = [];
  const needsCreate: OrderForGdrive[] = [];

  let settings;
  try {
    settings = await ensureGdriveSettings(client, tenantId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes("gdrive_settings") ||
      message.includes("schema cache") ||
      message.includes("does not exist")
    ) {
      settings = null;
    } else {
      console.error("[gdrive] load settings failed", err);
      settings = null;
    }
  }

  const canCheckLive = Boolean(
    settings && settings.enabled && isGdriveConfigured(settings)
  );

  for (const order of orders) {
    const url = driveFolderUrlFromOrderSpecs(order.specs);
    if (!url) {
      needsCreate.push(order);
      continue;
    }
    if (
      canCheckLive &&
      settings &&
      !(await isLiveDriveFolder(settings, url))
    ) {
      needsCreate.push(order);
      continue;
    }
    withCrmFolder.push(order);
  }

  for (const order of withCrmFolder) {
    const url = driveFolderUrlFromOrderSpecs(order.specs);
    if (url) {
      await linkExistingDriveFolderToOrder(client, tenantId, order.id, url);
    }
  }

  if (needsCreate.length === 0) {
    const url = driveFolderUrlFromOrderSpecs(withCrmFolder[0]?.specs) ?? "";
    return url
      ? {
          linkUrl: url,
          jobUrl: url,
          openOnCreate: false,
        }
      : null;
  }

  if (!settings || !settings.enabled || !isGdriveConfigured(settings)) {
    return null;
  }

  const primary = needsCreate[0];
  const customerName = await resolveCustomerName(client, tenantId, primary);
  // Shared parent uses the order key (not per-part title), so all items
  // land under the same Designer folder.
  const orderKey = orderKeyFromOrder(primary);

  try {
    let firstLinkUrl = "";
    let firstJobUrl = "";
    const warnings: string[] = [];

    // Count part titles across this batch so we only append the `_index` suffix
    // when two line items of the same order share a title (keeps names unique).
    const titleCounts = new Map<string, number>();
    for (const o of needsCreate) {
      const t = partTitleFromOrder(o).toLowerCase();
      if (t) titleCounts.set(t, (titleCounts.get(t) ?? 0) + 1);
    }

    for (let i = 0; i < needsCreate.length; i++) {
      const order = needsCreate[i];
      const itemIndex = partIndexFromOrder(order, i + 1);
      const itemTitle = partTitleFromOrder(order);
      const titleCollides =
        itemTitle.length > 0 &&
        (titleCounts.get(itemTitle.toLowerCase()) ?? 0) > 1;
      try {
        const refs = await ensureOrderDriveFolders(
          settings,
          customerName,
          orderKey,
          itemIndex,
          itemTitle || null,
          titleCollides
        );
        if (!firstLinkUrl) firstLinkUrl = refs.linkUrl;
        if (!firstJobUrl) firstJobUrl = refs.jobUrl;
        await upsertArtworkLink(client, tenantId, [order.id], refs.linkUrl);
        await upsertDesignTaskLink(client, [order.id], refs.jobUrl);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[gdrive] folder create failed for order ${order.id}`,
          message
        );
        warnings.push(
          `Part ${itemIndex}: ${message}`
        );
      }
    }

    if (!firstJobUrl && !firstLinkUrl) {
      return {
        linkUrl: "",
        jobUrl: "",
        openOnCreate: false,
        warning: `Google Drive folder could not be created: ${
          warnings[0] ?? "unknown error"
        }`,
      };
    }

    return {
      linkUrl: firstLinkUrl,
      jobUrl: firstJobUrl,
      openOnCreate: settings.open_on_create,
      ...(warnings.length > 0
        ? {
            warning: `Google Drive: ${warnings.join("; ")}`,
          }
        : {}),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[gdrive] folder create failed", message);
    return {
      linkUrl: "",
      jobUrl: "",
      openOnCreate: false,
      warning: `Google Drive folder could not be created: ${message}`,
    };
  }
}
