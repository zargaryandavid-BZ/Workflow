import { createRequire } from "node:module";
import { orderNumberQrPng } from "./order-qr.ts";
import { pdfWinAnsiText } from "./pdf-winansi-text.ts";
import type { ThermalSlipBox, ThermalSlipSku } from "./packing-slip-thermal-pdf.ts";

const require = createRequire(import.meta.url);
const PDFDocument = require("pdfkit") as typeof import("pdfkit");

type PdfDoc = InstanceType<typeof PDFDocument>;

/**
 * Letter-size customer packing slip built from the SAME box data the 4×6 box
 * slips use (boxes → SKU lines with in-box qty and the ordered qty they came
 * from). One clean page: who/where, every item ordered vs shipped, then what
 * is in each box. No prices.
 */

const PAGE_W = 612;
const PAGE_H = 792;
const M = 40;
const W = PAGE_W - M * 2;

export type SummarySlipAddress = {
  name?: string | null;
  company?: string | null;
  lines: string[];
};

export type SummarySlipInput = {
  orderLabel: string;
  customerName: string;
  poNumber?: string | null;
  /** "From" block, e.g. Bazaar Printing · Boyd St. Omit for blind slips. */
  shipFrom?: SummarySlipAddress | null;
  shipTo?: SummarySlipAddress | null;
  /** "FedEx Ground", "Customer pickup", "Customer's own label"… */
  shipVia?: string | null;
  trackingNumbers?: string[];
  skus: ThermalSlipSku[];
  boxes: ThermalSlipBox[];
  /** Ordered qty per SKU when not carried on box lines (`fromQty`). */
  orderedBySku?: Record<string, number>;
  /** Hide shipper name/branding (broker / blind ship). */
  blind?: boolean;
  shippedAt?: Date;
  notes?: string | null;
};

export type SummarySlipRow = {
  number: number;
  skuId: string;
  name: string;
  ordered: number | null;
  shipped: number;
  /** ordered − shipped when ordered is known; negative = overrun. */
  remaining: number | null;
  boxes: number[];
};

/**
 * One row per SKU: ordered vs shipped and which boxes it is in. SKUs that
 * share a printed number (alias ids for PDF pages) are merged into one row.
 */
export function summarySlipRows(
  skus: ThermalSlipSku[],
  boxes: ThermalSlipBox[],
  orderedBySku: Record<string, number> = {}
): SummarySlipRow[] {
  type Acc = { number: number; skuId: string; name: string; ordered: number | null; shipped: number; boxes: Set<number> };
  const keyById = new Map<string, string>();
  const rows = new Map<string, Acc>();
  skus.forEach((sku, i) => {
    const number = sku.number ?? i + 1;
    const key = `n${number}`;
    keyById.set(sku.id, key);
    if (!rows.has(key)) {
      rows.set(key, { number, skuId: sku.id, name: sku.name?.trim() || sku.id, ordered: null, shipped: 0, boxes: new Set() });
    }
    const given = orderedBySku[sku.id];
    if (given != null && Number.isFinite(given) && given > 0) {
      const row = rows.get(key)!;
      row.ordered = Math.max(row.ordered ?? 0, given);
    }
  });
  for (const box of boxes) {
    for (const line of box.lines) {
      if (!(line.qty > 0)) continue;
      let key = keyById.get(line.skuId);
      if (!key) {
        key = `id:${line.skuId}`;
        keyById.set(line.skuId, key);
        rows.set(key, { number: rows.size + 1, skuId: line.skuId, name: line.skuId, ordered: null, shipped: 0, boxes: new Set() });
      }
      const row = rows.get(key)!;
      row.shipped += line.qty;
      row.boxes.add(box.boxNumber);
      if (line.fromQty != null && Number.isFinite(line.fromQty) && line.fromQty > 0 && orderedBySku[line.skuId] == null) {
        row.ordered = Math.max(row.ordered ?? 0, line.fromQty);
      }
    }
  }
  return [...rows.values()]
    .sort((a, b) => a.number - b.number)
    .map((r) => ({
      number: r.number,
      skuId: r.skuId,
      name: r.name,
      ordered: r.ordered,
      shipped: r.shipped,
      remaining: r.ordered == null ? null : r.ordered - r.shipped,
      boxes: [...r.boxes].sort((a, b) => a - b),
    }));
}

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US");
}

/** "1, 2, 3, 5" → "1–3, 5" */
export function boxRangeLabel(nums: number[]): string {
  if (nums.length === 0) return "—";
  const out: string[] = [];
  let start = nums[0]!;
  let prev = start;
  for (const n of [...nums.slice(1), Number.NaN]) {
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    out.push(start === prev ? String(start) : `${start}–${prev}`);
    start = n;
    prev = n;
  }
  return out.join(", ");
}

function remainingLabel(row: SummarySlipRow): string {
  if (row.remaining == null) return "—";
  if (row.remaining === 0) return "Complete";
  if (row.remaining > 0) return `${fmt(row.remaining)} to follow`;
  return `+${fmt(-row.remaining)} over`;
}

function t(s: string | null | undefined): string {
  return pdfWinAnsiText(s ?? "");
}

function dateLabel(d: Date): string {
  return d.toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function addressBlock(doc: PdfDoc, title: string, a: SummarySlipAddress, x: number, y: number, w: number): number {
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#6b7280").text(title.toUpperCase(), x, y, { width: w, characterSpacing: 0.6 });
  let yy = y + 12;
  doc.fillColor("#111827");
  const head = [a.company, a.name].map((v) => v?.trim()).filter(Boolean) as string[];
  for (const [i, line] of head.entries()) {
    doc.font(i === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(10).text(t(line), x, yy, { width: w });
    yy = doc.y + 1;
  }
  doc.font("Helvetica").fontSize(9.5);
  for (const line of a.lines.filter((l) => l.trim())) {
    doc.text(t(line), x, yy, { width: w });
    yy = doc.y + 1;
  }
  return yy;
}

function tableHeader(doc: PdfDoc, y: number, cols: { label: string; x: number; w: number; align?: "left" | "right" | "center" }[]) {
  doc.rect(M, y, W, 18).fill("#111827");
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#ffffff");
  for (const c of cols) doc.text(c.label, c.x, y + 5.5, { width: c.w, align: c.align ?? "left", lineBreak: false });
  doc.fillColor("#111827");
  return y + 18;
}

export async function generateSummaryPackingSlipPdf(input: SummarySlipInput): Promise<Buffer> {
  const rows = summarySlipRows(input.skus, input.boxes, input.orderedBySku);
  const boxes = [...input.boxes].sort((a, b) => a.boxNumber - b.boxNumber);
  const shippedAt = input.shippedAt ?? new Date();
  const qr = input.orderLabel ? await orderNumberQrPng(input.orderLabel) : null;

  const doc = new PDFDocument({ size: "LETTER", margins: { top: M, bottom: M, left: M, right: M } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res, rej) => {
    doc.on("end", () => res(Buffer.concat(chunks)));
    doc.on("error", rej);
  });

  const bottom = PAGE_H - M - 70; // keep room for the sign-off block
  const ensure = (y: number, need: number): number => {
    if (y + need <= bottom) return y;
    doc.addPage();
    doc.font("Helvetica").fontSize(8).fillColor("#6b7280").text(`Packing slip · ${t(input.orderLabel)} (continued)`, M, M);
    return M + 18;
  };

  // ── Header ───────────────────────────────────────────────
  doc.font("Helvetica-Bold").fontSize(22).fillColor("#111827").text("PACKING SLIP", M, M);
  doc.font("Helvetica").fontSize(9).fillColor("#6b7280");
  if (!input.blind) doc.text("Bazaar Printing", M, M + 26);
  const metaX = M + 250;
  const meta: [string, string][] = [
    ["Order", input.orderLabel],
    ...(input.poNumber?.trim() ? [["PO", input.poNumber.trim()] as [string, string]] : []),
    ["Date", dateLabel(shippedAt)],
    ["Ship via", input.shipVia?.trim() || "—"],
    ["Boxes", String(boxes.length)],
  ];
  let my = M + 2;
  for (const [k, v] of meta) {
    doc.font("Helvetica").fontSize(8).fillColor("#6b7280").text(k.toUpperCase(), metaX, my, { width: 60, characterSpacing: 0.4 });
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#111827").text(t(v), metaX + 62, my - 1.5, { width: 140, lineBreak: false, ellipsis: true });
    my += 15;
  }
  if (qr) doc.image(qr, PAGE_W - M - 64, M, { width: 64, height: 64 });
  let y = Math.max(my, M + 70) + 8;
  doc.moveTo(M, y).lineTo(M + W, y).strokeColor("#111827").lineWidth(1.2).stroke();
  y += 12;

  // ── Addresses ────────────────────────────────────────────
  const colW = (W - 20) / 2;
  const shipTo: SummarySlipAddress = input.shipTo ?? { company: input.customerName, lines: [] };
  const yTo = addressBlock(doc, "Ship to", shipTo, M, y, colW);
  const yFrom = input.shipFrom && !input.blind ? addressBlock(doc, "Ship from", input.shipFrom, M + colW + 20, y, colW) : y;
  y = Math.max(yTo, yFrom) + 6;
  if (input.trackingNumbers?.length) {
    doc.font("Helvetica").fontSize(8.5).fillColor("#374151").text(`Tracking: ${input.trackingNumbers.map(t).join(", ")}`, M, y, { width: W });
    y = doc.y + 6;
  }
  y += 6;

  // ── Items: ordered vs shipped ────────────────────────────
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827").text("Items", M, y);
  y = doc.y + 4;
  const ic = [
    { label: "#", x: M + 6, w: 18 },
    { label: "ITEM", x: M + 26, w: 220 },
    { label: "ORDERED", x: M + 250, w: 60, align: "right" as const },
    { label: "SHIPPED", x: M + 316, w: 60, align: "right" as const },
    { label: "STATUS", x: M + 386, w: 76 },
    { label: "BOXES", x: M + 462, w: 70 },
  ];
  y = tableHeader(doc, y, ic);
  rows.forEach((r, i) => {
    doc.font("Helvetica").fontSize(9.5);
    const nameH = doc.heightOfString(t(r.name), { width: ic[1]!.w });
    const h = Math.max(20, nameH + 9);
    y = ensure(y, h);
    if (i % 2 === 1) doc.rect(M, y, W, h).fill("#f3f4f6");
    doc.fillColor("#111827").font("Helvetica").fontSize(9.5);
    doc.text(String(r.number), ic[0]!.x, y + 5, { width: ic[0]!.w });
    doc.text(t(r.name), ic[1]!.x, y + 5, { width: ic[1]!.w });
    doc.text(fmt(r.ordered), ic[2]!.x, y + 5, { width: ic[2]!.w, align: "right" });
    doc.font("Helvetica-Bold").text(fmt(r.shipped), ic[3]!.x, y + 5, { width: ic[3]!.w, align: "right" });
    const st = remainingLabel(r);
    doc.font(st === "Complete" ? "Helvetica" : "Helvetica-Bold").fillColor(st === "Complete" ? "#047857" : "#b45309").text(st, ic[4]!.x, y + 5, { width: ic[4]!.w });
    doc.font("Helvetica").fillColor("#111827").text(boxRangeLabel(r.boxes), ic[5]!.x, y + 5, { width: ic[5]!.w });
    y += h;
  });
  const totOrdered = rows.every((r) => r.ordered != null) ? rows.reduce((s, r) => s + (r.ordered ?? 0), 0) : null;
  const totShipped = rows.reduce((s, r) => s + r.shipped, 0);
  doc.moveTo(M, y).lineTo(M + W, y).strokeColor("#111827").lineWidth(0.8).stroke();
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#111827");
  doc.text("Total", ic[1]!.x, y + 5, { width: ic[1]!.w });
  doc.text(fmt(totOrdered), ic[2]!.x, y + 5, { width: ic[2]!.w, align: "right" });
  doc.text(fmt(totShipped), ic[3]!.x, y + 5, { width: ic[3]!.w, align: "right" });
  doc.text(`${boxes.length} box${boxes.length === 1 ? "" : "es"}`, ic[5]!.x, y + 5, { width: ic[5]!.w });
  y += 26;

  // ── Box contents ─────────────────────────────────────────
  const rowByNumber = new Map(rows.map((r) => [r.number, r]));
  const nameById = new Map<string, SummarySlipRow>();
  input.skus.forEach((sku, i) => {
    const row = rowByNumber.get(sku.number ?? i + 1);
    if (row) nameById.set(sku.id, row);
  });
  for (const r of rows) if (!nameById.has(r.skuId)) nameById.set(r.skuId, r);
  y = ensure(y, 60);
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827").text("What's in each box", M, y);
  y = doc.y + 4;
  const bc = [
    { label: "BOX", x: M + 6, w: 50 },
    { label: "SIZE / WEIGHT", x: M + 58, w: 110 },
    { label: "CONTENTS", x: M + 172, w: 360 },
  ];
  y = tableHeader(doc, y, bc);
  boxes.forEach((box, i) => {
    const lines = box.lines.filter((l) => l.qty > 0).map((l) => {
      const r = nameById.get(l.skuId);
      return `#${r?.number ?? "?"} ${r?.name ?? l.skuId}: ${fmt(l.qty)} pcs`;
    });
    const content = lines.length ? lines.join("\n") : "Empty";
    doc.font("Helvetica").fontSize(9);
    const h = Math.max(20, doc.heightOfString(t(content), { width: bc[2]!.w }) + 9);
    y = ensure(y, h);
    if (i % 2 === 1) doc.rect(M, y, W, h).fill("#f3f4f6");
    doc.fillColor("#111827").font("Helvetica-Bold").fontSize(9.5).text(`${box.boxNumber} of ${boxes.length}`, bc[0]!.x, y + 5, { width: bc[0]!.w });
    const sw = [box.sizeLabel?.trim(), box.weightLbs ? `${box.weightLbs} lb` : ""].filter(Boolean).join(" · ") || "—";
    doc.font("Helvetica").fontSize(9).text(t(sw), bc[1]!.x, y + 5, { width: bc[1]!.w });
    doc.text(t(content), bc[2]!.x, y + 5, { width: bc[2]!.w });
    y += h;
  });

  if (input.notes?.trim()) {
    y = ensure(y + 12, 40);
    doc.font("Helvetica-Bold").fontSize(9).text("Notes", M, y + 12);
    doc.font("Helvetica").fontSize(9).text(t(input.notes.trim()), M, doc.y + 2, { width: W });
  }

  // ── Sign-off (last page) ─────────────────────────────────
  const sy = PAGE_H - M - 54;
  doc.font("Helvetica").fontSize(8.5).fillColor("#374151");
  const fields = ["Packed by", "Checked by", "Received by (print & sign)"];
  const fw = (W - 40) / 3;
  fields.forEach((f, i) => {
    const x = M + i * (fw + 20);
    doc.moveTo(x, sy + 24).lineTo(x + fw, sy + 24).strokeColor("#9ca3af").lineWidth(0.6).stroke();
    doc.text(f, x, sy + 28, { width: fw });
  });
  doc.fontSize(7.5).fillColor("#6b7280").text(
    "Please count your boxes on arrival and report any shortage or damage within 3 business days.",
    M, sy + 44, { width: W, align: "center" }
  );

  doc.end();
  return done;
}
