"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { rejectAfter } from "@/lib/with-timeout";
import { SetPasswordForm } from "./set-password-form";

export default function SetPasswordPage() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient({ skipSessionRecover: true });

    async function bootstrap() {
      const params = new URLSearchParams(window.location.search);
      const authError = params.get("error_description") ?? params.get("error");
      const code = params.get("code");
      const tokenHash = params.get("token_hash");
      const otpType = params.get("type");
      const hash = window.location.hash;

      if (authError) {
        setError(
          decodeURIComponent(authError.replace(/\+/g, " ")) +
            " Ask your admin to send a new reset link."
        );
        return;
      }

      const hasResetToken =
        Boolean(code) ||
        Boolean(tokenHash) ||
        hash.includes("access_token");
      if (hasResetToken) {
        await supabase.auth.signOut({ scope: "local" });
      }

      if (code) {
        const timeout = rejectAfter(
          15000,
          "Sign-in timed out. Ask your admin to send a new reset link."
        );
        try {
          const { error: exchangeError } = await Promise.race([
            supabase.auth.exchangeCodeForSession(code),
            timeout.promise,
          ]);
          if (exchangeError) {
            setError(
              `${exchangeError.message} The link may have expired — ask your admin to resend it.`
            );
            return;
          }
          window.history.replaceState(null, "", "/set-password");
        } finally {
          timeout.cancel();
        }
      } else if (tokenHash && otpType) {
        const timeout = rejectAfter(
          15000,
          "Reset link timed out. Ask your admin to send a new reset link."
        );
        try {
          const { error: verifyError } = await Promise.race([
            supabase.auth.verifyOtp({
              token_hash: tokenHash,
              type: otpType as "recovery" | "invite" | "signup" | "email",
            }),
            timeout.promise,
          ]);
          if (verifyError) {
            setError(
              `${verifyError.message} Ask your admin to send a new reset link.`
            );
            return;
          }
          window.history.replaceState(null, "", "/set-password");
        } finally {
          timeout.cancel();
        }
      } else if (hash.includes("access_token")) {
        await supabase.auth.getSession();
        window.history.replaceState(null, "", "/set-password");
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        setError(
          "This reset link is invalid or has expired. Ask your admin to send a new one."
        );
      }
    }

    void bootstrap()
      .catch((err) => {
        setError(
          err instanceof Error
            ? err.message
            : "Could not open this reset link. Ask your admin to send a new one."
        );
      })
      .finally(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-slate-400">
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h1 className="mb-1 text-xl font-semibold text-slate-800">
          Reset password
        </h1>
        <p className="mb-5 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
        <p className="text-center text-sm text-slate-500">
          <Link href="/login" className="font-medium text-[var(--primary)]">
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-slate-800">
        Set a new password
      </h1>
      <p className="mb-5 text-sm text-slate-500">
        Choose a new password for your account, then continue to the board.
      </p>
      <SetPasswordForm />
    </div>
  );
}
