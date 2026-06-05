import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";

export async function POST() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json(
    { error: "Customers are created automatically from orders." },
    { status: 403 }
  );
}
