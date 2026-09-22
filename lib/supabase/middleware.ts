import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isInvalidRefreshTokenError } from "@/lib/supabase/invalid-refresh";
import {
  isPublicApi,
  isPublicPage,
  skipSupabaseSessionUpdate,
} from "@/lib/supabase/session-paths";

export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;

  if (skipSupabaseSessionUpdate(path)) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  let user = null;
  let authError: unknown = null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
    authError = result.error;
  } catch (err) {
    authError = err;
  }

  if (!user && isInvalidRefreshTokenError(authError)) {
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      /* cookies already invalid */
    }
  }

  const isApi = path.startsWith("/api/");

  // API routes handle their own 401 JSON — never redirect them to /login.
  if (isApi || isPublicApi(path)) {
    return supabaseResponse;
  }

  if (!user && !isPublicPage(path)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
