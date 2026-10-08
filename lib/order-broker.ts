import { effectiveWebhookSource } from "@/lib/webhook-source-styles";

/**
 * Broker / partner (white-label portal) order info for the board card.
 *
 * A card is a broker order when its effective webhook source resolves to
 * `portal` — i.e. the webhook arrived with a portal/partner/broker source key,
 * or carries `specs.bazaar_broker_id`, or its order number is `BZ-####`
 * (see {@link effectiveWebhookSource}). Retail website / CRM orders are not.
 *
 * The broker-relevant fields below are read straight from the additive portal
 * specs the webhook already stores — nothing new is written.
 */
export interface BrokerOrderInfo {
  /** True when this card came from the Bazaar partner / broker portal. */
  isBroker: boolean;
  /** Partner / broker company name (`specs.company_name`), when present. */
  company: string | null;
  /** Broker contact who placed the order (`specs.request_owner_name`). */
  contactName: string | null;
  /** Broker contact email (`specs.request_owner_email`). */
  contactEmail: string | null;
  /** Broker contact phone (`specs.request_owner_phone`). */
  contactPhone: string | null;
  /** Opaque broker id (`specs.bazaar_broker_id`). */
  brokerId: string | null;
}

function trimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Resolve broker / partner info for an order card. `isBroker` is the single
 * discriminator used by the board; the rest are surfaced only for broker cards.
 */
export function getBrokerOrderInfo(order: {
  webhook_source?: string | null;
  title?: string | null;
  specs?: Record<string, unknown> | null;
}): BrokerOrderInfo {
  const isBroker = effectiveWebhookSource(order) === "portal";
  const specs = order.specs ?? {};
  return {
    isBroker,
    company: trimmedString(specs.company_name),
    contactName: trimmedString(specs.request_owner_name),
    contactEmail: trimmedString(specs.request_owner_email),
    contactPhone: trimmedString(specs.request_owner_phone),
    brokerId: trimmedString(specs.bazaar_broker_id),
  };
}

/**
 * Tooltip text for the Broker / Partner badge: company first, then contact.
 * Falls back to a generic label when the portal sent no company name.
 */
export function brokerBadgeTitle(info: BrokerOrderInfo): string {
  const parts = ["Broker / Partner portal order"];
  if (info.company) parts.push(info.company);
  if (info.contactName) parts.push(info.contactName);
  return parts.join(" · ");
}
