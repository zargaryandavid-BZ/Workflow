import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";

/** Notes are append-only history — deletion is not allowed. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(
    { error: "Notes cannot be deleted — they are kept as history." },
    { status: 403 }
  );
}
