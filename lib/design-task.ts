/** Designer folder lives on `specs.design_task` and must be an http(s) URL. */

export function isDesignTaskUrl(value: unknown): boolean {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

/**
 * Keep an existing Designer folder URL when a specs patch would blank it or
 * replace it with CRM notes. A new http(s) URL is allowed through.
 */
export function preserveDesignTaskUrl(
  existing: Record<string, unknown>,
  next: Record<string, unknown>
): Record<string, unknown> {
  const prev =
    typeof existing.design_task === "string" ? existing.design_task.trim() : "";
  const incomingRaw = next.design_task;
  const incoming =
    incomingRaw == null ? "" : String(incomingRaw).trim();
  if (isDesignTaskUrl(prev) && !isDesignTaskUrl(incoming)) {
    return { ...next, design_task: prev };
  }
  return next;
}
