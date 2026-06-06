/**
 * Renumbers board_columns and custom_fields to sequential positions (0, 1, 2…)
 * per tenant. Run after position gaps accumulate from deletes/reorders.
 *
 * Usage:
 *   npx tsx scripts/resequence-positions.ts
 *   npx tsx scripts/resequence-positions.ts <tenant-uuid>
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import {
  resequenceAllPositions,
  resequencePositionsForTenant,
} from "../lib/resequence-positions";

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
    // .env.local optional if vars are already exported
  }
}

async function main() {
  loadEnvLocal();

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

  const tenantId = process.argv[2];
  if (tenantId) {
    const summary = await resequencePositionsForTenant(supabase, tenantId);
    console.log(`Resequenced tenant ${tenantId}:`, summary);
  } else {
    const results = await resequenceAllPositions(supabase);
    console.log(`Resequenced ${results.length} tenant(s):`);
    for (const row of results) {
      console.log(
        `  ${row.tenantId}: ${row.columns} columns, ${row.custom_fields} custom fields`
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
