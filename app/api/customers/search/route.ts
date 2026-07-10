import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export interface CustomerSearchResult {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
}

export async function GET(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const contact = searchParams.get("contact")?.trim() ?? "";

  const supabase = await createClient();

  // Contact (phone/email) prefix search
  if (contact.length >= 5) {
    const isConfirmedEmail = contact.includes("@");
    const looksLikePhone = /^[+\d]/.test(contact);
    let query = supabase
      .from("customers")
      .select("id, name, email, phone, company")
      .eq("tenant_id", ctx.tenant.id);

    if (isConfirmedEmail) {
      // Full email with @: search email only
      query = query.ilike("email", `${contact}%`);
    } else if (looksLikePhone) {
      // Starts with + or digit: phone search only
      query = query.or(`phone.ilike.${contact}%,phone.ilike.%${contact}%`);
    } else {
      // Partial text — could be start of email address (before @): search both email prefix and phone
      query = query.or(`email.ilike.${contact}%,phone.ilike.${contact}%`);
    }

    const { data, error } = await query.order("name", { ascending: true }).limit(8);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ customers: (data ?? []) as CustomerSearchResult[] });
  }

  // Name search
  if (q.length < 5) {
    return NextResponse.json({ customers: [] });
  }

  const { data, error } = await supabase
    .from("customers")
    .select("id, name, email, phone, company")
    .eq("tenant_id", ctx.tenant.id)
    .ilike("name", `%${q}%`)
    .order("name", { ascending: true })
    .limit(8);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    customers: (data ?? []) as CustomerSearchResult[],
  });
}
