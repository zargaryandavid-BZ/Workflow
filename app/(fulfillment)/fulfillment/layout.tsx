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
    <div className="flex min-h-screen flex-col">
      <FulfillmentNav />
      <main className="flex-1">{children}</main>
    </div>
  );
}
