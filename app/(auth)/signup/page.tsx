"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatAuthEmailError } from "@/lib/auth-email-errors";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

function readInviteParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    email: params.get("invite_email")?.trim().toLowerCase() ?? "",
    name: params.get("invite_name")?.trim() ?? "",
  };
}

export default function SignupPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"loading" | "invite" | "new">("loading");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    async function bootstrap() {
      const params = new URLSearchParams(window.location.search);
      const authError = params.get("error_description") ?? params.get("error");
      const code = params.get("code");
      const tokenHash = params.get("token_hash");
      const otpType = params.get("type");
      const hash = window.location.hash;
      const fromUrl = readInviteParams();

      if (fromUrl.email) setInviteEmail(fromUrl.email);
      if (fromUrl.name) setInviteName(fromUrl.name);

      const hasInviteToken =
        Boolean(code) ||
        Boolean(tokenHash) ||
        hash.includes("access_token");

      if (authError) {
        setError(
          decodeURIComponent(authError.replace(/\+/g, " ")) +
            " Ask your admin to resend the invite."
        );
      }

      // Clear any existing login so the invite applies to the invited user,
      // not whoever was already signed in on this browser.
      if (hasInviteToken) {
        await supabase.auth.signOut();
      }

      if (code) {
        const { error: exchangeError } =
          await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          setError(
            `${exchangeError.message} The link may have expired — ask your admin to resend the invite.`
          );
          setMode(fromUrl.email ? "invite" : "new");
          return;
        }
        const keep = new URLSearchParams();
        if (fromUrl.email) keep.set("invite_email", fromUrl.email);
        if (fromUrl.name) keep.set("invite_name", fromUrl.name);
        const qs = keep.toString();
        window.history.replaceState(null, "", qs ? `/signup?${qs}` : "/signup");
      }

      if (tokenHash && otpType) {
        const { error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: otpType as "invite" | "recovery" | "signup" | "email",
        });
        if (verifyError) {
          setError(
            `${verifyError.message} Ask your admin to resend the invite.`
          );
          setMode(fromUrl.email ? "invite" : "new");
          return;
        }
        const keep = new URLSearchParams();
        if (fromUrl.email) keep.set("invite_email", fromUrl.email);
        if (fromUrl.name) keep.set("invite_name", fromUrl.name);
        const qs = keep.toString();
        window.history.replaceState(null, "", qs ? `/signup?${qs}` : "/signup");
      }

      if (hash.includes("access_token")) {
        await supabase.auth.getSession();
        const keep = new URLSearchParams();
        if (fromUrl.email) keep.set("invite_email", fromUrl.email);
        if (fromUrl.name) keep.set("invite_name", fromUrl.name);
        const qs = keep.toString();
        window.history.replaceState(null, "", qs ? `/signup?${qs}` : "/signup");
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      const metaName =
        typeof user?.user_metadata?.full_name === "string"
          ? user.user_metadata.full_name
          : "";

      if (fromUrl.email || user?.email) {
        setMode("invite");
        setInviteEmail(fromUrl.email || user?.email || "");
        setInviteName(fromUrl.name || metaName || "");

        if (
          fromUrl.email &&
          user?.email &&
          user.email.toLowerCase() !== fromUrl.email
        ) {
          await supabase.auth.signOut();
          setError(
            "This invite is for a different email address. Open the link in a private window or sign out of your other account first."
          );
        }
      } else {
        setMode("new");
      }
    }

    bootstrap();
  }, []);

  async function completeInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/board");
    router.refresh();
  }

  async function createWorkspace(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=/onboarding`;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: redirectTo,
      },
    });
    setLoading(false);
    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("rate limit") || msg.includes("too many")) {
        setError(formatAuthEmailError(error.message));
      } else if (msg.includes("already") || msg.includes("registered")) {
        setError(
          "This email is already registered. If you were invited to a team, open the invite link from your email. Otherwise sign in."
        );
      } else {
        setError(error.message);
      }
      return;
    }
    if (data.session) {
      router.push("/onboarding");
      router.refresh();
    } else {
      setMessage(
        "Check your email to confirm your account, then you'll be taken to workspace setup."
      );
    }
  }

  if (mode === "loading") {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-slate-400">
        Loading…
      </div>
    );
  }

  if (mode === "invite") {
    return (
      <div>
        <h1 className="mb-1 text-xl font-semibold text-slate-800">
          Join your team
        </h1>
        <p className="mb-5 text-sm text-slate-500">
          Confirm your details and choose a password to finish signing up.
        </p>
        <form onSubmit={completeInvite} className="space-y-4">
          {inviteName ? (
            <div>
              <Label htmlFor="invite-name">Full name</Label>
              <Input id="invite-name" readOnly value={inviteName} />
            </div>
          ) : null}
          <div>
            <Label htmlFor="invite-email">Email</Label>
            <Input id="invite-email" readOnly value={inviteEmail} />
          </div>
          <div>
            <Label htmlFor="invite-password">Password</Label>
            <Input
              id="invite-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
            />
          </div>
          <div>
            <Label htmlFor="invite-confirm">Confirm password</Label>
            <Input
              id="invite-confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Re-enter your password"
            />
          </div>
          {error ? (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            className="w-full"
            disabled={loading || !inviteEmail}
          >
            {loading ? "Signing up…" : "Sign up"}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-slate-500">
          Already set your password?{" "}
          <Link href="/login" className="font-medium text-[var(--primary)]">
            Sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-slate-800">
        Create your workspace
      </h1>
      <p className="mb-5 text-sm text-slate-500">
        Start managing print jobs in minutes.
      </p>
      <form onSubmit={createWorkspace} className="space-y-4">
        <div>
          <Label htmlFor="fullName">Full name</Label>
          <Input
            id="fullName"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Alex Printer"
          />
        </div>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@printhouse.com"
          />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 6 characters"
          />
        </div>
        {error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {message}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Creating account…" : "Sign up"}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-500">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-[var(--primary)]">
          Sign in
        </Link>
      </p>
    </div>
  );
}
