import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { updateCustomerByAdmin } from "@/lib/customers";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (ctx.role !== "admin") {
    return NextResponse.json(
      { error: "Only admins can edit customers." },
      { status: 403 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    email?: string | null;
    phone?: string | null;
    company?: string | null;
  };

  const supabase = await createClient();

  try {
    const customer = await updateCustomerByAdmin(
      supabase,
      ctx.tenant.id,
      id,
      {
        name: body.name ?? "",
        email: body.email,
        phone: body.phone,
        company: body.company,
      }
    );

    return NextResponse.json({ customer });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Update failed";
    const status =
      message === "Customer not found"
        ? 404
        : message.includes("required") ||
            message.includes("Invalid") ||
            message.includes("already")
          ? 400
          : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: _id } = await params;
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json(
    { error: "Customers cannot be deleted manually." },
    { status: 403 }
  );
}
