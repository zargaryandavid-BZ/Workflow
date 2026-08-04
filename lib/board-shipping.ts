import type {
  FedExRateOption,
  ShippingClientChoice,
  ShippingRequestStatus,
} from "@/lib/types";

export type BoardShippingKind =
  | "awaiting"
  | "payment_pending"
  | "pickup"
  | "delivery"
  | "uber"
  | "curri";

/** Compact label shown on board cards for the latest shipping portal state. */
export interface BoardShippingSign {
  kind: BoardShippingKind;
  choice: ShippingClientChoice | null;
  /** Short chip text, e.g. Pickup, Overnight, 2Day, Ground, Delivery */
  label: string;
  /** Full tooltip, e.g. FedEx Standard Overnight */
  title: string;
}

const OVERNIGHT_TYPES = new Set([
  "STANDARD_OVERNIGHT",
  "PRIORITY_OVERNIGHT",
  "FIRST_OVERNIGHT",
]);

const SHORT_LABELS: Record<string, string> = {
  STANDARD_OVERNIGHT: "Overnight",
  PRIORITY_OVERNIGHT: "Overnight",
  FIRST_OVERNIGHT: "Overnight",
  FEDEX_2_DAY: "2Day",
  FEDEX_2_DAY_AM: "2Day",
  FEDEX_GROUND: "Ground",
  GROUND_HOME_DELIVERY: "Ground",
  FEDEX_EXPRESS_SAVER: "Express",
  INTERNATIONAL_ECONOMY: "Intl Econ",
  INTERNATIONAL_PRIORITY: "Intl Priority",
};

function shortDeliveryLabel(
  fedex: FedExRateOption | null | undefined
): { label: string; title: string } {
  const serviceType = fedex?.serviceType?.trim() || "";
  const serviceName = fedex?.serviceName?.trim() || "";
  const title = serviceName || serviceType || "Shipping";

  const formatShortDate = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "2-digit" });

  // Prefer estimated delivery date over "2Day" / transit-style chips.
  const deliveryDate = fedex?.deliveryDate?.trim();
  if (deliveryDate) {
    try {
      const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(deliveryDate);
      const d = dateOnly
        ? new Date(
            Number(dateOnly[1]),
            Number(dateOnly[2]) - 1,
            Number(dateOnly[3])
          )
        : new Date(deliveryDate);
      if (!Number.isNaN(d.getTime())) {
        return { label: formatShortDate(d), title };
      }
    } catch {
      /* fall through */
    }
  }

  // Estimate from service type when FedEx didn't return a date (e.g. older quotes).
  const svc = serviceType.toUpperCase();
  let businessDays: number | null = null;
  if (
    svc.includes("FIRST_OVERNIGHT") ||
    svc.includes("PRIORITY_OVERNIGHT") ||
    svc.includes("STANDARD_OVERNIGHT")
  ) {
    businessDays = 1;
  } else if (svc.includes("2_DAY") || svc.includes("2DAY")) {
    businessDays = 2;
  } else if (svc.includes("EXPRESS_SAVER")) {
    businessDays = 3;
  }
  if (businessDays != null) {
    const d = new Date();
    let added = 0;
    while (added < businessDays) {
      d.setDate(d.getDate() + 1);
      const day = d.getDay();
      if (day !== 0 && day !== 6) added += 1;
    }
    return { label: formatShortDate(d), title };
  }

  if (serviceType && SHORT_LABELS[serviceType]) {
    return { label: SHORT_LABELS[serviceType], title };
  }
  if (/overnight/i.test(serviceName) || OVERNIGHT_TYPES.has(serviceType)) {
    return { label: "Overnight", title };
  }
  if (serviceName) {
    const compact = serviceName.replace(/^FedEx\s+/i, "").trim();
    if (compact && compact.length <= 14) {
      return { label: compact, title };
    }
  }
  return { label: "Shipping", title };
}

export function boardShippingSignFromRequest(row: {
  status: ShippingRequestStatus;
  client_choice: ShippingClientChoice | null;
  fedex_selection?: FedExRateOption | null;
}): BoardShippingSign | null {
  if (row.status === "pending") {
    return {
      kind: "awaiting",
      choice: null,
      label: "Awaiting",
      title: "Shipment link sent — waiting for client",
    };
  }

  if (row.status === "payment_pending") {
    return {
      kind: "payment_pending",
      choice: "delivery",
      label: "Waiting",
      title: "Client started checkout — not paid yet",
    };
  }

  if (row.client_choice === "pickup") {
    return {
      kind: "pickup",
      choice: "pickup",
      label: "Pickup",
      title: "Client chose self pickup",
    };
  }
  if (row.client_choice === "delivery") {
    if (row.fedex_selection?.provider === "curri") {
      const name =
        row.fedex_selection.serviceName?.trim() || "Curri";
      return {
        kind: "curri",
        choice: "delivery",
        label: "Curri",
        title: `Client chose Curri · ${name}`,
      };
    }
    const { label, title } = shortDeliveryLabel(row.fedex_selection);
    return {
      kind: "delivery",
      choice: "delivery",
      label,
      title: `Client chose shipping · ${title}`,
    };
  }
  if (row.client_choice === "uber") {
    return {
      kind: "uber",
      choice: "uber",
      label: "Uber",
      title: "Client chose Uber delivery",
    };
  }
  if (row.client_choice === "curri") {
    const name = row.fedex_selection?.serviceName?.trim() || "Curri";
    return {
      kind: "curri",
      choice: "curri",
      label: "Curri",
      title: `Client chose Curri · ${name}`,
    };
  }
  return null;
}

export function isOvernightShippingSign(sign: BoardShippingSign | null | undefined) {
  if (!sign || sign.kind !== "delivery") return false;
  return /overnight/i.test(sign.label) || /overnight/i.test(sign.title);
}

/** Hex stroke colors — applied inline so they beat the global `* { border-color }` rule. */
export function shippingCardBorderColor(
  sign: BoardShippingSign | null | undefined
): string | null {
  if (!sign) return null;
  if (sign.kind === "awaiting" || sign.kind === "payment_pending") {
    return "#fbbf24"; // amber-400
  }
  if (sign.kind === "pickup") return "#34d399"; // emerald-400
  if (sign.kind === "uber") return "#a78bfa"; // violet-400
  if (sign.kind === "curri") return "#fb923c"; // orange-400
  return "#38bdf8"; // sky-400 — FedEx delivery
}

/** Chip colors for the pickup / delivery type tag. */
export function shippingTagClass(
  sign: BoardShippingSign | null | undefined
): string {
  if (!sign) return "bg-slate-100 text-slate-600";
  if (sign.kind === "awaiting" || sign.kind === "payment_pending") {
    return "bg-amber-50 text-amber-700";
  }
  if (sign.kind === "pickup") return "bg-emerald-50 text-emerald-700";
  if (sign.kind === "uber") return "bg-violet-50 text-violet-700";
  if (sign.kind === "curri") return "bg-orange-50 text-orange-700";
  if (isOvernightShippingSign(sign)) return "bg-red-50 text-red-700";
  return "bg-sky-50 text-sky-700";
}
