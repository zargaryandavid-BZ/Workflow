import {
  missingFieldsFromLabels,
  type MissingField,
} from "@/lib/orders/validate-ready-to-move";
import { maybeSaveArtworkOnLeaveStart } from "@/lib/orders/save-order-artwork-client";
import { refreshGdriveFolderHasFiles } from "@/lib/use-gdrive-folder-has-files";
import type { BoardColumn } from "@/lib/types";

export type MoveOrderResult =
  | { ok: true }
  | {
      ok: false;
      status: number;
      error?: string;
      missingFields?: MissingField[];
    };

export async function requestOrderMove(
  body: {
    orderId: string;
    toColumnId: string;
    position?: number;
  },
  options?: {
    fromColumnId?: string | null;
    columns?: BoardColumn[];
  }
): Promise<MoveOrderResult> {
  const res = await fetch("/api/orders/move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (res.ok) {
    if (options?.columns?.length && options.fromColumnId) {
      maybeSaveArtworkOnLeaveStart({
        orderId: body.orderId,
        fromColumnId: options.fromColumnId,
        columns: options.columns,
      });
    }
    // Re-check Final production Drive folder so green order # stays current.
    // Defer so the move UI stays snappy (Drive is ~1–3s).
    const deferGreenCheck = () => {
      void refreshGdriveFolderHasFiles(body.orderId);
    };
    const ric = (
      window as Window & {
        requestIdleCallback?: (
          cb: () => void,
          opts?: { timeout?: number }
        ) => number;
      }
    ).requestIdleCallback;
    if (typeof ric === "function") {
      ric(deferGreenCheck, { timeout: 4000 });
    } else {
      window.setTimeout(deferGreenCheck, 1500);
    }
    return { ok: true };
  }

  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    missing_fields?: string[];
  };

  if (res.status === 422 && json.missing_fields?.length) {
    return {
      ok: false,
      status: res.status,
      error: json.error,
      missingFields: missingFieldsFromLabels(json.missing_fields),
    };
  }

  return {
    ok: false,
    status: res.status,
    error: json.error ?? "Move was rejected.",
  };
}
