import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { deleteFeedbackImageFiles } from "@/lib/feedback-images";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> }
) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: feedbackId, imageId } = await params;
  const supabase = await createClient();

  const { data: feedback, error: feedbackError } = await supabase
    .from("feedback")
    .select("id, user_id")
    .eq("id", feedbackId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (feedbackError) {
    return NextResponse.json({ error: feedbackError.message }, { status: 500 });
  }
  if (!feedback) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isAuthor = (feedback as { user_id: string }).user_id === ctx.userId;
  const isAdmin = ctx.role === "admin";
  if (!isAuthor && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: image, error: imageError } = await supabase
    .from("feedback_images")
    .select("id, storage_path")
    .eq("id", imageId)
    .eq("feedback_id", feedbackId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (imageError) {
    return NextResponse.json({ error: imageError.message }, { status: 500 });
  }
  if (!image) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  const storagePath = (image as { storage_path: string }).storage_path;

  const { error: deleteError } = await supabase
    .from("feedback_images")
    .delete()
    .eq("id", imageId)
    .eq("tenant_id", ctx.tenant.id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  await deleteFeedbackImageFiles(supabase, [storagePath]);

  return NextResponse.json({ ok: true });
}
