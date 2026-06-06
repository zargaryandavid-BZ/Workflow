import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { findCustomerByContact } from "@/lib/customers";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contact = new URL(request.url).searchParams.get("contact")?.trim();
  if (!contact) {
    return NextResponse.json({ error: "contact is required" }, { status: 400 });
  }

  const supabase = await createClient();
  try {
    const customer = await findCustomerByContact(
      supabase,
      ctx.tenant.id,
      contact
    );
    if (!customer) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lookup failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
