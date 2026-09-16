import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { PDFJS_MAP_POLYFILL_SOURCE } from "@/lib/pdfjs-map-polyfill";
import { pdfjsDistRoot } from "@/lib/pdfjs-node-assets";

/** Same-origin pdf.js worker so the customer page does not depend on unpkg. */
export async function GET() {
  const filePath = path.join(pdfjsDistRoot(), "build", "pdf.worker.min.mjs");
  const file = await readFile(filePath, "utf8");
  return new NextResponse(`${PDFJS_MAP_POLYFILL_SOURCE}\n${file}`, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      // Module workers reject anything other than a JS MIME type.
      "X-Content-Type-Options": "nosniff",
    },
  });
}
