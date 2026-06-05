import { Printer } from "lucide-react";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 to-blue-50 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--primary)] text-white">
            <Printer className="h-5 w-5" />
          </span>
          <span className="text-lg font-semibold text-slate-800">
            Print Production Manager
          </span>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {children}
        </div>
      </div>
    </div>
  );
}
