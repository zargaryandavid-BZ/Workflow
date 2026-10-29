import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import {
  FLOOR_DEVICE_COOKIE,
  FLOOR_DEVICE_COOKIE_MAX_AGE,
} from "@/lib/floor-device-cookie";

const KIOSK_PATH = /^\/kiosk\/([^/]+)\/?$/;

export async function proxy(request: NextRequest) {
  const response = await updateSession(request);
  // Opening the kiosk link registers this device as a floor station: the
  // no-login /fulfillment/* pages and /api/public/floor/* then accept it.
  const kioskToken = KIOSK_PATH.exec(request.nextUrl.pathname)?.[1];
  if (kioskToken) {
    response.cookies.set(FLOOR_DEVICE_COOKIE, decodeURIComponent(kioskToken), {
      httpOnly: true,
      secure: request.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: FLOOR_DEVICE_COOKIE_MAX_AGE,
    });
  }
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static assets. Include /api so Supabase
     * session cookies refresh before route handlers run (required for
     * fetch("/api/...") from the client).
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
