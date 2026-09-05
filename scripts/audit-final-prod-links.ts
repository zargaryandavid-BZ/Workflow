/**
 * Check every order's Artwork / Final production Drive URL against Drive.
 *
 * Usage:
 *   npx tsx --import ./scripts/register-server-only.mjs scripts/audit-final-prod-links.ts
 *   npx tsx --import ./scripts/register-server-only.mjs scripts/audit-final-prod-links.ts --fix
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ARTWORK_FIELD_NAME } from "../lib/constants";
import { isGdriveConfigured } from "../lib/gdrive-settings";
import type { GdriveSettings } from "../lib/types";
import { parseDriveIdFromUrl } from "../lib/google-drive";
import {
  getDriveFolderMeta,
  isFinalProdFolderName,
  proofsDriveClient,
} from "../lib/gdrive-proofs";
import { applyResolvedDriveFolderUrls } from "../lib/order-gdrive";
import {
  orderFolderNeedles,
  resolveOrderDriveFolders,
  seedDriveIdsFromOrder,
} from "../lib/resolve-order-drive-folders";
import { driveFolderUrlFromOrderSpecs } from "../lib/webhook-line-folder";

type SettingsRow = GdriveSettings & { tenant_id: string };

function loadEnvLocal() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    /* optional */
  }
}

function rowToSettings(row: Record<string, unknown>): SettingsRow {
  return {
    tenant_id: String(row.tenant_id),
    enabled: Boolean(row.enabled),
    client_email: (row.client_email as string | null) ?? null,
    private_key: (row.private_key as string | null) ?? null,
    root_folder_id: (row.root_folder_id as string | null) ?? null,
    final_root_folder_id: (row.final_root_folder_id as string | null) ?? null,
    shared_drive_id: (row.shared_drive_id as string | null) ?? null,
    final_folder_name:
      (row.final_folder_name as string | null)?.trim() || "Final for Prod",
    link_target:
      row.link_target === "customer" ||
      row.link_target === "order" ||
      row.link_target === "final"
        ? row.link_target
        : "final",
    open_on_create: row.open_on_create !== false,
    updated_at: (row.updated_at as string) ?? new Date().toISOString(),
  };
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return out;
}

async function fetchAllOrders(supabase: SupabaseClient, tenantId: string) {
  const rows: {
    id: string;
    title: string;
    specs: Record<string, unknown> | null;
  }[] = [];
  let from = 0;
  const page = 500;
  for (;;) {
    const { data, error } = await supabase
      .from("orders")
      .select("id, title, specs")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .range(from, from + page - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as typeof rows;
    rows.push(...batch);
    if (batch.length < page) break;
    from += page;
  }
  return rows;
}

type Result = {
  title: string;
  id: string;
  status: string;
  storedArtName: string | null;
  resolvedFinalName: string | null;
  designerName: string | null;
  storedArtId: string | null;
  resolvedFinalId: string | null;
};

async function main() {
  loadEnvLocal();
  const fix = process.argv.includes("--fix");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    );
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: settingsRows, error: settingsError } = await supabase
    .from("gdrive_settings")
    .select("*");
  if (settingsError) throw new Error(settingsError.message);

  const tenants = (settingsRows ?? [])
    .map((row) => rowToSettings(row as Record<string, unknown>))
    .filter((s) => s.enabled && isGdriveConfigured(s));

  if (tenants.length === 0) {
    console.log("No configured Google Drive tenants.");
    return;
  }

  const counts = {
    skip_no_folder: 0,
    ok: 0,
    fixed: 0,
    artwork_is_designer: 0,
    artwork_wrong_id: 0,
    missing_final: 0,
    drive_error: 0,
  };
  const problems: Result[] = [];

  for (const settings of tenants) {
    const tenantId = settings.tenant_id;
    const client = proofsDriveClient(settings);
    const { data: field } = await supabase
      .from("custom_fields")
      .select("id")
      .eq("tenant_id", tenantId)
      .ilike("name", ARTWORK_FIELD_NAME)
      .maybeSingle();
    const fieldId = (field as { id: string } | null)?.id ?? null;

    const orders = await fetchAllOrders(supabase, tenantId);
    const artByOrder = new Map<string, string>();
    if (fieldId) {
      const { data: values, error: valuesError } = await supabase
        .from("custom_field_values")
        .select("order_id, value")
        .eq("custom_field_id", fieldId);
      if (valuesError) throw new Error(valuesError.message);
      for (const row of values ?? []) {
        const oid = String((row as { order_id: string }).order_id);
        const raw = (row as { value?: unknown }).value;
        if (typeof raw === "string" && raw.trim()) artByOrder.set(oid, raw.trim());
      }
    }

    const withFolder = orders.filter((order) => {
      const specs =
        order.specs && typeof order.specs === "object" && !Array.isArray(order.specs)
          ? order.specs
          : {};
      return (
        seedDriveIdsFromOrder({
          specs,
          artworkUrl: artByOrder.get(order.id) || null,
        }).length > 0
      );
    });
    counts.skip_no_folder += orders.length - withFolder.length;
    console.log(
      `\nTenant ${tenantId}: ${orders.length} orders, ${withFolder.length} with a folder link (concurrency 6)`
    );

    const metaCache = new Map<string, string | null>();
    async function folderName(id: string | null): Promise<string | null> {
      if (!id) return null;
      if (metaCache.has(id)) return metaCache.get(id) ?? null;
      try {
        const name = (await getDriveFolderMeta(client, id))?.name ?? null;
        metaCache.set(id, name);
        return name;
      } catch {
        metaCache.set(id, "(unreadable)");
        return "(unreadable)";
      }
    }

    let done = 0;
    await mapPool(withFolder, 6, async (order) => {
      const specs =
        order.specs && typeof order.specs === "object" && !Array.isArray(order.specs)
          ? order.specs
          : {};
      const artworkUrl = artByOrder.get(order.id) ?? "";
      const seeds = seedDriveIdsFromOrder({
        specs,
        artworkUrl: artworkUrl || null,
      });

      let resolved;
      try {
        resolved = await resolveOrderDriveFolders(client, {
          seedIds: seeds,
          extraRootId: settings.final_root_folder_id?.trim() || null,
          excludeParentIds: [
            settings.root_folder_id?.trim() || "",
            settings.shared_drive_id?.trim() || "",
          ].filter(Boolean),
          orderNeedles: orderFolderNeedles({
            title: String(order.title ?? ""),
            specs,
          }),
        });
      } catch (err) {
        counts.drive_error += 1;
        done += 1;
        problems.push({
          title: order.title,
          id: order.id,
          status: `drive_error: ${err instanceof Error ? err.message : String(err)}`,
          storedArtName: null,
          resolvedFinalName: null,
          designerName: null,
          storedArtId: parseDriveIdFromUrl(artworkUrl) ?? null,
          resolvedFinalId: null,
        });
        return;
      }

      const storedArtId = artworkUrl ? parseDriveIdFromUrl(artworkUrl) : null;
      const designerUrl = driveFolderUrlFromOrderSpecs(specs);
      const storedDesignerId = designerUrl
        ? parseDriveIdFromUrl(designerUrl)
        : null;
      const resolvedFinalId = resolved.finalIds[0] ?? null;
      const storedInFinal = Boolean(
        storedArtId && resolved.finalIds.includes(storedArtId)
      );
      const designerId = resolved.designerId ?? storedDesignerId;
      const artworkIsDesigner =
        Boolean(storedArtId) &&
        Boolean(designerId) &&
        storedArtId === designerId;

      done += 1;
      if (done % 40 === 0 || done === withFolder.length) {
        console.log(`  … ${done}/${withFolder.length}`);
      }

      if (storedInFinal) {
        counts.ok += 1;
        return;
      }

      const storedArtName = await folderName(storedArtId);
      const resolvedFinalName = await folderName(resolvedFinalId);
      const designerName = await folderName(designerId);
      const artworkLooksFinal = storedArtName
        ? isFinalProdFolderName(storedArtName)
        : false;

      if (!resolvedFinalId) {
        counts.missing_final += 1;
        problems.push({
          title: order.title,
          id: order.id,
          status: artworkLooksFinal
            ? "stored_looks_final_but_unresolved"
            : "no_final_folder_on_drive",
          storedArtName,
          resolvedFinalName,
          designerName,
          storedArtId,
          resolvedFinalId,
        });
        return;
      }

      if (artworkIsDesigner) counts.artwork_is_designer += 1;
      else counts.artwork_wrong_id += 1;
      problems.push({
        title: order.title,
        id: order.id,
        status: artworkIsDesigner
          ? "artwork_points_at_designer"
          : "artwork_not_resolved_final",
        storedArtName,
        resolvedFinalName,
        designerName,
        storedArtId,
        resolvedFinalId,
      });
      if (fix) {
        await applyResolvedDriveFolderUrls(supabase, tenantId, order.id, {
          designerUrl: resolved.designerUrl,
          finalUrl: resolved.finalUrl,
        });
        counts.fixed += 1;
      }
    });
  }

  console.log("\n=== Summary ===");
  console.log(counts);
  if (problems.length === 0) {
    console.log("All orders with Drive folders have a matching Final production path.");
    return;
  }
  console.log(`\n${problems.length} issue(s):`);
  for (const row of problems.slice(0, 80)) {
    console.log(
      `- ${row.title}\n    ${row.status}\n    stored: ${row.storedArtName ?? "—"} (${row.storedArtId ?? "none"})\n    final:  ${row.resolvedFinalName ?? "—"} (${row.resolvedFinalId ?? "none"})\n    designer: ${row.designerName ?? "—"}`
    );
  }
  if (problems.length > 80) {
    console.log(`… and ${problems.length - 80} more`);
  }
  if (!fix && problems.some((p) => p.resolvedFinalId)) {
    console.log("\nRe-run with --fix to write resolved Final production URLs onto cards.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
