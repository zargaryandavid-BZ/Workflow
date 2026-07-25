import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { FeedbackPageClient } from "@/components/feedback/FeedbackPageClient";

export default async function FeedbackPage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");

  return <FeedbackPageClient isAdmin={ctx.role === "admin"} />;
}
