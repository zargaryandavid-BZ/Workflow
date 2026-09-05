import "server-only";

import { parseDriveIdFromUrl } from "@/lib/google-drive";
import {
  getDriveFolderMeta,
  isFinalProdFolderName,
  listChildFolders,
  type ProofsDrive,
} from "@/lib/gdrive-proofs";
import {
  driveOrderKeyFromTitle,
  shortDriveOrderCode,
} from "@/lib/drive-folder-names";
import { driveFolderUrlFromOrderSpecs } from "@/lib/webhook-line-folder";

export function driveFolderUrlFromId(id: string): string {
  return `https://drive.google.com/drive/folders/${id}`;
}

export function orderFolderNeedles(order: {
  title: string;
  specs: Record<string, unknown>;
}): string[] {
  const out: string[] = [];
  const push = (raw: string) => {
    const t = raw.trim();
    if (t.length >= 3) out.push(t.toLowerCase());
  };
  const title = String(order.title ?? "").trim();
  if (title) {
    push(title);
    const key = driveOrderKeyFromTitle(title);
    push(key);
    push(shortDriveOrderCode(key));
  }
  const webhook =
    typeof order.specs.webhook_order_number === "string"
      ? order.specs.webhook_order_number.trim()
      : "";
  if (webhook) push(webhook);
  const itemTitle =
    typeof order.specs.webhook_item_title === "string"
      ? order.specs.webhook_item_title.trim()
      : "";
  if (itemTitle) push(itemTitle);
  return [...new Set(out)];
}

function folderNameMatchesOrder(name: string, needles: string[]): boolean {
  const n = name.toLowerCase();
  return needles.some((needle) => n.includes(needle));
}

function pickFinalChildren(
  children: { id: string; name: string }[],
  needles: string[]
): { id: string; name: string }[] {
  const named = children.filter((c) => isFinalProdFolderName(c.name));
  if (named.length === 0) return [];
  if (needles.length === 0) return named;
  const matched = named.filter((c) => folderNameMatchesOrder(c.name, needles));
  if (matched.length > 0) return matched;
  return named;
}

export type ResolvedOrderDriveFolders = {
  designerId: string | null;
  designerUrl: string | null;
  designerFromSeed: boolean;
  finalIds: string[];
  finalUrl: string | null;
};

/**
 * Designer vs Final production folders for an order.
 * Never treats a designer/job folder as Final just because it has no nested Final.
 */
export async function resolveOrderDriveFolders(
  client: ProofsDrive,
  opts: {
    seedIds: string[];
    extraRootId: string | null;
    excludeParentIds: string[];
    orderNeedles: string[];
  }
): Promise<ResolvedOrderDriveFolders> {
  const designerFromSeed = new Set<string>();
  const designerFromParent = new Set<string>();
  const finalIds = new Set<string>();
  const extraRootId = opts.extraRootId?.trim() || null;
  const excluded = new Set(
    [...opts.excludeParentIds, extraRootId].filter(Boolean) as string[]
  );

  const uniqueSeeds = [...new Set(opts.seedIds.filter(Boolean))];

  for (const seed of uniqueSeeds) {
    let meta: Awaited<ReturnType<typeof getDriveFolderMeta>>;
    try {
      meta = await getDriveFolderMeta(client, seed);
    } catch {
      continue;
    }
    if (!meta) continue;

    if (isFinalProdFolderName(meta.name)) {
      finalIds.add(seed);
      for (const parent of meta.parents) {
        if (!excluded.has(parent)) designerFromParent.add(parent);
      }
      continue;
    }

    designerFromSeed.add(seed);
    try {
      const children = await listChildFolders(client, seed);
      for (const child of pickFinalChildren(children, opts.orderNeedles)) {
        finalIds.add(child.id);
      }
    } catch {
      // ignore
    }
    for (const parent of meta.parents) {
      if (excluded.has(parent)) continue;
      try {
        const siblings = await listChildFolders(client, parent);
        for (const child of pickFinalChildren(siblings, opts.orderNeedles)) {
          if (child.id !== seed) finalIds.add(child.id);
        }
      } catch {
        // ignore
      }
    }
  }

  if (extraRootId && opts.orderNeedles.length > 0) {
    try {
      const children = await listChildFolders(client, extraRootId);
      for (const child of children) {
        if (
          isFinalProdFolderName(child.name) &&
          folderNameMatchesOrder(child.name, opts.orderNeedles)
        ) {
          finalIds.add(child.id);
        }
      }
    } catch {
      // ignore
    }
  }

  const designerIds = designerFromSeed.size > 0 ? designerFromSeed : designerFromParent;
  for (const id of excluded) designerIds.delete(id);
  for (const id of finalIds) designerIds.delete(id);

  const designerId = [...designerIds][0] ?? null;
  const finalList = [...finalIds];
  return {
    designerId,
    designerUrl: designerId ? driveFolderUrlFromId(designerId) : null,
    designerFromSeed: designerFromSeed.size > 0,
    finalIds: finalList,
    finalUrl: finalList[0] ? driveFolderUrlFromId(finalList[0]) : null,
  };
}

export function seedDriveIdsFromOrder(opts: {
  specs: Record<string, unknown>;
  artworkUrl: string | null | undefined;
}): string[] {
  const designerUrl = driveFolderUrlFromOrderSpecs(opts.specs);
  const ids = [
    designerUrl ? parseDriveIdFromUrl(designerUrl) : null,
    opts.artworkUrl?.trim()
      ? parseDriveIdFromUrl(opts.artworkUrl.trim())
      : null,
  ].filter(Boolean) as string[];
  return [...new Set(ids)];
}
