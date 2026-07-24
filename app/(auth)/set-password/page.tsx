"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { SetPasswordForm } from "./set-password-form";

export default function SetPasswordPage() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

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
        setReady(true);
        return;
      }

      if (code) {
        const { error: exchangeError } =
          await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          setError(
            `${exchangeError.message} The link may have expired — ask your admin to resend it.`
          );
          setReady(true);
          return;
        }
        window.history.replaceState(null, "", "/set-password");
      } else if (tokenHash && otpType) {
        const { error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: otpType as "recovery" | "invite" | "signup" | "email",
        });
        if (verifyError) {
          setError(
            `${verifyError.message} Ask your admin to send a new reset link.`
          );
          setReady(true);
          return;
        }
        window.history.replaceState(null, "", "/set-password");
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

      setReady(true);
    }

    bootstrap();
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
