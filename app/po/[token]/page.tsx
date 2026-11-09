import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/utils";
import { PO_STATUS_LABEL, poTotal, sanitizePoItems } from "@/lib/purchase-order";
import { PoVendorUpdateForm } from "@/components/outsource/po-vendor-update-form";

export const metadata = { title: "Purchase order" };
export const dynamic = "force-dynamic";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <p className="mx-auto max-w-3xl text-sm font-semibold text-slate-800">
          Bazaar Printing — Purchase order
        </p>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 py-6">{children}</main>
    </div>
  );
}

export default async function VendorPoPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const notFound = (
    <Shell>
      <p className="text-sm text-slate-600">This link is not available.</p>
    </Shell>
  );
  if (!/^[0-9a-f-]{36}$/i.test(token)) return notFound;
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return notFound;
  }
  const { data: po } = await admin
    .from("purchase_orders")
    .select("*, outsource_vendors(name, contact_name)")
    .eq("token", token)
    .maybeSingle();
  if (!po || po.status === "draft" || po.status === "cancelled") return notFound;

  const items = sanitizePoItems(po.items);
  const total = poTotal(items);
  const vendor = po.outsource_vendors as { name?: string } | null;
  const statusKey = (po.vendor_status as string | null) ?? (po.status as string);
  return (
    <Shell>
      <div className="space-y-5">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h1 className="text-lg font-semibold text-slate-900">{po.po_number}</h1>
            <span className="text-xs font-medium text-slate-500">
              {PO_STATUS_LABEL[statusKey] ?? statusKey}
            </span>
          </div>
          {vendor?.name ? (
            <p className="text-sm text-slate-500">Vendor: {vendor.name}</p>
          ) : null}
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
                <th className="py-1.5">Item</th>
                <th className="py-1.5 text-right">Qty</th>
                <th className="py-1.5 text-right">Unit cost</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="border-b border-slate-100 align-top">
                  <td className="py-2">
                    <p className="font-medium text-slate-800">{it.description}</p>
                    {it.specs ? <p className="text-xs text-slate-500">{it.specs}</p> : null}
                  </td>
                  <td className="py-2 text-right">{it.qty ?? ""}</td>
                  <td className="py-2 text-right">
                    {it.unit_cost != null ? `$${it.unit_cost.toFixed(2)}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {total != null ? (
            <p className="mt-2 text-right text-sm font-semibold">Total: ${total.toFixed(2)}</p>
          ) : null}
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            {po.due_date ? (
              <div>
                <dt className="text-xs uppercase text-slate-400">Needed by</dt>
                <dd>{formatDate(po.due_date as string) || (po.due_date as string)}</dd>
              </div>
            ) : null}
            {po.ship_to ? (
              <div>
                <dt className="text-xs uppercase text-slate-400">Ship to</dt>
                <dd className="whitespace-pre-line">{po.ship_to as string}</dd>
              </div>
            ) : null}
          </dl>
          {po.notes ? (
            <p className="mt-3 text-sm">
              <b>Notes:</b> {po.notes as string}
            </p>
          ) : null}
          {po.folder_url ? (
            <a
              href={po.folder_url as string}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block rounded-md border border-blue-600 px-3 py-1.5 text-sm font-semibold text-blue-700"
            >
              Open print files
            </a>
          ) : null}
        </div>
        <PoVendorUpdateForm token={token} />
      </div>
    </Shell>
  );
}
