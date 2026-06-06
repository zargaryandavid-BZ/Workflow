"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export function OnboardingForm({ additional = false }: { additional?: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await fetch("/api/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const json = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(json.error ?? "Something went wrong");
      return;
    }
    router.push("/board");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <Label htmlFor="name">Workspace name</Label>
        <Input
          id="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Acme Print Co."
        />
      </div>
      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}
      <div className={additional ? "flex gap-2" : undefined}>
        {additional ? (
          <Button
            type="button"
            variant="secondary"
            className="flex-1"
            disabled={loading}
            onClick={() => router.push("/board")}
          >
            Cancel
          </Button>
        ) : null}
        <Button
          type="submit"
          className={additional ? "flex-1" : "w-full"}
          disabled={loading}
        >
          {loading ? "Creating…" : "Create workspace"}
        </Button>
      </div>
    </form>
  );
}
