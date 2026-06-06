import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const { new: newParam } = await searchParams;
  const creatingAdditional = newParam === "1";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ctx = await getTenantContext();
  if (ctx && !creatingAdditional) redirect("/board");
  if (creatingAdditional && ctx?.role !== "admin") redirect("/board");

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 to-blue-50 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        {creatingAdditional ? (
          <Link
            href="/board"
            className="mb-4 inline-block text-sm text-slate-500 hover:text-slate-700"
          >
            ← Back to board
          </Link>
        ) : null}
        <h1 className="mb-1 text-xl font-semibold text-slate-800">
          {creatingAdditional ? "Create a new workspace" : "Create your print house"}
        </h1>
        <p className="mb-5 text-sm text-slate-500">
          {creatingAdditional
            ? "Each workspace is isolated — its own board, team, and orders. You can switch between workspaces anytime."
            : "This is your isolated workspace. You can invite teammates and create more workspaces later."}
        </p>
        <OnboardingForm additional={creatingAdditional} />
      </div>
    </div>
  );
}
