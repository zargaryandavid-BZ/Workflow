export const API_TIMEOUT_MS = 10_000;

/** Approval / missing-info send copies proof files then hits Instantly + Twilio. */
export const NOTIFICATION_SEND_TIMEOUT_MS = 30_000;

export function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && /timed out/i.test(err.message);
}

/**
 * fetch() with an AbortController timeout. Rejects with a clear message on abort.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  ms = API_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Request timed out after ${ms / 1000} seconds.`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/** Client-side JSON POST with timeout — keeps UI from hanging on slow sends. */
export async function postJsonWithTimeout<T = unknown>(
  url: string,
  body: unknown,
  ms = API_TIMEOUT_MS
): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    ms
  );
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}
