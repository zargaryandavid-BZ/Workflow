const SENSITIVE_KEYS = ["key", "secret", "token", "password", "api"];

export function isRedactedValue(value: unknown): boolean {
  return value === "[REDACTED]";
}

export function sanitizeConfigObject(
  config: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(config ?? {}).map(([k, v]) =>
      SENSITIVE_KEYS.some((s) => k.toLowerCase().includes(s))
        ? [k, "[REDACTED]"]
        : [k, v]
    )
  );
}

export function stripRedactedValues(
  config: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(config ?? {}).filter(([, v]) => !isRedactedValue(v))
  );
}
