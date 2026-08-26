import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  dieRequestAlert,
  parseDieRequestFiles,
  pickDieBoardStatus,
  worstDieAlert,
  type DieAlert,
  type DieBoardStatus,
  type DieRequest,
  type DieRequestFile,
  type DieRequestStatus,
} from "@/lib/die-request";

export async function listDieRequests(
  supabase: SupabaseClient,
  tenantId: string
): Promise<DieRequest[]> {
  const { data, error } = await supabase
    .from("die_requests")
    .select(
      "*, order:orders(title, due_date, customer:customers(name)), manufacturer:die_manufacturers(full_name)"
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("die_requests")) return [];
    if (msg.includes("die_manufacturers") || msg.includes("manufacturer")) {
      const fallback = await supabase
        .from("die_requests")
        .select("*, order:orders(title, due_date, customer:customers(name))")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (fallback.error) {
        if (fallback.error.message.toLowerCase().includes("die_requests")) {
          return [];
        }
        throw new Error(fallback.error.message);
      }
      return ((fallback.data ?? []) as Record<string, unknown>[]).map(
        mapDieRequestRow
      );
    }
    throw new Error(error.message);
  }

  return ((data ?? []) as Record<string, unknown>[]).map(mapDieRequestRow);
}

function mapDieRequestRow(row: Record<string, unknown>): DieRequest {
  const order = row.order as
    | {
        title?: string;
        due_date?: string | null;
        customer?: { name?: string | null } | { name?: string | null }[] | null;
      }
    | null;
  const customer = Array.isArray(order?.customer)
    ? order?.customer[0]
    : order?.customer;

  const manufacturer = row.manufacturer as
    | { full_name?: string | null }
    | { full_name?: string | null }[]
    | null;
  const mfg = Array.isArray(manufacturer) ? manufacturer[0] : manufacturer;

  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    order_id: String(row.order_id),
    token: String(row.token),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    required_date: String(row.required_date).slice(0, 10),
    allow_own_date: Boolean(row.allow_own_date),
    to_email: String(row.to_email),
    manufacturer_id: row.manufacturer_id ? String(row.manufacturer_id) : null,
    manufacturer_name: mfg?.full_name?.trim() || null,
    comment: row.comment ? String(row.comment) : null,
    files: dieFilesFromRow(row),
    file_path: row.file_path ? String(row.file_path) : null,
    file_name: row.file_name ? String(row.file_name) : null,
    file_mime: row.file_mime ? String(row.file_mime) : null,
    status:
      row.status === "ordered"
        ? "ordered"
        : row.status === "quoted"
          ? "quoted"
          : "sent",
    quoted_price:
      row.quoted_price == null ? null : Number(row.quoted_price),
    time_estimate: row.time_estimate ? String(row.time_estimate) : null,
    confirmed_due_date: row.confirmed_due_date
      ? String(row.confirmed_due_date).slice(0, 10)
      : null,
    client_note: row.client_note ? String(row.client_note) : null,
    sent_at: String(row.sent_at),
    quoted_at: row.quoted_at ? String(row.quoted_at) : null,
    ordered_at: row.ordered_at ? String(row.ordered_at) : null,
    created_at: String(row.created_at),
    order_title: order?.title ?? null,
    order_due_date: order?.due_date ? String(order.due_date).slice(0, 10) : null,
    customer_name: customer?.name?.trim() || null,
  };
}

export async function dieBoardStateByOrder(
  supabase: SupabaseClient,
  orderIds: string[]
): Promise<{
  dieAlertByOrder: Record<string, DieAlert>;
  dieStatusByOrder: Record<string, DieBoardStatus>;
}> {
  const dieAlertByOrder: Record<string, DieAlert> = {};
  const dieStatusByOrder: Record<string, DieBoardStatus> = {};
  if (orderIds.length === 0) return { dieAlertByOrder, dieStatusByOrder };

  const { data, error } = await supabase
    .from("die_requests")
    .select("order_id, status, required_date, confirmed_due_date, created_at")
    .in("order_id", orderIds);

  if (error) return { dieAlertByOrder, dieStatusByOrder };

  const statusRows = new Map<
    string,
    Array<{
      status: DieRequestStatus;
      confirmed_due_date: string | null;
      created_at: string;
    }>
  >();
  const alertRows = new Map<string, DieAlert[]>();

  for (const row of data ?? []) {
    const orderId = String(row.order_id);
    const status: DieRequestStatus =
      row.status === "ordered"
        ? "ordered"
        : row.status === "quoted"
          ? "quoted"
          : "sent";
    const list = statusRows.get(orderId) ?? [];
    list.push({
      status,
      confirmed_due_date: row.confirmed_due_date
        ? String(row.confirmed_due_date).slice(0, 10)
        : null,
      created_at: String(row.created_at ?? ""),
    });
    statusRows.set(orderId, list);

    const alert = dieRequestAlert({
      status,
      required_date: String(row.required_date),
      confirmed_due_date: row.confirmed_due_date
        ? String(row.confirmed_due_date)
        : null,
    });
    if (alert) {
      const alerts = alertRows.get(orderId) ?? [];
      alerts.push(alert);
      alertRows.set(orderId, alerts);
    }
  }

  for (const [orderId, rows] of statusRows) {
    const status = pickDieBoardStatus(rows);
    if (status) dieStatusByOrder[orderId] = status;
  }
  for (const [orderId, alerts] of alertRows) {
    const worst = worstDieAlert(alerts);
    if (worst) dieAlertByOrder[orderId] = worst;
  }
  return { dieAlertByOrder, dieStatusByOrder };
}

/** @deprecated use dieBoardStateByOrder */
export async function dieAlertsByOrder(
  supabase: SupabaseClient,
  orderIds: string[]
): Promise<Record<string, DieAlert>> {
  const { dieAlertByOrder } = await dieBoardStateByOrder(supabase, orderIds);
  return dieAlertByOrder;
}

function dieFilesFromRow(row: Record<string, unknown>): DieRequestFile[] {
  const fromJson = parseDieRequestFiles(row.files);
  if (fromJson.length > 0) return fromJson;
  if (row.file_path) {
    return [
      {
        path: String(row.file_path),
        name: row.file_name ? String(row.file_name) : "file",
        mime: row.file_mime ? String(row.file_mime) : null,
      },
    ];
  }
  return [];
}
