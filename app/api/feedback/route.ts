import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import {
  isFeedbackSubmitType,
  type FeedbackItem,
  type FeedbackStatus,
  type FeedbackType,
} from "@/lib/feedback";
import { loadFeedbackImagesByFeedbackIds } from "@/lib/feedback-images";

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

function mapItem(
  row: RawFeedback,
  userId: string,
  images: FeedbackItem["images"] = []
): FeedbackItem {
  return {
    ...row,
    is_own: row.user_id === userId,
    images,
  };
}

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("feedback")
    .select(SELECT)
    .eq("tenant_id", ctx.tenant.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as RawFeedback[];
  const imagesById = await loadFeedbackImagesByFeedbackIds(
    supabase,
    ctx.tenant.id,
    rows.map((r) => r.id)
  );

  const items = rows.map((row) =>
    mapItem(row, ctx.userId, imagesById[row.id] ?? [])
  );

  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    type?: string;
    page?: string;
    title?: string;
    comment?: string;
  };

  if (!isFeedbackSubmitType(body.type)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }

  const page = typeof body.page === "string" ? body.page.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const comment = typeof body.comment === "string" ? body.comment.trim() : "";

  if (!page) {
    return NextResponse.json({ error: "Page is required" }, { status: 400 });
  }
  if (!title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }
  if (!comment) {
    return NextResponse.json(
      { error: "Description is required" },
      { status: 400 }
    );
  }

  const displayName =
    ctx.fullName?.trim() || ctx.email?.trim() || "Team member";

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("feedback")
    .insert({
      tenant_id: ctx.tenant.id,
      user_id: ctx.userId,
      display_name: displayName,
      type: body.type,
      page,
      title,
      comment,
    })
    .select(SELECT)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    { item: mapItem(data as RawFeedback, ctx.userId, []) },
    { status: 201 }
  );
}
