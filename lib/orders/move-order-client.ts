import {
  missingFieldsFromLabels,
  type MissingField,
} from "@/lib/orders/validate-ready-to-move";

export type MoveOrderResult =
  | { ok: true }
  | {
      ok: false;
      status: number;
      error?: string;
      missingFields?: MissingField[];
    };

export async function requestOrderMove(body: {
  orderId: string;
  toColumnId: string;
  position?: number;
}): Promise<MoveOrderResult> {
  const res = await fetch("/api/orders/move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (res.ok) return { ok: true };

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
