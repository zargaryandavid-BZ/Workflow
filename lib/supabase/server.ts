import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";

type CookiePair = { name: string; value: string };

function parseCookieHeader(raw: string | null): CookiePair[] {
  if (!raw) return [];
  const result: CookiePair[] = [];
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      result.push({ name: trimmed, value: "" });
      continue;
    }
    result.push({
      name: trimmed.slice(0, eq).trim(),
      value: trimmed.slice(eq + 1).trim(),
    });
  }
  return result;
}

function mergeCookies(...lists: CookiePair[][]): CookiePair[] {
  const map = new Map<string, CookiePair>();
  for (const list of lists) {
    for (const cookie of list) {
      map.set(cookie.name, cookie);
    }
  }
  return Array.from(map.values());
}

export async function createClient() {
  const cookieStore = await cookies();
  let headerCookies: CookiePair[] = [];
  try {
    const headerStore = await headers();
    headerCookies = parseCookieHeader(headerStore.get("cookie"));
  } catch {
    // headers() is unavailable outside a request (e.g. static generation).
  }

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          const storeCookies = cookieStore.getAll();
          if (headerCookies.length === 0) {
            return storeCookies;
          }
          // Route handlers sometimes omit Supabase auth chunks from cookies()
          // while the raw Cookie header still has them — merge both sources.
          return mergeCookies(headerCookies, storeCookies);
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Components cannot mutate cookies; proxy refreshes sessions.
          }
        },
      },
    }
  );
}
