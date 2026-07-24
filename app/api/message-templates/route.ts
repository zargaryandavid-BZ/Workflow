import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  ensureMessageTemplates,
  saveMessageTemplates,
} from "@/lib/message-templates.server";
import { DEFAULT_MESSAGE_TEMPLATES } from "@/lib/message-templates";

function formatLoadError(message: string): string {
  if (
    message.includes("message_templates") ||
    message.includes("schema cache") ||
    message.includes("does not exist")
  ) {
    return "Message templates require migration 0058_message_templates.sql (run supabase db push).";
  }
  return message;
}

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();
  try {
    const templates = await ensureMessageTemplates(supabase, ctx.tenant.id);
    return NextResponse.json({
      templates,
      defaults: DEFAULT_MESSAGE_TEMPLATES,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load templates";
    return NextResponse.json(
      { error: formatLoadError(message) },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const patch =
    body.templates && typeof body.templates === "object"
      ? (body.templates as Record<string, unknown>)
      : body;

  const supabase = await createClient();
  try {
    const templates = await saveMessageTemplates(
      supabase,
      ctx.tenant.id,
      patch
    );
    return NextResponse.json({
      templates,
      defaults: DEFAULT_MESSAGE_TEMPLATES,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save templates";
    return NextResponse.json(
      { error: formatLoadError(message) },
      { status: 500 }
    );
  }
}
