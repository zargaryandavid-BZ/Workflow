import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { pdfjsDistRoot } from "@/lib/pdfjs-node-assets";

const ROOT = path.resolve(pdfjsDistRoot());
const ALLOWED = new Set(["cmaps", "standard_fonts", "wasm", "iccs"]);

const MIME: Record<string, string> = {
  ".bcmap": "application/octet-stream",
  ".pfb": "application/x-font-type1",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".icc": "application/vnd.iccprofile",
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> }
) {
  const segments = (await context.params).path ?? [];
  if (segments.length < 2 || !ALLOWED.has(segments[0]!)) {
    return new NextResponse("Not found", { status: 404 });
  }
  if (segments.some((part) => part === ".." || part.includes("\0") || part.includes("/"))) {
    return new NextResponse("Not found", { status: 400 });
  }
  const filePath = path.resolve(ROOT, ...segments);
  if (!filePath.startsWith(ROOT + path.sep)) {
    return new NextResponse("Not found", { status: 400 });
  }
  try {
    const buf = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": MIME[ext] ?? "application/octet-stream",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
