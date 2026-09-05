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
  pickFinalProdFolders,
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
    let foundInsideJob = false;
    try {
      const children = await listChildFolders(client, seed);
      for (const child of pickFinalProdFolders(
        children,
        opts.orderNeedles,
        "inside-job"
      )) {
        finalIds.add(child.id);
        foundInsideJob = true;
      }
    } catch {
      // ignore
    }
    // Sibling Final folders only when this job folder has none — otherwise
    // listing every Final_* in the parent made Artwork hang on open.
    if (!foundInsideJob) {
      for (const parent of meta.parents) {
        if (excluded.has(parent)) continue;
        try {
          const siblings = await listChildFolders(client, parent);
          for (const child of pickFinalProdFolders(
            siblings,
            opts.orderNeedles,
            "shared"
          )) {
            if (child.id !== seed) finalIds.add(child.id);
          }
        } catch {
          // ignore
        }
      }
    }
  }

  if (
    finalIds.size === 0 &&
    extraRootId &&
    opts.orderNeedles.length > 0
  ) {
    try {
      const children = await listChildFolders(client, extraRootId);
      for (const child of pickFinalProdFolders(
        children,
        opts.orderNeedles,
        "shared"
      )) {
        finalIds.add(child.id);
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
