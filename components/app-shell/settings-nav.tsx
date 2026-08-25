import Link from "next/link";
import { SETTINGS_NAV_GROUPS } from "@/lib/settings-nav";

export function SettingsHub() {
  return (
    <div className="space-y-8">
      {SETTINGS_NAV_GROUPS.map((group) => (
        <section key={group.id}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {group.label}
          </h2>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
            {group.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block px-4 py-3 hover:bg-slate-50"
                >
                  <p className="text-sm font-medium text-slate-800">
                    {item.label}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {item.description}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
