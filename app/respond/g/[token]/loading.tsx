import { Printer } from "lucide-react";
import { PdfLoadingBar } from "@/components/pdf/pdf-loading-bar";
import { PORTAL_PRODUCT_NAME } from "@/lib/portal-branding";

export default function RespondGroupLoading() {
  return (
    <div className="min-h-screen bg-[#f8fafc] px-4 py-8">
      <div className="mx-auto w-full max-w-[920px] overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-sm">
        <div className="flex items-center gap-2.5 bg-[#1d4ed8] px-4 py-3 text-white">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20">
            <Printer className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold">{PORTAL_PRODUCT_NAME}</span>
        </div>
        <div className="p-6">
          <PdfLoadingBar />
        </div>
      </div>
    </div>
  );
}
