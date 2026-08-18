"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

/** Recovery / invite tokens that used to land on /login must continue on /set-password. */
function hasPasswordSetupToken() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("code") || params.get("token_hash")) return true;
  const hash = window.location.hash;
  return (
    hash.includes("access_token") &&
    (hash.includes("type=recovery") || hash.includes("type=invite"))
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!hasPasswordSetupToken()) return;
    const qs = window.location.search;
    const hash = window.location.hash;
    router.replace(`/set-password${qs}${hash}`);
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("invalid login") || msg.includes("invalid credentials")) {
        setError(
          "Email or password is incorrect. If you were invited or received a reset email, open that link to set your password — or ask an admin to send a new one."
        );
      } else {
        setError(error.message);
      }
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-slate-800">Welcome back</h1>
      <p className="mb-5 text-sm text-slate-500">
        Sign in to your print production workspace.
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
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
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-400 transition-colors hover:text-slate-600"
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
        {error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-500">
        No account?{" "}
        <Link href="/signup" className="font-medium text-[var(--primary)]">
          Create one
        </Link>
      </p>
    </div>
  );
}
