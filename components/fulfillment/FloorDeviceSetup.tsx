import Link from "next/link";

/** Shown on no-login floor pages for a device that isn't registered yet. */
export function FloorDeviceSetup() {
  return (
    <div className="flex min-h-[60vh] flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">
          Set up this device
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          This floor station isn&apos;t registered. An admin can copy the kiosk
          link from <span className="font-medium">Settings → Fulfillment</span>{" "}
          and open it once on this device. After that, Scan, Production and
          Multi-item box open here without signing in.
        </p>
        <Link
          href="/login"
          className="mt-5 inline-flex h-10 items-center justify-center rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-700"
        >
          Sign in instead
        </Link>
      </div>
    </div>
  );
}
