import { NextResponse } from "next/server";

/**
 * Retired: this used to set a pending invitee's password from just their
 * email, which let anyone who knew the address take the account over.
 * Invitees now set their password after opening the emailed invite link,
 * which signs them in (see app/(auth)/signup/page.tsx).
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        "Open the invite link from your email to set your password. If it expired, ask your admin to resend the invite.",
    },
    { status: 410 }
  );
}
