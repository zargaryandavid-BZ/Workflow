import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  createCustomerContact,
  listCustomerContacts,
} from "@/lib/customer-contacts.server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();
  try {
    const contacts = await listCustomerContacts(supabase, ctx.tenant.id, id);
    return NextResponse.json({ contacts });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load contacts";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    email?: string | null;
    phone?: string | null;
  };

  const supabase = await createClient();
  try {
    const contact = await createCustomerContact(
      supabase,
      ctx.tenant.id,
      id,
      body
    );
    return NextResponse.json({ contact });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to add contact";
    const status = message === "Customer not found" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
