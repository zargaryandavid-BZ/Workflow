import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import {
  isFeedbackStatus,
  isFeedbackSubmitType,
  type FeedbackItem,
  type FeedbackStatus,
  type FeedbackType,
} from "@/lib/feedback";
import {
  deleteFeedbackImageFiles,
  loadFeedbackImagesByFeedbackIds,
  type FeedbackImageRow,
} from "@/lib/feedback-images";

type RawFeedback = {
  id: string;
  tenant_id: string;
  user_id: string;
  display_name: string;
  type: FeedbackType;
  page: string;
  title: string;
  comment: string;
  status: FeedbackStatus;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
};

const SELECT =
  "id, tenant_id, user_id, display_name, type, page, title, comment, status, admin_note, created_at, updated_at";

async function mapItemWithImages(
  supabase: Awaited<ReturnType<typeof createClient>>,
  row: RawFeedback,
  userId: string,
  tenantId: string
): Promise<FeedbackItem> {
  const imagesById = await loadFeedbackImagesByFeedbackIds(supabase, tenantId, [
    row.id,
  ]);
  return {
    ...row,
    is_own: row.user_id === userId,
    images: imagesById[row.id] ?? [],
  };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    type?: string;
    page?: string;
    title?: string;
    comment?: string;
    status?: string;
    admin_note?: string | null;
  };

  const supabase = await createClient();
  const { data: existing, error: loadError } = await supabase
    .from("feedback")
    .select("id, user_id, tenant_id")
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isAuthor = (existing as { user_id: string }).user_id === ctx.userId;
  const isAdmin = ctx.role === "admin";

  if (!isAuthor && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const patch: Record<string, unknown> = {};

  if (isAuthor) {
    if (body.type !== undefined) {
      if (!isFeedbackSubmitType(body.type)) {
        return NextResponse.json({ error: "Invalid type" }, { status: 400 });
      }
      patch.type = body.type;
    }
    if (body.page !== undefined) {
      const page = typeof body.page === "string" ? body.page.trim() : "";
      if (!page) {
        return NextResponse.json({ error: "Page is required" }, { status: 400 });
      }
      patch.page = page;
    }
    if (body.title !== undefined) {
      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (!title) {
        return NextResponse.json(
          { error: "Title is required" },
          { status: 400 }
        );
      }
      patch.title = title;
    }
    if (body.comment !== undefined) {
      const comment =
        typeof body.comment === "string" ? body.comment.trim() : "";
      if (!comment) {
        return NextResponse.json(
          { error: "Description is required" },
          { status: 400 }
        );
      }
      patch.comment = comment;
    }
  }

  if (isAdmin) {
    if (body.status !== undefined) {
      if (!isFeedbackStatus(body.status)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }
      patch.status = body.status;
    }
    if (body.admin_note !== undefined) {
      patch.admin_note =
        typeof body.admin_note === "string" && body.admin_note.trim()
          ? body.admin_note.trim()
          : null;
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No updates provided" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("feedback")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .select(SELECT)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const item = await mapItemWithImages(
    supabase,
    data as RawFeedback,
    ctx.userId,
    ctx.tenant.id
  );
  return NextResponse.json({ item });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const supabase = await createClient();

  const { data: existing, error: loadError } = await supabase
    .from("feedback")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: imageRows } = await supabase
    .from("feedback_images")
    .select("storage_path")
    .eq("feedback_id", id)
    .eq("tenant_id", ctx.tenant.id);

  const paths = ((imageRows ?? []) as Pick<FeedbackImageRow, "storage_path">[])
    .map((r) => r.storage_path)
    .filter(Boolean);

  const { error } = await supabase
    .from("feedback")
    .delete()
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await deleteFeedbackImageFiles(supabase, paths);

  return NextResponse.json({ ok: true });
}
