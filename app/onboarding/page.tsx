import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ctx = await getTenantContext();
  // If the user already belongs to a tenant, send them straight to the board.
  if (ctx) redirect("/board");

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 to-blue-50 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold text-slate-800">
          Create your print house
        </h1>
        <p className="mb-5 text-sm text-slate-500">
          This is your isolated workspace. You can invite teammates and create
          more workspaces later.
        </p>
        <OnboardingForm />
      </div>
    </div>
  );
}
