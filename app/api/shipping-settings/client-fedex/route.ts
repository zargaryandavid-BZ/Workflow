import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ensureShippingSettings } from "@/lib/shipping-settings";
import { verifyFedExAccountNumber } from "@/lib/fedex";
import {
  maskFedExAccountNumber,
  normalizeFedExAccountNumber,
} from "@/lib/client-fedex";

export type ClientFedExAccountRow = {
  customer_id: string;
  customer_name: string;
  company: string | null;
  account_masked: string;
};

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("id, name, company, fedex_account_number")
    .eq("tenant_id", ctx.tenant.id)
    .not("fedex_account_number", "is", null)
    .order("name", { ascending: true });

  if (error) {
    if (
      error.code === "42703" ||
      /fedex_account_number/i.test(error.message)
    ) {
      return NextResponse.json({
        accounts: [] as ClientFedExAccountRow[],
        setupError:
          "Apply migration 0101_customer_fedex_account.sql to store client FedEx accounts.",
      });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const accounts: ClientFedExAccountRow[] = (data ?? [])
    .filter((row) => Boolean(row.fedex_account_number))
    .map((row) => ({
      customer_id: row.id as string,
      customer_name: String(row.name ?? "Customer"),
      company: (row.company as string | null) ?? null,
      account_masked: maskFedExAccountNumber(
        String(row.fedex_account_number)
      ),
    }));

  return NextResponse.json({ accounts });
}

export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    customer_id?: string;
    account_number?: string;
  };
  const customerId = body.customer_id?.trim() ?? "";
  const account = normalizeFedExAccountNumber(body.account_number);
  if (!customerId) {
    return NextResponse.json({ error: "Select a customer." }, { status: 400 });
  }
  if (!account) {
    return NextResponse.json(
      { error: "Enter a valid FedEx account number (8–12 digits)." },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const { data: customer, error: loadErr } = await supabase
    .from("customers")
    .select("id, name, fedex_account_number")
    .eq("id", customerId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (loadErr) {
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  }
  if (!customer) {
    return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  }

  const { data: existing } = await supabase
    .from("customers")
    .select("id, name")
    .eq("tenant_id", ctx.tenant.id)
    .eq("fedex_account_number", account)
    .maybeSingle();
  if (existing && existing.id !== customerId) {
    return NextResponse.json(
      {
        error: `That FedEx account is already saved for ${existing.name}.`,
      },
      { status: 409 }
    );
  }

  const settings = await ensureShippingSettings(supabase, ctx.tenant.id);
  const check = await verifyFedExAccountNumber(account, settings);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  const { error: updErr } = await supabase
    .from("customers")
    .update({ fedex_account_number: account })
    .eq("id", customerId)
    .eq("tenant_id", ctx.tenant.id);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    account: {
      customer_id: customerId,
      customer_name: customer.name,
      company: null,
      account_masked: maskFedExAccountNumber(account),
    },
  });
}

export async function DELETE(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const customerId = new URL(request.url).searchParams.get("customer_id")?.trim();
  if (!customerId) {
    return NextResponse.json({ error: "Missing customer." }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update({ fedex_account_number: null })
    .eq("id", customerId)
    .eq("tenant_id", ctx.tenant.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
