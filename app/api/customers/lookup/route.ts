import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import {
  findCustomerByContact,
  findCustomerByContacts,
} from "@/lib/customers";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const contact = searchParams.get("contact")?.trim();
  const email = searchParams.get("email")?.trim() || null;
  const phone = searchParams.get("phone")?.trim() || null;

  if (!contact && !email && !phone) {
    return NextResponse.json(
      { error: "contact, email, or phone is required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  try {
    let customer = null;

    if (email || phone) {
      customer = await findCustomerByContacts(supabase, ctx.tenant.id, {
        email,
        phone,
      });
    } else if (contact) {
      customer = await findCustomerByContact(
        supabase,
        ctx.tenant.id,
        contact
      );
    }

    if (!customer) {
      return NextResponse.json(null);
    }

    return NextResponse.json({
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      company: customer.company,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lookup failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
