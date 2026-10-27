import "server-only";

import { after } from "next/server";
import sharp from "sharp";
import type { createAdminClient } from "@/lib/supabase/admin";
import { ORDER_ASSETS_BUCKET } from "@/lib/order-assets";
import { artworkThumbPath } from "@/lib/artwork-thumb-path";

type Admin = ReturnType<typeof createAdminClient>;

/** Wide enough for a ~160px tile on a 3x phone screen. */
const THUMB_WIDTH = 480;

/** Paths already queued in this server instance, so repeat scans don't redo work. */
const inFlight = new Set<string>();

async function buildThumb(admin: Admin, fullPath: string): Promise<void> {
  const { data, error } = await admin.storage
    .from(ORDER_ASSETS_BUCKET)
    .download(fullPath);
  if (error || !data) return;
  const jpeg = await sharp(Buffer.from(await data.arrayBuffer()))
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .jpeg({ quality: 72 })
    .toBuffer();
  const { error: uploadError } = await admin.storage
    .from(ORDER_ASSETS_BUCKET)
    .upload(artworkThumbPath(fullPath), jpeg, {
      contentType: "image/jpeg",
      upsert: true,
    });
  if (uploadError) throw uploadError;
}

function queueThumbs(admin: Admin, fullPaths: string[]): void {
  const todo = fullPaths.filter((path) => path && !inFlight.has(path));
  if (todo.length === 0) return;
  for (const path of todo) inFlight.add(path);

  const job = async () => {
    for (const path of todo) {
      try {
        await buildThumb(admin, path);
      } catch (err) {
        console.warn(
          "[artwork-thumbnails] thumbnail failed:",
          err instanceof Error ? err.message : err
        );
      } finally {
        inFlight.delete(path);
      }
    }
  };

  try {
    after(job);
  } catch {
    // Outside a request (scripts): run without blocking the caller.
    void job();
  }
}

/**
 * Signed URLs for small thumbnails of stored artwork previews, aligned with
 * `fullPaths`. A thumbnail that doesn't exist yet comes back as "" and is
 * generated in the background, so the first scan of an order shows the full
 * image and later scans get the light one.
 */
export async function signArtworkThumbUrls(
  admin: Admin,
  fullPaths: string[]
): Promise<string[]> {
  if (fullPaths.length === 0) return [];
  const thumbPaths = fullPaths.map((path) => (path ? artworkThumbPath(path) : ""));
  const { data } = await admin.storage
    .from(ORDER_ASSETS_BUCKET)
    .createSignedUrls(
      thumbPaths.filter(Boolean),
      3600
    );
  const urlByPath = new Map(
    (data ?? [])
      .filter((row) => !row.error && row.signedUrl && row.path)
      .map((row) => [row.path as string, row.signedUrl])
  );
  const urls = thumbPaths.map((path) => (path ? urlByPath.get(path) ?? "" : ""));
  queueThumbs(
    admin,
    fullPaths.filter((path, index) => path && !urls[index])
  );
  return urls;
}
