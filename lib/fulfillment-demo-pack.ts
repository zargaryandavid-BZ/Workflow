export interface FulfillmentDemoRow {
  id: string;
  number: string;
  qty: number;
}

function padDemoBoxNumber(n: number): string {
  return String(n).padStart(2, "0");
}

/** How many sample columns Send shows when fewer real open boxes exist. */
export const FULFILLMENT_DEMO_OPEN_BOX_COUNT = 8;

const PREVIEW_OPEN_PREFIX = "__open-preview-";
const PREVIEW_SENT_PREFIX = "__sent-preview-";
const PREVIEW_RECV_PREFIX = "__recv-preview-";

/** Local-only sample jobs so Send/Received can be previewed while testing. */
export const FULFILLMENT_DEMO_PACKS: Omit<FulfillmentDemoRow, "id">[][] = [
  [
    { number: "15118-2", qty: 250 },
    { number: "15120-1", qty: 1000 },
    { number: "15122-1", qty: 500 },
    { number: "15124-3", qty: 125 },
    { number: "15131-1", qty: 2000 },
    { number: "15140-2", qty: 50 },
    { number: "15141-1", qty: 750 },
    { number: "15155-1", qty: 300 },
  ],
  [
    { number: "14802-1", qty: 500 },
    { number: "14811-2", qty: 250 },
    { number: "14818-1", qty: 1000 },
    { number: "14901-1", qty: 80 },
    { number: "14922-4", qty: 1500 },
    { number: "14930-1", qty: 400 },
    { number: "15002-1", qty: 25 },
  ],
  [
    { number: "15201-1", qty: 100 },
    { number: "15208-2", qty: 250 },
    { number: "15210-1", qty: 600 },
    { number: "15219-1", qty: 1200 },
    { number: "15224-1", qty: 350 },
    { number: "15230-3", qty: 90 },
    { number: "15233-1", qty: 2000 },
    { number: "15240-1", qty: 175 },
    { number: "15244-2", qty: 40 },
  ],
  [
    { number: "15302-1", qty: 400 },
    { number: "15308-2", qty: 125 },
    { number: "15311-1", qty: 800 },
    { number: "15318-3", qty: 60 },
    { number: "15322-1", qty: 1500 },
    { number: "15330-1", qty: 250 },
    { number: "15341-2", qty: 90 },
  ],
  [
    { number: "15401-1", qty: 200 },
    { number: "15406-2", qty: 750 },
    { number: "15412-1", qty: 1100 },
    { number: "15419-4", qty: 45 },
    { number: "15425-1", qty: 300 },
    { number: "15433-2", qty: 1800 },
    { number: "15440-1", qty: 70 },
    { number: "15448-1", qty: 500 },
  ],
  [
    { number: "15502-2", qty: 150 },
    { number: "15509-1", qty: 900 },
    { number: "15514-3", qty: 320 },
    { number: "15521-1", qty: 60 },
    { number: "15528-2", qty: 2400 },
    { number: "15535-1", qty: 175 },
  ],
  [
    { number: "15601-1", qty: 80 },
    { number: "15607-2", qty: 450 },
    { number: "15613-1", qty: 1200 },
    { number: "15620-1", qty: 35 },
    { number: "15626-3", qty: 600 },
    { number: "15632-1", qty: 250 },
    { number: "15639-2", qty: 1000 },
    { number: "15644-1", qty: 125 },
  ],
  [
    { number: "15703-1", qty: 550 },
    { number: "15710-2", qty: 200 },
    { number: "15716-1", qty: 1400 },
    { number: "15723-4", qty: 90 },
    { number: "15729-1", qty: 75 },
    { number: "15736-2", qty: 1800 },
    { number: "15742-1", qty: 300 },
  ],
];

export type FulfillmentDemoOpenBox = {
  id: string;
  box_number: string;
  status: "open";
  order_count: number;
  created_at: string;
  sent_at: null;
};

export function isFulfillmentPreviewBoxId(id: string): boolean {
  return (
    id.startsWith(PREVIEW_OPEN_PREFIX) ||
    id.startsWith(PREVIEW_SENT_PREFIX) ||
    id.startsWith(PREVIEW_RECV_PREFIX)
  );
}

export type FulfillmentDemoReceiveBox = {
  id: string;
  box_number: string;
  status: "sent" | "received";
  order_count: number;
  created_at: string;
  sent_at: string;
  received_at: string | null;
  receive_status?: "counted" | "missing" | "received";
  receive_comment?: string | null;
};

function daysAgoIso(days: number, now: Date): string {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

/** Cycle counted / missing / received on sample checked-in boxes. */
export function demoReceiveBoxStatus(
  boxIndex: number
): "counted" | "missing" | "received" {
  const kind = boxIndex % 3;
  if (kind === 0) return "counted";
  if (kind === 1) return "missing";
  return "received";
}

export function demoReceiveBoxComment(
  boxIndex: number,
  status: "counted" | "missing" | "received"
): string | null {
  if (status === "missing") {
    return "Short qty on one job — confirm with warehouse.";
  }
  if (status === "counted" && boxIndex % 2 === 0) {
    return "Counted, looks good.";
  }
  return null;
}

/**
 * Sample Received page: 2 incoming boxes + 6 already checked in across
 * three receive days (yesterday, 3 days ago, a week ago).
 */
export function fulfillmentReceivedPreviewBoxes(
  now: Date = new Date()
): FulfillmentDemoReceiveBox[] {
  const created_at = now.toISOString();
  const specs: { daysAgo: number; status: "sent" | "received" }[] = [
    { daysAgo: 0, status: "sent" },
    { daysAgo: 0, status: "sent" },
    { daysAgo: 1, status: "received" },
    { daysAgo: 1, status: "received" },
    { daysAgo: 1, status: "received" },
    { daysAgo: 3, status: "received" },
    { daysAgo: 3, status: "received" },
    { daysAgo: 7, status: "received" },
  ];
  return specs.map((spec, i) => {
    const n = i + 1;
    const box_number = padDemoBoxNumber(n);
    const at = daysAgoIso(spec.daysAgo, now);
    const pack = FULFILLMENT_DEMO_PACKS[i % FULFILLMENT_DEMO_PACKS.length];
    const received = spec.status === "received";
    const boxStatus = demoReceiveBoxStatus(i);
    return {
      id: `${received ? PREVIEW_RECV_PREFIX : PREVIEW_SENT_PREFIX}${box_number}`,
      box_number,
      status: spec.status,
      order_count: pack.length,
      created_at,
      sent_at: at,
      received_at: received ? at : null,
      receive_status: received ? boxStatus : undefined,
      receive_comment: received ? demoReceiveBoxComment(i, boxStatus) : null,
    };
  });
}

/** Keep real boxes; add sample incoming and checked-in columns for layout. */
export function padFulfillmentReceiveDemoBoxes<
  T extends { id: string; status: string },
>(list: T[]): (T | FulfillmentDemoReceiveBox)[] {
  const preview = fulfillmentReceivedPreviewBoxes();
  const sentNeed = Math.max(
    0,
    2 - list.filter((b) => b.status === "sent").length
  );
  const recvNeed = Math.max(
    0,
    6 - list.filter((b) => b.status === "received").length
  );
  const extraSent = preview
    .filter((b) => b.status === "sent")
    .slice(0, sentNeed);
  const extraRecv = preview
    .filter((b) => b.status === "received")
    .slice(0, recvNeed);
  if (extraSent.length === 0 && extraRecv.length === 0) return list;
  return [...list, ...extraSent, ...extraRecv];
}

/** Qty variation on sample lines (box status is separate). */
export function demoReceiveLineStatus(lineIndex: number): {
  receive_status: "counted" | "missing" | "received";
  quantity_received: (expected: number) => number;
} {
  const kind = lineIndex % 3;
  if (kind === 0) {
    return {
      receive_status: "counted",
      quantity_received: (expected) => expected,
    };
  }
  if (kind === 1) {
    return {
      receive_status: "missing",
      quantity_received: (expected) => Math.max(0, expected - 25),
    };
  }
  return {
    receive_status: "received",
    quantity_received: (expected) => expected,
  };
}

/** Sample columns only when there are no real open boxes (layout preview). */
export function padFulfillmentOpenDemoBoxes<
  T extends { id: string; box_number: string },
>(open: T[]): (T | FulfillmentDemoOpenBox)[] {
  if (open.length > 0) return open;
  const created_at = new Date().toISOString();
  const pads: FulfillmentDemoOpenBox[] = [];
  for (let i = 0; i < FULFILLMENT_DEMO_OPEN_BOX_COUNT; i++) {
    const n = i + 1;
    const box_number = padDemoBoxNumber(n);
    const pack =
      FULFILLMENT_DEMO_PACKS[i % FULFILLMENT_DEMO_PACKS.length];
    pads.push({
      id: `${PREVIEW_OPEN_PREFIX}${box_number}`,
      box_number,
      status: "open",
      order_count: pack.length,
      created_at,
      sent_at: null,
    });
  }
  return pads;
}

export function fulfillmentDemoPack(
  boxIndex: number,
  boxId: string
): FulfillmentDemoRow[] {
  const pack = FULFILLMENT_DEMO_PACKS[boxIndex % FULFILLMENT_DEMO_PACKS.length];
  return pack.map((row, i) => ({
    ...row,
    id: `demo-${boxId}-${i}-${row.number}`,
  }));
}

function storageKey(boxId: string): string {
  return `fulfillment-demo-pack:${boxId}`;
}

export function saveFulfillmentDemoPack(
  boxId: string,
  rows: FulfillmentDemoRow[]
): void {
  if (typeof window === "undefined" || rows.length === 0) return;
  sessionStorage.setItem(storageKey(boxId), JSON.stringify(rows));
}

export function loadFulfillmentDemoPack(boxId: string): FulfillmentDemoRow[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(storageKey(boxId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row): row is FulfillmentDemoRow =>
        !!row &&
        typeof row === "object" &&
        typeof (row as FulfillmentDemoRow).id === "string" &&
        typeof (row as FulfillmentDemoRow).number === "string" &&
        typeof (row as FulfillmentDemoRow).qty === "number"
    );
  } catch {
    return [];
  }
}

export function isFulfillmentDemoOrderId(orderId: string): boolean {
  return orderId.startsWith("demo-");
}
