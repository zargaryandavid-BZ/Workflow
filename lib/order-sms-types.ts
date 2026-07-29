export type SmsDirection = "outbound" | "inbound";

export type OrderSmsMessage = {
  id: string;
  tenant_id: string;
  order_id: string;
  direction: SmsDirection;
  phone: string;
  body: string;
  twilio_sid: string | null;
  actor_user_id: string | null;
  actor_name?: string | null;
  created_at: string;
};
