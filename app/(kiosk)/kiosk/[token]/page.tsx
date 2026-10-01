import { notFound } from "next/navigation";
import { KioskScanView } from "@/components/fulfillment/KioskScanView";
import { resolveKioskTenant } from "@/lib/kiosk-token";

export default async function KioskPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token: rawToken } = await params;
  const kiosk = await resolveKioskTenant(rawToken);
  if (!kiosk) notFound();
  return <KioskScanView kiosk={kiosk} />;
}
