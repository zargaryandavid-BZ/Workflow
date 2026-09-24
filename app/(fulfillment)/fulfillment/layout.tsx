import { getTenantContext } from "@/lib/auth";
import { assertFulfillmentPageAccess } from "@/lib/fulfillment-access";
import { FulfillmentNav } from "@/components/fulfillment/FulfillmentNav";

export default async function FulfillmentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getTenantContext();
  assertFulfillmentPageAccess(ctx);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <FulfillmentNav />
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}
