import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

/** Same-origin pdf.js worker so the customer page does not depend on unpkg. */
export async function GET() {
  const filePath = path.join(
    process.cwd(),
    "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"
  );
  const file = await readFile(filePath);
  return new NextResponse(file, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
