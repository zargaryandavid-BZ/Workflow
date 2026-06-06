"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app error]", error);
  }, [error]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <h2 className="text-lg font-semibold text-slate-800">
        Something went wrong
      </h2>
      <p className="max-w-md text-sm text-slate-600">
        The page hit an error. This is usually temporary — try reloading. If it
        keeps happening, restart the dev server with{" "}
        <code className="rounded bg-slate-100 px-1">npm run dev</code>.
      </p>
      <div className="flex gap-2">
        <Button type="button" onClick={() => reset()}>
          Try again
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => window.location.reload()}
        >
          Reload page
        </Button>
      </div>
    </div>
  );
}
