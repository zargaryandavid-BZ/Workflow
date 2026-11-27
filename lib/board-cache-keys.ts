/**
 * Shared cache keys for the board's per-card Drive answers (picture, PDF check,
 * Drive status). v2 = stale-while-revalidate entries (lib/cache swrGet/swrSet).
 * Kept in one place so a Drive refresh clears exactly the keys the routes use.
 */
export const pdfCheckRespKey = (tenantId: string, orderId: string) =>
  `wf:pdf-check-resp:v2:${tenantId}:${orderId}`;

export const cardImageRespKey = (tenantId: string, orderId: string) =>
  `wf:card-image-resp:v2:${tenantId}:${orderId}`;

export const cardImageMissKey = (tenantId: string, orderId: string) =>
  `wf:card-image-miss:v1:${tenantId}:${orderId}`;

export const driveStatusKey = (tenantId: string, orderId: string) =>
  `wf:gdrive-status:v2:${tenantId}:${orderId}`;
