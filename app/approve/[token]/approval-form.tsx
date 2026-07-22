"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";

export function ApprovalForm({ token }: { token: string }) {
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<null | "approved" | "rejected">(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approved" | "rejected") {
    if (decision === "rejected" && !comment.trim()) {
      setError("Please tell us why the proof was not approved.");
      return;
    }
    setError(null);
    setLoading(true);
    const res = await fetch("/api/approvals/decide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        decision,
        comment: comment.trim() || undefined,
      }),
    });
    const json = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(json.error ?? "Something went wrong");
      return;
    }
    setDone(decision);
  }

  if (done) {
    return (
      <div
        className={
          done === "approved"
            ? "rounded-lg bg-emerald-50 p-4 text-center text-emerald-700"
            : "rounded-lg bg-red-50 p-4 text-center text-red-700"
        }
      >
        <p className="font-semibold capitalize">{done}</p>
        <p className="mt-1 text-sm">Thank you for your response.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-slate-700">
        Please review and respond:
      </p>
      <Textarea
        value={comment}
        onChange={(e) => {
          setComment(e.target.value);
          setError(null);
        }}
        placeholder="Optional note — required if requesting changes"
      />
      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}
      <div className="flex gap-3">
        <Button
          className="flex-1"
          onClick={() => decide("approved")}
          disabled={loading}
        >
          <Check className="h-4 w-4" /> Approve
        </Button>
        <Button
          variant="danger"
          className="flex-1"
          onClick={() => decide("rejected")}
          disabled={loading}
        >
          <X className="h-4 w-4" /> Request changes
        </Button>
      </div>
    </div>
  );
}
