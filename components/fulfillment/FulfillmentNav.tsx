"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PackageCheck, PackagePlus } from "lucide-react";
import { cn } from "@/lib/utils";

export function FulfillmentNav() {
  const pathname = usePathname();
  const isSend = pathname === "/fulfillment/send" || pathname === "/fulfillment";
  const isReceived = pathname === "/fulfillment/received";

  return (
    <header className="flex items-center gap-1 border-b border-slate-200 bg-white px-4 py-2">
      <Link
        href="/fulfillment/send"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
          isSend
            ? "bg-slate-900 text-white"
            : "text-slate-600 hover:bg-slate-100"
        )}
      >
        <PackagePlus className="h-4 w-4" />
        Send
      </Link>
      <Link
        href="/fulfillment/received"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
          isReceived
            ? "bg-slate-900 text-white"
            : "text-slate-600 hover:bg-slate-100"
        )}
      >
        <PackageCheck className="h-4 w-4" />
        Received
      </Link>
    </header>
  );
}
