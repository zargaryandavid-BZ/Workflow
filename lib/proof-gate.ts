import "server-only";

/**
 * Beta flag for "hold the customer approval link until the proof is ready".
 *
 * OFF by default — approval emails/SMS go out immediately as before. Turn it on
 * per tenant with the env var PROOF_GATE_SEND_TENANTS: a comma-separated list of
 * tenant ids, or the literal "all" to enable for every tenant. This keeps the
 * live send path untouched until a tenant is explicitly opted in.
 */
export function isProofGateSendTenant(tenantId: string | null | undefined): boolean {
  const raw = process.env.PROOF_GATE_SEND_TENANTS?.trim();
  if (!raw || !tenantId) return false;
  if (raw.toLowerCase() === "all") return true;
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.includes(tenantId);
}
