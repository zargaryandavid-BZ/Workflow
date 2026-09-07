import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  BazaarConnectError,
  connectJsonError,
  readConnectSecret,
} from "@/lib/bazaar-connect";

export function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

export async function withConnectHandler(
  request: Request,
  run: (
    client: ReturnType<typeof createAdminClient>,
    secret: string,
    body: unknown
  ) => Promise<unknown>
) {
  const secret = readConnectSecret(request);
  if (!secret) return unauthorized();

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  let client: ReturnType<typeof createAdminClient>;
  try {
    client = createAdminClient();
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  try {
    const result = await run(client, secret, body);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof BazaarConnectError) {
      const { status, body: payload } = connectJsonError(err);
      return NextResponse.json(payload, { status });
    }
    const message = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
