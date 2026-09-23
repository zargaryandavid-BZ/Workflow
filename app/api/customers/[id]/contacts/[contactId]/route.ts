import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  deleteCustomerContact,
  updateCustomerContact,
} from "@/lib/customer-contacts.server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  const { id, contactId } = await params;
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
    const contact = await updateCustomerContact(
      supabase,
      ctx.tenant.id,
      id,
      contactId,
      body
    );
    return NextResponse.json({ contact });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update contact";
    const status = message === "Contact not found" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  const { id, contactId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();
  try {
    await deleteCustomerContact(supabase, ctx.tenant.id, id, contactId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete contact";
    const status = message === "Contact not found" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
