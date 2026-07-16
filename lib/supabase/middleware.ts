import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/signup", "/approve", "/respond", "/shipping", "/auth"];

/** Token/webhook API routes — no session required; must not redirect to /login. */
const PUBLIC_API_PREFIXES = [
  "/api/webhook/",
  "/api/public/",
  "/api/notifications/respond",
  "/api/notifications/upload",
  "/api/notifications/asset",
  "/api/approvals/decide",
  "/api/shipping/",
  "/api/webhooks/",
  "/api/auth/",
];

function isPublicApi(path: string) {
  return PUBLIC_API_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(prefix)
  );
}

export async function updateSession(request: NextRequest) {
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublicPage = PUBLIC_PATHS.some(
    (p) => path === p || path.startsWith(`${p}/`)
  );
  const isApi = path.startsWith("/api/");

  // API routes handle their own 401 JSON — never redirect them to /login.
  if (isApi || isPublicApi(path)) {
    return supabaseResponse;
  }

  if (!user && !isPublicPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
