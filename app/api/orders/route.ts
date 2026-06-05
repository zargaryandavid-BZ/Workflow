import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { linkCustomerFromOrderFields } from "@/lib/customers";
import { logActivity } from "@/lib/automation";
import { validateDueDate } from "@/lib/order-form";
import { normalizeSkus, prepareSkusForSave } from "@/lib/skus";

export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    description?: string;
    columnId?: string;
    priority?: string;
    dueDate?: string | null;
    specs?: Record<string, unknown>;
    customFieldValues?: { customFieldId: string; value: unknown }[];
  };

  if (!body.title?.trim()) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  const dueDateError = validateDueDate(body.dueDate);
  if (dueDateError) {
    return NextResponse.json({ error: dueDateError }, { status: 400 });
  }

  const supabase = await createClient();
  const tenantId = ctx.tenant.id;

  let columnId = body.columnId;
  if (!columnId) {
    const { data: firstCol } = await supabase
      .from("board_columns")
      .select("id")
      .eq("tenant_id", tenantId)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();
    columnId = (firstCol as { id: string } | null)?.id;
  } else {
    const { data: column } = await supabase
      .from("board_columns")
      .select("id")
      .eq("id", columnId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!column) {
      return NextResponse.json({ error: "Invalid column" }, { status: 400 });
    }
  }
  if (!columnId) {
    return NextResponse.json({ error: "No columns found" }, { status: 400 });
  }

  // Append to the end of the target column.
  const { data: last } = await supabase
    .from("orders")
    .select("position")
    .eq("column_id", columnId)
    .eq("tenant_id", tenantId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = ((last as { position: number } | null)?.position ?? 0) + 1000;

  const fieldValues = (body.customFieldValues ?? []).filter(
    (v) => v.value !== null && v.value !== undefined && v.value !== ""
  );

  let customerId: string | null = null;
  if (fieldValues.length > 0) {
    try {
      customerId = await linkCustomerFromOrderFields(
        supabase,
        ctx.tenant.id,
        fieldValues
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save customer";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  const { data: order, error } = await supabase
    .from("orders")
    .insert({
      tenant_id: tenantId,
      column_id: columnId,
      title: body.title.trim(),
      description: body.description ?? null,
      customer_id: customerId,
      priority: body.priority ?? "normal",
      due_date: body.dueDate || null,
      specs: {
        ...(body.specs ?? {}),
        skus: prepareSkusForSave(normalizeSkus(body.specs?.skus)),
      },
      position,
      created_by: ctx.userId,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (fieldValues.length > 0) {
    await supabase.from("custom_field_values").insert(
      fieldValues.map((v) => ({
        order_id: order.id,
        custom_field_id: v.customFieldId,
        value: v.value,
      }))
    );
  }

  const { data: column } = await supabase
    .from("board_columns")
    .select("name")
    .eq("id", columnId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  await logActivity(supabase, {
    tenantId,
    orderId: order.id,
    actor: ctx.userId,
    action: "created",
    metadata: {
      title: order.title,
      column: (column as { name: string } | null)?.name ?? null,
    },
  });

  return NextResponse.json({ order });
}
