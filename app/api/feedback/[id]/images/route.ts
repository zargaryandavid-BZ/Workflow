import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import {
  FEEDBACK_IMAGES_BUCKET,
  MAX_FEEDBACK_IMAGES,
  attachSignedUrlsToFeedbackImages,
  feedbackImageSizeError,
  feedbackImageStoragePath,
  type FeedbackImageRow,
} from "@/lib/feedback-images";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: feedbackId } = await params;
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Images only" }, { status: 400 });
  }
  const sizeError = feedbackImageSizeError(file.size);
  if (sizeError) {
    return NextResponse.json({ error: sizeError }, { status: 422 });
  }

  const supabase = await createClient();
  const { data: feedback, error: loadError } = await supabase
    .from("feedback")
    .select("id, user_id")
    .eq("id", feedbackId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 500 });
  }
  if (!feedback) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if ((feedback as { user_id: string }).user_id !== ctx.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { count } = await supabase
    .from("feedback_images")
    .select("id", { count: "exact", head: true })
    .eq("feedback_id", feedbackId)
    .eq("tenant_id", ctx.tenant.id);

  if ((count ?? 0) >= MAX_FEEDBACK_IMAGES) {
    return NextResponse.json(
      { error: `Maximum ${MAX_FEEDBACK_IMAGES} images per feedback` },
      { status: 422 }
    );
  }

  const position = count ?? 0;
  const storagePath = feedbackImageStoragePath(
    ctx.tenant.id,
    feedbackId,
    file.name
  );

  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadError } = await supabase.storage
    .from(FEEDBACK_IMAGES_BUCKET)
    .upload(storagePath, buffer, {
      contentType: file.type || "image/jpeg",
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: image, error: dbError } = await supabase
    .from("feedback_images")
    .insert({
      tenant_id: ctx.tenant.id,
      feedback_id: feedbackId,
      file_name: file.name,
      file_size: file.size,
      mime_type: file.type || "image/jpeg",
      storage_path: storagePath,
      position,
    })
    .select("*")
    .single();

  if (dbError) {
    await supabase.storage.from(FEEDBACK_IMAGES_BUCKET).remove([storagePath]);
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  const [withUrl] = await attachSignedUrlsToFeedbackImages(supabase, [
    image as FeedbackImageRow,
  ]);

  return NextResponse.json({ image: withUrl }, { status: 201 });
}
