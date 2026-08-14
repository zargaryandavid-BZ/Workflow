/**
 * One-shot: move orders.description → orders.internal_note (Customer note history),
 * then clear description.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx scripts/migrate-description-to-customer-notes.ts
 *   node --env-file=.env.local --import tsx scripts/migrate-description-to-customer-notes.ts --apply
 */
import { createClient } from "@supabase/supabase-js";
import {
  appendNoteEntry,
  parseNoteHistory,
  serializeNoteHistory,
} from "../lib/note-history";

const APPLY = process.argv.includes("--apply");
const PAGE = 500;
const AUTHOR = "Migrated from Order Description";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  const sb = createClient(url, key);

  let from = 0;
  let scanned = 0;
  let wouldMigrate = 0;
  let migrated = 0;
  let skippedEmpty = 0;
  let skippedDup = 0;

  for (;;) {
    const { data, error } = await sb
      .from("orders")
      .select("id, title, description, internal_note")
      .not("description", "is", null)
      .neq("description", "")
      .range(from, from + PAGE - 1);

    if (error) throw new Error(error.message);
    const rows = data ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned += 1;
      const desc =
        typeof row.description === "string" ? row.description.trim() : "";
      if (!desc) {
        skippedEmpty += 1;
        continue;
      }

      const history = parseNoteHistory(row.internal_note);
      const already = history.some(
        (e) => e.text.trim() === desc || e.author === AUTHOR
      );
      if (already && history.some((e) => e.text.trim() === desc)) {
        skippedDup += 1;
        if (APPLY) {
          const { error: clearErr } = await sb
            .from("orders")
            .update({ description: null })
            .eq("id", row.id);
          if (clearErr) {
            console.error("clear failed", row.id, clearErr.message);
            continue;
          }
          migrated += 1;
        } else {
          wouldMigrate += 1;
        }
        continue;
      }

      const next = serializeNoteHistory(
        appendNoteEntry(history, desc, AUTHOR, new Date().toISOString())
      );

      wouldMigrate += 1;
      if (!APPLY) continue;

      const { error: upErr } = await sb
        .from("orders")
        .update({
          internal_note: next,
          description: null,
        })
        .eq("id", row.id);
      if (upErr) {
        console.error("update failed", row.id, upErr.message);
        continue;
      }
      migrated += 1;
    }

    if (rows.length < PAGE) break;
    from += PAGE;
  }

  console.log({
    mode: APPLY ? "apply" : "dry-run",
    scanned,
    wouldMigrate,
    migrated,
    skippedEmpty,
    skippedDup,
  });
  if (!APPLY) {
    console.log("Re-run with --apply to write changes.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
