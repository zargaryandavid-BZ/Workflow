/**
 * CRM webhook v2 alias — same handler as POST /api/webhook/orders.
 * Routes schema_version === 2 to the v2 snapshot receiver; all other payloads
 * keep the existing v1 parser.
 */
export { POST } from "@/app/api/webhook/orders/route";
