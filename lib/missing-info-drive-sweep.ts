import "server-only";

import { google } from "googleapis";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureGdriveSettings, isGdriveConfigured } from "@/lib/gdrive-settings";
import { parseDriveIdFromUrl } from "@/lib/google-drive";
import { driveFolderUrlFromOrderSpecs } from "@/lib/webhook-line-folder";
import { pickMissingInfoColumn } from "@/lib/missing-info-column";
import { logActivity } from "@/lib/automation";
import {
  createNotification,
  missingInfoReturnColumnId,
  respondToNotification,
} from "@/lib/notifications";
import { listOrderGroupMembers } from "@/lib/ready-to-ship-group";
import { isExplicitPreferredChannel } from "@/lib/preferred-channel";
import { isSmsConfigured } from "@/lib/sms";
import {
  AUTO_MISSING_INFO_ACTIVITY,
  AUTO_MISSING_INFO_MAX_AGE_MS,
  AUTO_MISSING_INFO_NOTE,
  autoMissingInfoChannel,
  autoMissingInfoTiming,
  driveListingHasFiles,
  readAutoMissingInfoMarker,
} from "@/lib/auto-missing-info";
import {
  maybeStopPrepressTimersOnColumnLeave,
  maybeStopWorkTimersOnColumnEnter,
} from "@/lib/stop-order-timers";
import {
  MIRROR_PROP,
  isFolder,
  isPerItemFolderName,
  newCustomerFilesSince,
  pickFilesToMirror,
  type SweepDriveFile,
} from "@/lib/missing-info-drive-pick";
import type { GdriveSettings, Order } from "@/lib/types";

type Client = SupabaseClient;
type Drive = ReturnType<typeof google.drive>;

/** New cards get their job-folder files mirrored for this long. */
const RECENT_DAYS = 3;
const MAX_CARDS = 150;

const FILE_FIELDS =
  "files(id,name,mimeType,createdTime,appProperties,lastModifyingUser(emailAddress),owners(emailAddress))";

function driveClient(settings: GdriveSettings): Drive {
  const key = settings.private_key!;
  const auth = new google.auth.JWT({
    email: settings.client_email!.trim(),
    key: key.includes("\\n") ? key.replace(/\\n/g, "\n") : key,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  return google.drive({ version: "v3", auth });
}

async function listDirect(drive: Drive, folderId: string): Promise<SweepDriveFile[]> {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: FILE_FIELDS,
    pageSize: 100,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return (res.data.files ?? [])
    .filter((f) => f.id && f.name)
    .map((f) => ({
      id: f.id!,
      name: f.name!,
      mimeType: f.mimeType ?? null,
      createdTime: f.createdTime ?? null,
      appProperties: (f.appProperties as Record<string, string> | null) ?? null,
      lastModifyingUser: f.lastModifyingUser ?? null,
      owners: f.owners ?? null,
    }));
}

async function folderMeta(
  drive: Drive,
  id: string
): Promise<{ name: string; parents: string[]; trashed: boolean } | null> {
  try {
    const r = await drive.files.get({
      fileId: id,
      fields: "id,name,parents,trashed",
      supportsAllDrives: true,
    });
    return {
      name: r.data.name ?? "",
      parents: r.data.parents ?? [],
      trashed: r.data.trashed === true,
    };
  } catch {
    return null;
  }
}

async function loadStaffEmails(admin: Client, tenantId: string): Promise<Set<string>> {
  const out = new Set<string>();
  const { data } = await admin
    .from("memberships")
    .select("user_id")
    .eq("tenant_id", tenantId);
  for (const m of (data ?? []) as { user_id: string }[]) {
    try {
      const { data: u } = await admin.auth.admin.getUserById(m.user_id);
      const e = u?.user?.email?.trim().toLowerCase();
      if (e) out.add(e);
    } catch {
      /* skip */
    }
  }
  return out;
}

/** Same move the missing-info link makes; used when no link was sent. */
async function moveBackWithoutLink(
  admin: Client,
  order: Order,
  note: string
): Promise<boolean> {
  const target = await missingInfoReturnColumnId(admin, order);
  if (!target || target === order.column_id) return false;
  const { data: cols } = await admin
    .from("board_columns")
    .select("id, name, kind")
    .in("id", [target, order.column_id]);
  const toCol = (cols ?? []).find((c) => c.id === target) as
    | { name?: string; kind?: string }
    | undefined;
  const fromCol = (cols ?? []).find((c) => c.id === order.column_id) as
    | { name?: string }
    | undefined;
  await admin
    .from("orders")
    .update({ column_id: target, last_moved_at: new Date().toISOString() })
    .eq("id", order.id);
  await maybeStopWorkTimersOnColumnEnter({
    tenantId: order.tenant_id,
    orderId: order.id,
    column: { kind: toCol?.kind, name: toCol?.name },
  });
  await maybeStopPrepressTimersOnColumnLeave({
    tenantId: order.tenant_id,
    orderId: order.id,
    fromColumn: { name: fromCol?.name },
    toColumn: { name: toCol?.name },
  });
  await logActivity(admin, {
    tenantId: order.tenant_id,
    orderId: order.id,
    actor: null,
    action: "customer_replied",
    metadata: {
      via: "drive_upload",
      from: order.column_id,
      to: target,
      toName: toCol?.name ?? null,
      note,
    },
  });
  try {
    const { scheduleBazaarPortalCurrentColumn } = await import("@/lib/bazaar-portal-sync");
    scheduleBazaarPortalCurrentColumn({ tenantId: order.tenant_id, orderIds: [order.id] });
  } catch (err) {
    console.error("[missing-info-drive] portal sync:", err instanceof Error ? err.message : err);
  }
  return true;
}

export type MissingInfoDriveSweepResult = {
  tenantId: string;
  checked: number;
  mirrored: number;
  movedBack: number;
  /** Automatic "please upload your files" requests sent this run. */
  autoRequested: number;
  errors: string[];
};

type AutoOutcome =
  | "requested"
  | "failed"
  | "files_found"
  | "no_contact"
  | "open_request_exists";

async function logAutoOutcome(
  admin: Client,
  order: Order,
  outcome: AutoOutcome,
  extra?: Record<string, unknown>
) {
  await logActivity(admin, {
    tenantId: order.tenant_id,
    orderId: order.id,
    actor: null,
    action: AUTO_MISSING_INFO_ACTIVITY,
    metadata: { outcome, ...(extra ?? {}) },
  });
}

/** Non-folder files in the card's item folder and its job folder (if any). */
async function cardDriveHasFiles(drive: Drive, order: Order): Promise<boolean> {
  const url = driveFolderUrlFromOrderSpecs((order.specs ?? {}) as Record<string, unknown>);
  const itemId = url ? parseDriveIdFromUrl(url) : null;
  if (!itemId) return false;
  const meta = await folderMeta(drive, itemId);
  if (!meta || meta.trashed) return false;
  if (driveListingHasFiles(await listDirect(drive, itemId))) return true;
  const parentId = isPerItemFolderName(meta.name) ? meta.parents[0] : null;
  if (parentId && driveListingHasFiles(await listDirect(drive, parentId))) return true;
  return false;
}

/**
 * Cards that landed in Missing Info automatically because the order came
 * with no print files (specs.auto_missing_info, set at ingest): once the
 * grace period is over, ask the customer for the files with the SAME
 * missing_info request staff send (createNotification → email/SMS per the
 * customer's saved default, one link for every part of the order in Missing
 * Info, activity "customer_notified"). Exactly one attempt per card: an
 * `auto_missing_info_notify` activity row (outcome) is written BEFORE the
 * send, and any existing missing_info request on the card skips it. Never
 * throws for a single card.
 */
async function runAutoMissingInfoRequests(
  admin: Client,
  tenantId: string,
  missingColId: string,
  drive: Drive | null,
  result: MissingInfoDriveSweepResult,
  opts?: { orderIds?: string[] }
): Promise<void> {
  const nowMs = Date.now();
  let q = admin
    .from("orders")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("column_id", missingColId)
    .is("removed_at", null)
    .gte("created_at", new Date(nowMs - AUTO_MISSING_INFO_MAX_AGE_MS).toISOString())
    .limit(MAX_CARDS);
  if (opts?.orderIds?.length) q = q.in("id", opts.orderIds);
  const { data, error } = await q;
  if (error) {
    result.errors.push(`auto-request: ${error.message}`);
    return;
  }
  const due = ((data ?? []) as Order[]).filter((o) => {
    const marker = readAutoMissingInfoMarker(o.specs as Record<string, unknown> | null);
    return marker ? autoMissingInfoTiming(marker.at, nowMs) === "due" : false;
  });
  if (due.length === 0) return;
  const ids = due.map((o) => o.id);

  // Already handled (one attempt per card) or already asked (staff or a
  // sibling card's grouped request).
  const done = new Set<string>();
  const { data: acts, error: actsErr } = await admin
    .from("activity_log")
    .select("order_id")
    .eq("tenant_id", tenantId)
    .eq("action", AUTO_MISSING_INFO_ACTIVITY)
    .in("order_id", ids);
  if (actsErr) {
    result.errors.push(`auto-request: ${actsErr.message}`);
    return;
  }
  for (const a of (acts ?? []) as { order_id: string }[]) done.add(a.order_id);
  const { data: notes, error: notesErr } = await admin
    .from("job_notifications")
    .select("order_id")
    .eq("type", "missing_info")
    .in("order_id", ids);
  if (notesErr) {
    result.errors.push(`auto-request: ${notesErr.message}`);
    return;
  }
  for (const n of (notes ?? []) as { order_id: string }[]) done.add(n.order_id);

  const todo = due.filter((o) => !done.has(o.id));
  if (todo.length === 0) return;

  const { data: tenant } = await admin
    .from("tenants")
    .select("name")
    .eq("id", tenantId)
    .maybeSingle();
  const tenantName =
    (typeof tenant?.name === "string" && tenant.name.trim()) || "Bazaar Printing";
  const smsConfigured = isSmsConfigured();

  for (const order of todo) {
    if (done.has(order.id)) continue; // covered by a sibling's grouped request
    try {
      // Files reached Drive during the grace period (website checkout upload,
      // portal upload) → don't ask; send the card back like the link would.
      if (drive && (await cardDriveHasFiles(drive, order))) {
        await logAutoOutcome(admin, order, "files_found");
        done.add(order.id);
        if (
          await moveBackWithoutLink(
            admin,
            order,
            "Files found in the order's Drive folder — no files request sent."
          )
        ) {
          result.movedBack += 1;
        }
        continue;
      }

      // Another part of this order already has an open files request.
      const members = await listOrderGroupMembers(admin, tenantId, order).catch(
        () => []
      );
      const siblingIds = members
        .filter((m) => m.id !== order.id && m.column_id === order.column_id)
        .map((m) => m.id);
      if (siblingIds.length > 0) {
        const { data: open } = await admin
          .from("job_notifications")
          .select("order_id")
          .eq("type", "missing_info")
          .in("status", ["pending", "sent"])
          .in("order_id", siblingIds)
          .limit(1);
        if ((open ?? []).length > 0) {
          await logAutoOutcome(admin, order, "open_request_exists");
          done.add(order.id);
          continue;
        }
      }

      let customer: {
        email?: string | null;
        phone?: string | null;
        preferred_channel?: string | null;
        preferred_channel_set_at?: string | null;
      } | null = null;
      if (order.customer_id) {
        const full = await admin
          .from("customers")
          .select("email, phone, preferred_channel, preferred_channel_set_at")
          .eq("id", order.customer_id)
          .maybeSingle();
        if (full.error) {
          // preferred_channel_set_at may not exist on older databases.
          const basic = await admin
            .from("customers")
            .select("email, phone, preferred_channel")
            .eq("id", order.customer_id)
            .maybeSingle();
          customer = basic.data ?? null;
        } else {
          customer = full.data ?? null;
        }
      }
      const channel = autoMissingInfoChannel({
        email: customer?.email,
        phone: customer?.phone,
        preferred: customer?.preferred_channel,
        explicit: isExplicitPreferredChannel(customer),
        smsConfigured,
      });
      if (!channel) {
        await logAutoOutcome(admin, order, "no_contact");
        done.add(order.id);
        continue;
      }

      // Claim BEFORE sending so a crash / retry can never send twice.
      await logAutoOutcome(admin, order, "requested", { channel });
      done.add(order.id);
      for (const id of siblingIds) done.add(id);
      try {
        await createNotification(admin, {
          order,
          tenantName,
          type: "missing_info",
          channel,
          staffNote: AUTO_MISSING_INFO_NOTE,
          createdBy: null,
        });
        result.autoRequested += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await logAutoOutcome(admin, order, "failed", { channel, error: message });
        result.errors.push(`${order.id}: auto-request: ${message}`);
      }
    } catch (err) {
      result.errors.push(
        `${order.id}: auto-request: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

/**
 * For each Missing Info card (and every card made in the last few days):
 *  1. Copy loose files from the order's job folder into the card's own item
 *     folder, so designers see what the customer uploaded in the portal.
 *  2. If the card is in Missing Info and the customer added files after it got
 *     there (or files were just copied in for it), send it back exactly like
 *     the missing-info link does (rule target, usually the start column).
 * Additive: never deletes or renames anything in Drive.
 */
export async function runMissingInfoDriveSweepForTenant(
  admin: Client,
  tenantId: string,
  opts?: { orderIds?: string[] }
): Promise<MissingInfoDriveSweepResult> {
  const result: MissingInfoDriveSweepResult = {
    tenantId,
    checked: 0,
    mirrored: 0,
    movedBack: 0,
    autoRequested: 0,
    errors: [],
  };
  const settings = await ensureGdriveSettings(admin, tenantId);
  const driveReady = isGdriveConfigured(settings);

  const { data: cols } = await admin
    .from("board_columns")
    .select("id, name, kind")
    .eq("tenant_id", tenantId);
  const missingCol = pickMissingInfoColumn(
    (cols ?? []) as { id: string; name: string | null; kind: string | null }[]
  );

  if (!driveReady) {
    // No Drive to check — still ask customers whose order came with no files.
    if (missingCol) {
      await runAutoMissingInfoRequests(admin, tenantId, missingCol.id, null, result, opts);
    }
    return result;
  }

  const since = new Date(Date.now() - RECENT_DAYS * 86400_000).toISOString();
  let q = admin
    .from("orders")
    .select("*")
    .eq("tenant_id", tenantId)
    .is("removed_at", null)
    .limit(MAX_CARDS);
  if (opts?.orderIds?.length) {
    q = q.in("id", opts.orderIds);
  } else if (missingCol) {
    q = q.or(`column_id.eq.${missingCol.id},created_at.gte.${since}`);
  } else {
    q = q.gte("created_at", since);
  }
  const { data: orders, error } = await q;
  if (error) {
    result.errors.push(error.message);
    return result;
  }

  const drive = driveClient(settings);
  const parentFilesCache = new Map<string, SweepDriveFile[]>();
  let staffEmails: Set<string> | null = null;

  for (const order of (orders ?? []) as Order[]) {
    const specs = (order.specs ?? {}) as Record<string, unknown>;
    const url = driveFolderUrlFromOrderSpecs(specs);
    const itemId = url ? parseDriveIdFromUrl(url) : null;
    if (!itemId) continue;
    result.checked += 1;
    try {
      const meta = await folderMeta(drive, itemId);
      if (!meta || meta.trashed) continue;
      const itemFiles = (await listDirect(drive, itemId)).filter((f) => !isFolder(f));

      // 1) Mirror loose job-folder files into this item folder.
      const copied: SweepDriveFile[] = [];
      let parentFiles: SweepDriveFile[] = [];
      const parentId = isPerItemFolderName(meta.name) ? meta.parents[0] : null;
      if (parentId) {
        if (!parentFilesCache.has(parentId)) {
          parentFilesCache.set(
            parentId,
            (await listDirect(drive, parentId)).filter((f) => !isFolder(f))
          );
        }
        parentFiles = parentFilesCache.get(parentId) ?? [];
        for (const f of pickFilesToMirror(parentFiles, itemFiles)) {
          const res = await drive.files.copy({
            fileId: f.id,
            supportsAllDrives: true,
            fields: "id,name",
            requestBody: {
              name: f.name,
              parents: [itemId],
              appProperties: { [MIRROR_PROP]: f.id },
            },
          });
          if (res.data.id) {
            copied.push(f);
            result.mirrored += 1;
          }
        }
        if (copied.length > 0) {
          await logActivity(admin, {
            tenantId,
            orderId: order.id,
            actor: null,
            action: "drive_files_mirrored",
            metadata: { files: copied.map((f) => f.name), from: parentId, to: itemId },
          });
        }
      }

      // 2) Missing Info → back to where the missing-info link sends it.
      if (!missingCol || order.column_id !== missingCol.id) continue;
      staffEmails ??= await loadStaffEmails(admin, tenantId);
      const fresh = newCustomerFilesSince(
        [...itemFiles, ...parentFiles],
        order.last_moved_at as string | null,
        staffEmails
      );
      const names = [...new Set([...fresh, ...copied].map((f) => f.name))];
      if (names.length === 0) continue;
      const note = `Customer files received in Drive: ${names.join(", ")}`;

      // A delivered request is "sent" (only undelivered / manual ones stay
      // "pending"); either way its link is still open and resolves the card.
      const { data: pending } = await admin
        .from("job_notifications")
        .select("token")
        .eq("order_id", order.id)
        .eq("type", "missing_info")
        .in("status", ["pending", "sent"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const token = (pending as { token?: string } | null)?.token;
      if (token) {
        const r = await respondToNotification(admin, {
          token,
          response: "info_submitted",
          note,
        });
        if (r.ok) {
          result.movedBack += 1;
          continue;
        }
      }
      if (await moveBackWithoutLink(admin, order, note)) result.movedBack += 1;
    } catch (err) {
      result.errors.push(
        `${order.id}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // After mirroring / moving back: ask customers whose new order came with no
  // files and whose Drive folders are still empty after the grace period.
  if (missingCol) {
    await runAutoMissingInfoRequests(admin, tenantId, missingCol.id, drive, result, opts);
  }
  return result;
}
