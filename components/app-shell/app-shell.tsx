"use client";

import { useState } from "react";
import { Sidebar } from "@/components/app-shell/sidebar";
import { Topbar } from "@/components/app-shell/topbar";
import type { Role } from "@/lib/types";

interface AppShellProps {
  role: Role;
  tenants: { id: string; name: string }[];
  activeTenantId: string;
  email: string | null;
  fullName: string | null;
  boardHealthVisible?: boolean;
  children: React.ReactNode;
}

export function AppShell({
  role,
  tenants,
  activeTenantId,
  email,
  fullName,
  boardHealthVisible = true,
  children,
}: AppShellProps) {
  // Closed by default on all screen sizes; open via the topbar menu button.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen w-full max-w-full overflow-hidden overscroll-none">
      {sidebarOpen ? (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <Sidebar
        role={role}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          tenants={tenants}
          activeTenantId={activeTenantId}
          email={email}
          fullName={fullName}
          role={role}
          sidebarOpen={sidebarOpen}
          onMenuToggle={() => setSidebarOpen((open) => !open)}
          boardHealthVisible={boardHealthVisible}
        />
        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
