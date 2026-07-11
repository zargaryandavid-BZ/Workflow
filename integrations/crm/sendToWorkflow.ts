/**
 * CRM → BazaarPrinting Workflow outbound webhook.
 *
 * Implemented in **sdr-crm-system**: `backend/sendToWorkflow.js` (wired in
 * `POST /api/tickets` after save). Copy this file if you integrate a different CRM.
 *
 * Env (CRM `.env.local` / Vercel):
 *   WORKFLOW_WEBHOOK_URL=https://workflow-rho-one.vercel.app/api/webhook/orders
 *   WORKFLOW_WEBHOOK_SECRET=<from Workflow Settings → Integrations → Webhook>
 */

const WORKFLOW_WEBHOOK_URL =
  process.env.WORKFLOW_WEBHOOK_URL ??
  "https://workflow-rho-one.vercel.app/api/webhook/orders";

const WORKFLOW_WEBHOOK_SECRET = process.env.WORKFLOW_WEBHOOK_SECRET;

/** CRM product_type → Workflow Product custom field name */
export const PRODUCT_NAME_MAP: Record<string, string> = {
  Pouches: "Pouches Combo",
  "Pouches Combo": "Pouches Combo",
  "Pouches Only": "Pouches Only",
  "Jar Combo": "Jar Combo",
  "Jar Only": "Jar Only",
  "Tube Combo": "Tube Combo",
  "Tube Only": "Tube Only",
  "Labels (Roll)": "Labels (Roll)",
  "Labels (Sheet)": "Labels (Sheet)",
  "Folding Cartons / Boxes": "Folding Cartons / Boxes",
  "Business Cards": "Business Cards",
  "Flyers / Postcards": "Flyers / Postcards",
  Booklets: "Booklets",
  "Diecut Stickers": "Diecut Stickers",
  "Vinyl Labels / 54'' Rolls": "Vinyl Labels / 54'' Rolls",
  "Vinyl Signage": "Vinyl Signage",
  "Banners / Large Format": "Banners / Large Format",
  "Window Decals": "Window Decals",
  Wallpaper: "Wallpaper",
  "Sheet Products (Boyd)": "Sheet Products (Boyd)",
  Apparel: "Apparel",
  Other: "Other",
};

export interface CrmOrder {
  id: string;
  order_number?: string;
  product_type?: string;
  material?: string;
  width?: number | null;
  height?: number | null;
  color_mode?: string | null;
  sides?: string | null;
  lamination?: string | null;
  roll_direction?: string | null;
  spot_uv?: boolean;
  foil?: boolean;
  need_design_foil?: boolean;
  die_cut?: boolean;
  application?: boolean;
  quantity?: number | null;
  due_date?: string | null;
  priority?: string | null;
  description?: string | null;
  designer_id?: string | null;
  designer_email?: string | null;
  designer_name?: string | null;
  skus?: CrmSku[];
}

export interface CrmSku {
  sku_name: string;
  quantity: number;
  artwork_url?: string | null;
}

export interface CrmCustomer {
  name: string;
  email?: string | null;
  phone?: string | null;
}

function sanitizeNone(val?: string | null): string | undefined {
  if (!val || val.toLowerCase() === "none") return undefined;
  return val;
}

function getFallbackDueDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().split("T")[0];
}

export async function sendToWorkflow(
  order: CrmOrder,
  customer: CrmCustomer
): Promise<void> {
  if (!WORKFLOW_WEBHOOK_SECRET) {
    console.warn("[CRM] WORKFLOW_WEBHOOK_SECRET not set — skipping webhook");
    return;
  }

  const finishedSize =
    order.width && order.height ? `${order.width} x ${order.height} in` : null;

  const mappedProduct = order.product_type
    ? (PRODUCT_NAME_MAP[order.product_type] ?? order.product_type)
    : undefined;

  const payload: Record<string, unknown> = {
    source: "crm",
    customer_name: customer.name,
    customer_contact: customer.email ?? undefined,
    customer_phone: customer.phone ?? undefined,
    order_number: order.order_number ?? order.id,
    priority: order.priority ?? "normal",
    due_date: order.due_date ?? getFallbackDueDate(),
    product: mappedProduct,
    materials: order.material ?? undefined,
    finished_size: finishedSize ?? undefined,
    color_mode: sanitizeNone(order.color_mode),
    sides: sanitizeNone(order.sides),
    lamination: sanitizeNone(order.lamination),
    roll_direction: sanitizeNone(order.roll_direction),
    spot_uv: order.spot_uv ?? false,
    foil: order.foil ?? false,
    need_a_design: order.need_design_foil ?? false,
    die_cut: order.die_cut ?? false,
    application: order.application ?? false,
    designer_email: order.designer_email ?? undefined,
    designer: order.designer_name ?? undefined,
    order_qty:
      !order.skus?.length && order.quantity ? order.quantity : undefined,
    description: order.description ?? undefined,
  };

  if (order.skus && order.skus.length > 0) {
    payload.skus = order.skus.map((s) => ({
      sku_name: s.sku_name,
      quantity: s.quantity,
      artwork_url: s.artwork_url ?? undefined,
    }));
  }

  const res = await fetch(WORKFLOW_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-webhook-secret": WORKFLOW_WEBHOOK_SECRET,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Workflow webhook returned ${res.status}: ${body}`);
  }

  const result = await res.json();
  console.log("[CRM] Workflow webhook success:", result);
}

/**
 * Example hook — paste into your CRM order/quote save handler after DB insert succeeds:
 *
 * ```ts
 * import { sendToWorkflow } from "@/lib/sendToWorkflow";
 *
 * // Resolve designer from profiles (adjust table/column names to your CRM)
 * let designerEmail: string | null = null;
 * let designerName: string | null = null;
 * if (savedOrder.designer_id) {
 *   const { data: designer } = await supabase
 *     .from("profiles")
 *     .select("email, full_name")
 *     .eq("id", savedOrder.designer_id)
 *     .single();
 *   designerEmail = designer?.email ?? null;
 *   designerName = designer?.full_name ?? null;
 * }
 *
 * sendToWorkflow(
 *   { ...savedOrder, designer_email: designerEmail, designer_name: designerName },
 *   { name: customer.name, email: customer.email, phone: customer.phone }
 * ).catch((err) => console.error("[CRM] Workflow webhook failed:", err.message));
 * ```
 */
