import "server-only";

import JSZip from "jszip";
import type { SupabaseClient } from "@supabase/supabase-js";
import { enrichActivityLog } from "@/lib/activity";
import { ORDER_ASSETS_BUCKET, safeAssetFileName } from "@/lib/order-assets";
import { listSkuImagesForOrder } from "@/lib/sku-images";
import { loadOrderWithRelations } from "@/lib/orders/load-with-relations";
import type { ActivityLog, Asset, Order } from "@/lib/types";

/** Full history for archives (UI list stays capped separately). */
const ARCHIVE_ACTIVITY_LIMIT = 5000;

type Client = SupabaseClient;

export interface OrderArchiveFileFailure {
  source: string;
  reason: string;
}

export interface OrderArchiveResult {
  zip: Buffer;
  fileName: string;
  failures: OrderArchiveFileFailure[];
}

function archiveFolderName(title: string, orderId: string): string {
  const base = safeAssetFileName(title.trim() || orderId).replace(/_+/g, "_");
  return (base || orderId).slice(0, 80);
}

function uniquePath(used: Set<string>, dir: string, fileName: string): string {
  const safe = safeAssetFileName(fileName) || "file";
  let path = `${dir}/${safe}`;
  if (!used.has(path)) {
    used.add(path);
    return path;
  }
  const dot = safe.lastIndexOf(".");
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : "";
  let i = 2;
  while (used.has(path)) {
    path = `${dir}/${stem}-${i}${ext}`;
    i += 1;
  }
  used.add(path);
  return path;
}

async function downloadStorageFile(
  client: Client,
  storagePath: string
): Promise<Uint8Array | null> {
  const { data, error } = await client.storage
    .from(ORDER_ASSETS_BUCKET)
    .download(storagePath);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

async function downloadExternalUrl(
  url: string
): Promise<{ bytes: Uint8Array; contentType: string | null } | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return {
      bytes: buf,
      contentType: res.headers.get("content-type"),
    };
  } catch {
    return null;
  }
}

function guessFileNameFromUrl(url: string, fallback: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    if (last && last.includes(".")) return decodeURIComponent(last);
  } catch {
    /* ignore */
  }
  return fallback;
}

/**
 * Builds a ZIP archive for one order: JSON snapshot (fields, history, dates)
 * plus all Storage and reachable external artwork files.
 */
export async function buildOrderArchiveZip(
  client: Client,
  params: { tenantId: string; orderId: string }
): Promise<OrderArchiveResult | { error: string; status: number }> {
  const { tenantId, orderId } = params;

  const order = await loadOrderWithRelations(client, orderId, tenantId);
  if (!order) {
    return { error: "Order not found", status: 404 };
  }

  const [
    assetsRes,
    valuesRes,
    activityRes,
    approvalsRes,
    notificationsRes,
    notesRes,
    shippingRes,
    fieldsRes,
    timeRes,
  ] = await Promise.all([
    client
      .from("assets")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true }),
    client.from("custom_field_values").select("*").eq("order_id", orderId),
    client
      .from("activity_log")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true })
      .limit(ARCHIVE_ACTIVITY_LIMIT),
    client
      .from("approvals")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true }),
    client
      .from("job_notifications")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true }),
    client
      .from("order_notes")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true }),
    client
      .from("shipping_requests")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true }),
    client
      .from("custom_fields")
      .select("id, name, field_type, options")
      .eq("tenant_id", tenantId)
      .order("position", { ascending: true }),
    client
      .from("time_entries")
      .select("*")
      .eq("order_id", orderId)
      .eq("tenant_id", tenantId)
      .order("started_at", { ascending: true }),
  ]);

  let skuImages: Awaited<ReturnType<typeof listSkuImagesForOrder>> = [];
  try {
    skuImages = await listSkuImagesForOrder(client, orderId);
  } catch {
    skuImages = [];
  }

  const customFields = fieldsRes.data ?? [];
  const fieldNameById = new Map(
    (customFields as { id: string; name: string }[]).map((f) => [f.id, f.name])
  );
  const customFieldValues = (valuesRes.data ?? []).map(
    (row: {
      custom_field_id: string;
      value: unknown;
      created_at?: string;
      updated_at?: string;
    }) => ({
      field_id: row.custom_field_id,
      field_name: fieldNameById.get(row.custom_field_id) ?? row.custom_field_id,
      value: row.value,
      created_at: row.created_at ?? null,
      updated_at: row.updated_at ?? null,
    })
  );

  const enrichedActivity = await enrichActivityLog(
    client,
    (activityRes.data ?? []) as ActivityLog[],
    order as Order
  );

  const assets = (assetsRes.data ?? []) as Asset[];
  const failures: OrderArchiveFileFailure[] = [];
  const usedPaths = new Set<string>();
  const zip = new JSZip();
  const root = archiveFolderName(order.title, orderId);
  const folder = zip.folder(root);
  if (!folder) {
    return { error: "Failed to create archive", status: 500 };
  }

  const snapshot = {
    exported_at: new Date().toISOString(),
    order: {
      id: order.id,
      title: order.title,
      description: order.description,
      internal_note: order.internal_note,
      priority: order.priority,
      due_date: order.due_date,
      column_id: order.column_id,
      position: order.position,
      specs: order.specs,
      customer_id: order.customer_id,
      tag_id: order.tag_id,
      created_by: order.created_by,
      webhook_source: order.webhook_source,
      created_at: order.created_at,
      updated_at: order.updated_at,
      last_moved_at: order.last_moved_at,
      removed_at: order.removed_at ?? null,
      customer: order.customer ?? null,
      tag: order.tag ?? null,
    },
    custom_fields: customFields,
    custom_field_values: customFieldValues,
    notes: notesRes.data ?? [],
    approvals: approvalsRes.data ?? [],
    notifications: notificationsRes.data ?? [],
    shipping_requests: shippingRes.error ? [] : (shippingRes.data ?? []),
    time_entries: timeRes.error ? [] : (timeRes.data ?? []),
    activity: enrichedActivity,
    assets_index: assets.map((a) => ({
      id: a.id,
      file_name: a.file_name,
      sku_key: a.sku_key,
      notification_id: a.notification_id ?? null,
      storage_path: a.storage_path,
      external_url: a.external_url ?? null,
      mime_type: a.mime_type,
      size: a.size,
      created_at: a.created_at,
    })),
    sku_images_index: skuImages.map((img) => ({
      id: img.id,
      sku_id: img.sku_id,
      file_name: img.file_name,
      storage_path: img.storage_path,
      mime_type: img.mime_type,
      position: img.position,
      created_at: img.created_at,
    })),
  };

  folder.file("order.json", JSON.stringify(snapshot, null, 2));
  folder.file(
    "history.json",
    JSON.stringify(
      {
        exported_at: snapshot.exported_at,
        order_created_at: order.created_at,
        order_updated_at: order.updated_at,
        due_date: order.due_date,
        activity: enrichedActivity,
      },
      null,
      2
    )
  );

  // Order-level + SKU artwork assets
  for (const asset of assets) {
    const subDir = asset.sku_key
      ? `assets/sku-${safeAssetFileName(asset.sku_key)}`
      : asset.notification_id
        ? `assets/customer-uploads`
        : `assets`;

    if (asset.storage_path) {
      const bytes = await downloadStorageFile(client, asset.storage_path);
      if (!bytes) {
        failures.push({
          source: asset.storage_path,
          reason: "Could not download from storage",
        });
        continue;
      }
      const path = uniquePath(usedPaths, subDir, asset.file_name);
      folder.file(path, bytes);
      continue;
    }

    if (asset.external_url) {
      const downloaded = await downloadExternalUrl(asset.external_url);
      if (!downloaded) {
        failures.push({
          source: asset.external_url,
          reason: "External URL unreachable",
        });
        continue;
      }
      const name = asset.file_name?.trim()
        ? asset.file_name
        : guessFileNameFromUrl(asset.external_url, `external-${asset.id}`);
      const path = uniquePath(usedPaths, subDir, name);
      folder.file(path, downloaded.bytes);
    }
  }

  // SKU gallery images
  for (const img of skuImages) {
    const bytes = await downloadStorageFile(client, img.storage_path);
    if (!bytes) {
      failures.push({
        source: img.storage_path,
        reason: "Could not download SKU image from storage",
      });
      continue;
    }
    const path = uniquePath(
      usedPaths,
      `sku-images/${safeAssetFileName(img.sku_id)}`,
      img.file_name
    );
    folder.file(path, bytes);
  }

  const manifestLines = [
    `Order archive: ${order.title}`,
    `Order ID: ${order.id}`,
    `Exported: ${snapshot.exported_at}`,
    `Created: ${order.created_at}`,
    `Updated: ${order.updated_at}`,
    `Due: ${order.due_date ?? "—"}`,
    `Activity events: ${enrichedActivity.length}`,
    `Assets indexed: ${assets.length}`,
    `SKU images: ${skuImages.length}`,
    `Files written: ${usedPaths.size}`,
    `Failures: ${failures.length}`,
    "",
  ];
  if (failures.length > 0) {
    manifestLines.push("Failed to include:");
    for (const f of failures) {
      manifestLines.push(`- ${f.source}: ${f.reason}`);
    }
  }
  folder.file("manifest.txt", manifestLines.join("\n"));

  const zipBytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  return {
    zip: Buffer.from(zipBytes),
    fileName: `${root}-archive.zip`,
    failures,
  };
}
