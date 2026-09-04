import "server-only";

import { existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { OrderExportData } from "@/lib/button-automation-order-data";
import { formatNoteHistoryText } from "@/lib/note-history";
import {
  isRollDirectionFieldName,
  rollDirectionOption,
} from "@/lib/roll-direction";
import { appendPdfDocuments, pdfPageCount } from "@/lib/append-pdf";

const require = createRequire(import.meta.url);
const PDFDocument = require("pdfkit") as typeof import("pdfkit");

type PdfDoc = InstanceType<typeof PDFDocument>;

const MARGIN = 40;
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const COL_WIDTH = (PAGE_WIDTH - MARGIN * 2) / 2;
/** Leave room for footer; never let PDFKit auto-paginate absolute text. */
const CONTENT_BOTTOM = PAGE_HEIGHT - 32;

/** Absolute-positioned text that must not trigger PDFKit page breaks. */
function textAt(
  doc: PdfDoc,
  str: string,
  x: number,
  y: number,
  options: {
    width?: number;
    align?: "left" | "center" | "right" | "justify";
    link?: string;
    underline?: boolean;
  } = {}
) {
  doc.text(str, x, y, { ...options, lineBreak: false });
}

function yesNo(value: string): string {
  const lower = value.trim().toLowerCase();
  if (lower === "yes" || lower === "true") return "Yes";
  if (lower === "no" || lower === "false") return "No";
  return value;
}

const ROLL_DIR_IMG_W = 52;
const ROLL_DIR_IMG_H = 38;

function rollDirectionImagePath(value: string): string | null {
  const opt = rollDirectionOption(value);
  if (!opt) return null;
  const file = join(process.cwd(), "public", opt.src.replace(/^\//, ""));
  return existsSync(file) ? file : null;
}

function fmtQty(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US");
}

function capitalize(s: string): string {
  if (!s) return "—";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * `orders.internal_note` / `specs.production_notes` are stored as JSON history
 * `[{ author, date, text }, …]` (or legacy plain text).
 * Returns clear note text only for PDF display.
 */
function formatInternalNoteText(raw: string | null | undefined): string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) => {
          if (entry && typeof entry === "object" && "text" in entry) {
            const text = (entry as { text?: unknown }).text;
            return typeof text === "string" ? text.trim() : "";
          }
          return typeof entry === "string" ? entry.trim() : "";
        })
        .filter(Boolean)
        .join("\n\n");
    }
    if (parsed && typeof parsed === "object" && "text" in parsed) {
      const text = (parsed as { text?: unknown }).text;
      return typeof text === "string" ? text.trim() : trimmed;
    }
  } catch {
    /* legacy plain text */
  }
  return trimmed;
}

async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return Buffer.from(buf);
  } catch {
    return null;
  }
}

function drawHeader(
  doc: PdfDoc,
  tenantName: string,
  orderNumber: string
) {
  doc.rect(0, 0, PAGE_WIDTH, 44).fill("#1a1a2e");
  doc.fillColor("#ffffff").fontSize(11).font("Helvetica-Bold");
  textAt(doc, tenantName.toUpperCase(), MARGIN, 14);
  doc.fontSize(9).font("Helvetica");
  textAt(doc, "JOB TICKET", PAGE_WIDTH - MARGIN - 60, 14, {
    width: 60,
    align: "right",
  });
  textAt(doc, orderNumber, MARGIN, 28);
  textAt(
    doc,
    new Date().toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    PAGE_WIDTH - MARGIN - 100,
    28,
    { width: 100, align: "right" }
  );
  doc.fillColor("#000000");
}

function drawFooter(doc: PdfDoc, pageNum: number, totalPages: number) {
  doc.fontSize(8).fillColor("#888888");
  textAt(doc, `Page ${pageNum} of ${totalPages}`, MARGIN, PAGE_HEIGHT - 24, {
    width: PAGE_WIDTH - MARGIN * 2,
    align: "center",
  });
  doc.fillColor("#000000");
}

function drawSectionTitle(doc: PdfDoc, title: string, y: number): number {
  doc.rect(MARGIN, y, PAGE_WIDTH - MARGIN * 2, 20).fill("#f3f4f6");
  doc.fillColor("#374151").fontSize(9).font("Helvetica-Bold");
  textAt(doc, title, MARGIN + 6, y + 6, {
    width: PAGE_WIDTH - MARGIN * 2 - 12,
  });
  doc.fillColor("#000000").font("Helvetica");
  return y + 24;
}

type SummaryIcon =
  | "customer"
  | "calendar"
  | "priority"
  | "manager"
  | "designer"
  | "qty";

/** Tiny line icons for the ORDER summary (no external font needed). */
function drawSummaryIcon(
  doc: PdfDoc,
  kind: SummaryIcon,
  x: number,
  y: number,
  color = "#6b7280"
) {
  const s = 8;
  doc.save();
  doc.strokeColor(color).lineWidth(0.9).lineCap("round").lineJoin("round");

  switch (kind) {
    case "customer": {
      // person: head + shoulders
      doc.circle(x + s / 2, y + 2.2, 1.8).stroke();
      doc
        .moveTo(x + 1.2, y + s - 0.5)
        .bezierCurveTo(x + 1.2, y + 4.2, x + s - 1.2, y + 4.2, x + s - 1.2, y + s - 0.5)
        .stroke();
      break;
    }
    case "calendar": {
      doc.roundedRect(x + 0.5, y + 1.5, s - 1, s - 2, 0.8).stroke();
      doc
        .moveTo(x + 0.5, y + 3.6)
        .lineTo(x + s - 0.5, y + 3.6)
        .stroke();
      doc
        .moveTo(x + 2.2, y + 0.6)
        .lineTo(x + 2.2, y + 2.4)
        .stroke();
      doc
        .moveTo(x + s - 2.2, y + 0.6)
        .lineTo(x + s - 2.2, y + 2.4)
        .stroke();
      break;
    }
    case "priority": {
      // flag
      doc
        .moveTo(x + 2, y + 0.5)
        .lineTo(x + 2, y + s - 0.3)
        .stroke();
      doc
        .moveTo(x + 2, y + 0.5)
        .lineTo(x + s - 1, y + 2.4)
        .lineTo(x + 2, y + 4.3)
        .closePath()
        .fillAndStroke(color, color);
      break;
    }
    case "manager": {
      // briefcase
      doc.roundedRect(x + 0.8, y + 2.5, s - 1.6, s - 3.2, 0.6).stroke();
      doc
        .moveTo(x + 2.8, y + 2.5)
        .lineTo(x + 2.8, y + 1.4)
        .lineTo(x + s - 2.8, y + 1.4)
        .lineTo(x + s - 2.8, y + 2.5)
        .stroke();
      doc
        .moveTo(x + 0.8, y + 4.8)
        .lineTo(x + s - 0.8, y + 4.8)
        .stroke();
      break;
    }
    case "designer": {
      // pencil
      doc
        .moveTo(x + 1.2, y + s - 1.5)
        .lineTo(x + s - 2.2, y + 1.8)
        .lineTo(x + s - 1, y + 3)
        .lineTo(x + 2.4, y + s - 0.3)
        .closePath()
        .stroke();
      doc
        .moveTo(x + 1.2, y + s - 1.5)
        .lineTo(x + 0.6, y + s - 0.4)
        .lineTo(x + 2.4, y + s - 0.3)
        .stroke();
      break;
    }
    case "qty": {
      // stacked boxes / hash-like package
      doc.rect(x + 1.2, y + 2.8, 4.2, 4.2).stroke();
      doc.rect(x + 2.8, y + 1.2, 4.2, 4.2).stroke();
      break;
    }
  }

  doc.restore();
}

const SUMMARY_ICONS: Record<string, SummaryIcon> = {
  Customer: "customer",
  "Due Date": "calendar",
  Priority: "priority",
  "Account Manager": "manager",
  Designer: "designer",
  "TTL Qty": "qty",
};

/** Compact label/value cell used by the 2-column order summary block. */
function drawSummaryCell(
  doc: PdfDoc,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number
) {
  const iconKind = SUMMARY_ICONS[label];
  const iconSize = 8;
  const iconGap = 4;
  const gutter = iconKind ? iconSize + iconGap : 0;
  const labelW = 88;
  if (iconKind) {
    drawSummaryIcon(doc, iconKind, x, y + 1);
  }
  const textX = x + gutter;
  doc
    .fontSize(9)
    .font("Helvetica-Bold")
    .fillColor("#6b7280");
  textAt(doc, label, textX, y, { width: labelW });
  doc
    .fontSize(9)
    .font("Helvetica-Bold")
    .fillColor("#111827");
  textAt(doc, value || "—", textX + labelW, y, {
    width: Math.max(0, width - gutter - labelW),
  });
}

/**
 * Split `text` so the first chunk fits in `maxHeight` at the current font.
 * Prefers breaking on whitespace / newlines so words aren't cut mid-glyph.
 */
function splitTextToHeight(
  doc: PdfDoc,
  text: string,
  width: number,
  maxHeight: number
): { fitted: string; rest: string } {
  if (!text) return { fitted: "", rest: "" };
  if (maxHeight < 8) return { fitted: "", rest: text };

  doc.fontSize(10).font("Helvetica");
  if (doc.heightOfString(text, { width }) <= maxHeight) {
    return { fitted: text, rest: "" };
  }

  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (doc.heightOfString(text.slice(0, mid), { width }) <= maxHeight) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  let breakAt = lo;
  if (breakAt < text.length) {
    const window = text.slice(0, breakAt);
    const ws = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(" "));
    // Only pull back to whitespace when we still keep a meaningful chunk.
    if (ws >= Math.min(24, Math.floor(breakAt * 0.5))) {
      breakAt = ws + 1;
    }
  }

  const fitted = text.slice(0, breakAt).trimEnd();
  const rest = text.slice(breakAt).trimStart();
  // Guarantee progress if a single unbreakable run is taller than maxHeight.
  if (!fitted && rest) {
    return { fitted: rest.slice(0, 1), rest: rest.slice(1) };
  }
  return { fitted, rest };
}

type AttentionPageContext = {
  tenantName: string;
  orderNumber: string;
  onNewPage?: () => void;
};

/** ATTENTION blocks (production notes + internal notes), drawn below the specs. */
function drawAttentionBlocks(
  doc: PdfDoc,
  data: OrderExportData,
  startY: number,
  pageCtx?: AttentionPageContext
): number {
  const x = MARGIN;
  const w = PAGE_WIDTH - MARGIN * 2;
  const innerW = w - 24;
  const titleH = 28; // ATTENTION + subtitle
  const minBoxH = 44;
  const bodyPadBottom = 8;
  const bodyTopOffset = 10 + titleH;

  const productionNotesText = formatNoteHistoryText(
    typeof data.order.specs?.production_notes === "string"
      ? data.order.specs.production_notes
      : null
  );
  const internalNotesText = formatInternalNoteText(data.order.internal_note);

  let nextY = startY;

  const startNewPage = () => {
    doc.addPage();
    pageCtx?.onNewPage?.();
    if (pageCtx) {
      drawHeader(doc, pageCtx.tenantName, pageCtx.orderNumber);
    }
    nextY = 56;
  };

  const drawBox = (
    subtitle: string,
    text: string,
    fill: string,
    accent: string,
    titleColor: string
  ) => {
    let remaining = text;
    let continued = false;

    while (remaining) {
      let spaceLeft = CONTENT_BOTTOM - nextY;
      // Not enough room for a notes box — continue on a fresh page with header.
      if (spaceLeft < minBoxH) {
        startNewPage();
        spaceLeft = CONTENT_BOTTOM - nextY;
      }

      const label = continued ? `${subtitle} (continued)` : subtitle;
      const maxBodyH = Math.max(12, spaceLeft - bodyTopOffset - bodyPadBottom);
      const { fitted, rest } = splitTextToHeight(
        doc,
        remaining,
        innerW,
        maxBodyH
      );

      // If nothing fits in the available body height, force a new page.
      if (!fitted && rest) {
        startNewPage();
        continue;
      }

      const bodyH = fitted
        ? doc.fontSize(10).font("Helvetica").heightOfString(fitted, {
            width: innerW,
          })
        : 12;
      const boxH = Math.min(
        spaceLeft,
        bodyTopOffset + bodyH + bodyPadBottom
      );
      const ay = nextY;

      doc.rect(x, ay, w, boxH).fill(fill);
      doc.rect(x, ay, 4, boxH).fill(accent);
      doc.rect(x, ay, w, boxH).strokeColor(accent).lineWidth(1.25).stroke();

      doc.fillColor(titleColor).fontSize(10).font("Helvetica-Bold");
      textAt(doc, "ATTENTION", x + 12, ay + 10, { width: innerW });
      doc.fillColor(titleColor).fontSize(9).font("Helvetica");
      textAt(doc, label, x + 12, ay + 22, { width: innerW });

      const bodyTop = ay + bodyTopOffset;
      doc.fontSize(10).font("Helvetica").fillColor("#111827");
      // lineBreak must stay on for wrapping; height clips without ellipsis so
      // overflow is carried to the next page instead of truncated.
      doc.text(fitted, x + 12, bodyTop, {
        width: innerW,
        height: Math.max(12, boxH - (bodyTop - ay) - bodyPadBottom),
      });

      doc.fillColor("#000000").font("Helvetica");
      nextY = ay + boxH + 8;
      remaining = rest;
      continued = true;

      if (remaining) {
        startNewPage();
      }
    }
  };

  drawBox(
    "production notes",
    productionNotesText,
    "#fff7ed",
    "#ea580c",
    "#9a3412"
  );
  drawBox("internal notes", internalNotesText, "#fef2f2", "#dc2626", "#991b1b");

  return nextY;
}

function drawSpecs(
  doc: PdfDoc,
  data: OrderExportData,
  startY: number,
  pageCtx?: AttentionPageContext
): number {
  const x = MARGIN;
  const w = PAGE_WIDTH - MARGIN * 2;
  const innerX = x + 10;
  const innerW = w - 20;
  const padX = 6;
  const padY = 4;
  const labelW = Math.floor(COL_WIDTH * 0.42);
  const valueW = COL_WIDTH - labelW - padX * 2;

  type SpecCell = {
    label: string;
    value: string;
    link?: string;
    imagePath?: string | null;
  };

  const VALUE_SIZE = 10;
  const LABEL_SIZE = 9;

  const specRows: SpecCell[] = data.specRows.map((row) => {
    const value = yesNo(row.value);
    const imagePath = isRollDirectionFieldName(row.label)
      ? rollDirectionImagePath(row.value)
      : null;
    return {
      label: row.label,
      value,
      imagePath,
    };
  });

  if (data.designTask) {
    specRows.push({
      label: "Designer files",
      value: "Link",
      link: data.designTask,
    });
  }

  if (data.artworkLink) {
    specRows.push({
      label: "Prod ready files",
      value: "Link",
      link: data.artworkLink,
    });
  }

  // No spec table to draw, but notes must still print.
  if (!specRows.length) return drawAttentionBlocks(doc, data, startY, pageCtx);

  const description = data.order.description?.trim() ?? "";

  const headerH = 26;
  const midpoint = Math.ceil(specRows.length / 2);
  const leftSpecs = specRows.slice(0, midpoint);
  const rightSpecs = specRows.slice(midpoint);
  const maxRows = Math.max(leftSpecs.length, rightSpecs.length);

  const cellHeight = (cell: SpecCell | undefined): number => {
    if (!cell) return 0;
    const imgGap = cell.imagePath ? ROLL_DIR_IMG_W + 6 : 0;
    const labelH =
      doc.fontSize(LABEL_SIZE).font("Helvetica-Bold").heightOfString(cell.label, {
        width: labelW,
      }) ?? 0;
    const valueH =
      doc
        .fontSize(VALUE_SIZE)
        .font("Helvetica-Bold")
        .heightOfString(cell.value || "—", { width: Math.max(24, valueW - imgGap) }) ?? 0;
    const contentH = cell.imagePath
      ? Math.max(labelH, valueH, ROLL_DIR_IMG_H)
      : Math.max(labelH, valueH);
    return Math.max(20, contentH + padY * 2);
  };

  // Pre-compute per-row heights based on actual text content
  const rowHeights: number[] = [];
  for (let i = 0; i < maxRows; i++) {
    rowHeights.push(
      Math.max(cellHeight(leftSpecs[i]), cellHeight(rightSpecs[i]), 20)
    );
  }
  const specsH = rowHeights.reduce((s, h) => s + h, 0);

  // Height for order description block (if present)
  let descH = 0;
  if (description) {
    descH = 10; // top divider spacing
    doc.fontSize(10).font("Helvetica");
    const textH = doc.heightOfString(description, { width: innerW - 12 });
    descH += 18 + textH + 4;
  }

  const boxH = headerH + specsH + descH + 10;

  // Highlighted background box (same cream + amber accent)
  doc.rect(x, startY, w, boxH).fill("#fff7ed");
  doc.rect(x, startY, 4, boxH).fill("#f59e0b");
  doc.rect(x, startY, w, boxH).strokeColor("#fcd34d").lineWidth(0.5).stroke();

  // Section title
  doc.fillColor("#92400e").fontSize(9).font("Helvetica-Bold");
  textAt(doc, "PRODUCT SPECIFICATIONS", innerX + 6, startY + 8);
  doc.fillColor("#000000").font("Helvetica");

  const tableX = x + 4;
  const tableW = w - 4;
  const halfW = tableW / 2;
  let y = startY + headerH;

  // Table grid outline
  doc
    .rect(tableX, y, tableW, specsH)
    .strokeColor("#fcd34d")
    .lineWidth(0.6)
    .stroke();
  // Vertical mid divider between left/right columns
  doc
    .moveTo(tableX + halfW, y)
    .lineTo(tableX + halfW, y + specsH)
    .strokeColor("#fcd34d")
    .lineWidth(0.5)
    .stroke();

  const drawCell = (cell: SpecCell | undefined, cellX: number, rowY: number) => {
    if (!cell) return;
    const textY = rowY + padY;
    doc
      .fontSize(LABEL_SIZE)
      .font("Helvetica-Bold")
      .fillColor("#78350f");
    textAt(doc, cell.label, cellX + padX, textY, { width: labelW });
    const valueX = cellX + padX + labelW;
    let valueTextX = valueX;
    let valueTextW = valueW;
    if (cell.imagePath) {
      try {
        doc.image(cell.imagePath, valueX, rowY + Math.max(1, padY - 2), {
          fit: [ROLL_DIR_IMG_W, ROLL_DIR_IMG_H],
          valign: "center",
        });
      } catch {
        /* keep text-only if the diagram cannot be embedded */
      }
      valueTextX = valueX + ROLL_DIR_IMG_W + 6;
      valueTextW = Math.max(24, valueW - ROLL_DIR_IMG_W - 6);
    }
    doc
      .fontSize(VALUE_SIZE)
      .font("Helvetica-Bold")
      .fillColor(cell.link ? "#1d4ed8" : "#111827");
    textAt(doc, cell.value || "—", valueTextX, textY, {
      width: valueTextW,
      ...(cell.link ? { link: cell.link, underline: true } : {}),
    });
  };

  for (let i = 0; i < maxRows; i++) {
    const rowY = y;
    const rowH = rowHeights[i];

    // Horizontal rule under each row (except last — outer border covers it)
    if (i < maxRows - 1) {
      doc
        .moveTo(tableX, rowY + rowH)
        .lineTo(tableX + tableW, rowY + rowH)
        .strokeColor("#fde68a")
        .lineWidth(0.4)
        .stroke();
    }

    drawCell(leftSpecs[i], tableX, rowY);
    drawCell(rightSpecs[i], tableX + halfW, rowY);
    y += rowH;
  }

  if (description) {
    doc
      .moveTo(innerX + 6, y + 2)
      .lineTo(x + w - 10, y + 2)
      .strokeColor("#fcd34d")
      .lineWidth(0.5)
      .stroke();
    y += 10;
    doc.fontSize(9).font("Helvetica-Bold").fillColor("#78350f");
    textAt(doc, "Order Description", innerX + 6, y);
    y += 14;
    doc.fontSize(10).font("Helvetica").fillColor("#111827");
    doc.text(description, innerX + 6, y, {
      width: innerW - 12,
      height: Math.max(12, descH - 28),
      ellipsis: true,
    });
  }

  doc.fillColor("#000000").font("Helvetica");

  return drawAttentionBlocks(doc, data, startY + boxH + 8, pageCtx);
}

function drawDescription(doc: PdfDoc, description: string, startY: number): number {
  const x = MARGIN;
  const w = PAGE_WIDTH - MARGIN * 2;
  const innerX = x + 6;
  const innerW = w - 12;

  const textHeight = doc.heightOfString(description, {
    width: innerW - 8,
  });
  const boxH = 22 + textHeight + 8;

  doc.rect(x, startY, w, boxH).fill("#f0f9ff");
  doc.rect(x, startY, 4, boxH).fill("#0ea5e9");
  doc.rect(x, startY, w, boxH).strokeColor("#bae6fd").lineWidth(0.5).stroke();

  doc
    .fillColor("#0c4a6e")
    .fontSize(8)
    .font("Helvetica-Bold")
    .text("DESCRIPTION / COMMENTS", innerX + 6, startY + 7);

  doc
    .fontSize(8.5)
    .font("Helvetica")
    .fillColor("#111827")
    .text(description, innerX + 6, startY + 22, { width: innerW - 8 });

  doc.fillColor("#000000").font("Helvetica");
  return startY + boxH + 8;
}

function drawPage1(
  doc: PdfDoc,
  data: OrderExportData
): number {
  drawHeader(doc, data.tenantName, data.orderNumberDisplay);

  let y = 56;
  const w = PAGE_WIDTH - MARGIN * 2 - 12;
  let contentPages = 1;

  const ensureSkuSpace = (needed: number) => {
    if (y + needed <= CONTENT_BOTTOM) return;
    doc.addPage();
    contentPages += 1;
    drawHeader(doc, data.tenantName, data.orderNumberDisplay);
    y = 56;
  };

  y = drawSectionTitle(doc, "ORDER", y);
  const x = MARGIN + 6;
  const colW = COL_WIDTH - 6;
  const dueOrProductionLabel =
    data.applicationEnabled && data.productionDateFormatted
      ? "Production Date"
      : "Due Date";
  const dueOrProductionValue =
    data.applicationEnabled && data.productionDateFormatted
      ? data.productionDateFormatted
      : data.dueDateFormatted;
  const leftCol: Array<[string, string]> = [
    ["Customer", data.customerName],
    [dueOrProductionLabel, dueOrProductionValue],
    ["Priority", capitalize(data.priority)],
  ];
  const rightCol: Array<[string, string]> = [
    ["Account Manager", data.ownerName || "—"],
    ["Designer", data.designerName || "—"],
    ["TTL Qty", fmtQty(data.totalQty)],
  ];
  const summaryRows = Math.max(leftCol.length, rightCol.length);
  let rowY = y;
  for (let i = 0; i < summaryRows; i++) {
    if (leftCol[i]) {
      drawSummaryCell(doc, leftCol[i][0], leftCol[i][1], x, rowY, colW);
    }
    if (rightCol[i]) {
      drawSummaryCell(doc, rightCol[i][0], rightCol[i][1], x + COL_WIDTH, rowY, colW);
    }
    rowY += 18;
  }
  y = rowY + 8;

  const pageCtx: AttentionPageContext = {
    tenantName: data.tenantName,
    orderNumber: data.orderNumberDisplay,
    onNewPage: () => {
      contentPages += 1;
    },
  };
  y = drawSpecs(doc, data, y, pageCtx);

  // If specs/notes pushed past the page, continue SKUs on a fresh page
  // (notes overflow already continues onto new pages with headers above).
  if (y > CONTENT_BOTTOM - 40) {
    doc.addPage();
    contentPages += 1;
    drawHeader(doc, data.tenantName, data.orderNumberDisplay);
    y = 56;
  }

  const skuCount = data.skuRows.length;
  const skuHeader = `SKUs — ${skuCount} SKU${skuCount !== 1 ? "s" : ""} · ${fmtQty(data.totalQty)} pcs`;
  ensureSkuSpace(24);
  y = drawSectionTitle(doc, skuHeader, y);

  for (const sku of data.skuRows) {
    ensureSkuSpace(18);
    const rowX = MARGIN + 6;
    doc.fontSize(10).font("Helvetica-Bold").fillColor("#9ca3af");
    textAt(doc, `${sku.index}`, rowX, y, { width: 20 });
    doc.fontSize(10).font("Helvetica").fillColor("#111827");
    textAt(doc, sku.name, rowX + 24, y, { width: w - 90 });
    doc.fontSize(10).font("Helvetica-Bold").fillColor("#374151");
    textAt(doc, fmtQty(sku.qty), rowX + w - 60, y, {
      width: 60,
      align: "right",
    });
    y += 18;
  }

  doc.fillColor("#000000").font("Helvetica");
  return contentPages;
}

function drawNoArtworkPlaceholder(
  doc: PdfDoc,
  top: number,
  height: number,
  message: string
) {
  doc
    .rect(MARGIN, top + 20, PAGE_WIDTH - MARGIN * 2, height - 40)
    .strokeColor("#e5e7eb")
    .lineWidth(1)
    .dash(4, { space: 4 })
    .stroke();
  doc.undash();
  doc.fontSize(11).fillColor("#9ca3af");
  textAt(doc, message, MARGIN, top + height / 2 - 8, {
    width: PAGE_WIDTH - MARGIN * 2,
    align: "center",
  });
}

function drawArtworkPage(
  doc: PdfDoc,
  data: OrderExportData,
  skuIndex: number,
  totalSkus: number,
  skuName: string,
  skuQty: number | null,
  imageIndex: number,
  totalImagesForSku: number,
  imageBuffer: Buffer | null
) {
  doc.rect(0, 0, PAGE_WIDTH, 78).fill("#1a1a2e");
  doc
    .fillColor("#ffffff")
    .fontSize(11)
    .font("Helvetica-Bold");
  textAt(doc, data.tenantName.toUpperCase(), MARGIN, 10);
  doc.fontSize(10).font("Helvetica");
  textAt(doc, "JOB TICKET", PAGE_WIDTH - MARGIN - 70, 10, {
    width: 70,
    align: "right",
  });

  // Order number (left) + Qty (right) — balanced, press-readable sizes
  doc.fontSize(13).font("Helvetica-Bold");
  textAt(doc, data.orderNumberDisplay, MARGIN, 30);
  doc.fontSize(11).font("Helvetica-Bold");
  textAt(doc, `Qty: ${fmtQty(skuQty)}`, PAGE_WIDTH - MARGIN - 90, 32, {
    width: 90,
    align: "right",
  });

  const skuLabel =
    totalImagesForSku > 1
      ? `SKU ${skuIndex + 1}/${totalSkus}: ${skuName}  ·  Image ${imageIndex + 1}/${totalImagesForSku}`
      : `SKU ${skuIndex + 1}/${totalSkus}: ${skuName}`;

  doc.fontSize(10).font("Helvetica").fillColor("#d1d5db");
  textAt(doc, skuLabel, MARGIN, 52, {
    width: PAGE_WIDTH - MARGIN * 2,
  });

  doc.fillColor("#000000");

  const imageTop = 86;
  const imageBottom = PAGE_HEIGHT - 24;
  const imageAreaH = imageBottom - imageTop;
  const imageAreaW = PAGE_WIDTH;

  if (imageBuffer) {
    try {
      doc.image(imageBuffer, 0, imageTop, {
        width: imageAreaW,
        height: imageAreaH,
        fit: [imageAreaW, imageAreaH],
        align: "center",
        valign: "center",
      });
    } catch {
      drawNoArtworkPlaceholder(doc, imageTop, imageAreaH, "Image could not be loaded");
    }
  } else {
    drawNoArtworkPlaceholder(doc, imageTop, imageAreaH, "No artwork uploaded");
  }
}

function totalArtworkPages(data: OrderExportData): number {
  return data.skuRows.reduce(
    (sum, sku) => sum + Math.max(1, sku.imageLinks.length),
    0
  );
}

export async function generateJobTicketPdf(
  data: OrderExportData,
  options?: { finalPdfBuffers?: Buffer[] }
): Promise<Buffer> {
  const finalBuffers = options?.finalPdfBuffers ?? [];
  const extraFinalPages = await pdfPageCount(finalBuffers);
  const useFinalPdf = extraFinalPages > 0;
  const artworkPages = useFinalPdf ? 0 : totalArtworkPages(data);

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    autoFirstPage: false,
    bufferPages: true,
  });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  doc.addPage();
  drawPage1(doc, data);

  // Cover (and any overflow note pages) first. Then either every page of the
  // Final-for-Prod PDF, or SKU artwork images when Drive has no Final file.
  let drawnArtwork = 0;
  if (!useFinalPdf) {
    for (let skuIdx = 0; skuIdx < data.skuRows.length; skuIdx++) {
      const sku = data.skuRows[skuIdx];
      const images = sku.imageLinks;

      if (images.length === 0) {
        doc.addPage();
        drawArtworkPage(
          doc,
          data,
          skuIdx,
          data.skuRows.length,
          sku.name,
          sku.qty,
          0,
          0,
          null
        );
        drawnArtwork += 1;
      } else {
        for (let imgIdx = 0; imgIdx < images.length; imgIdx++) {
          const buf = await fetchImageBuffer(images[imgIdx]);
          doc.addPage();
          drawArtworkPage(
            doc,
            data,
            skuIdx,
            data.skuRows.length,
            sku.name,
            sku.qty,
            imgIdx,
            images.length,
            buf
          );
          drawnArtwork += 1;
        }
      }
    }
  }

  // Stamp footers after ticket pages exist (include Final PDF pages in the total).
  const range = doc.bufferedPageRange();
  const totalPages = range.count + (useFinalPdf ? extraFinalPages : 0);
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    drawFooter(doc, i + 1, totalPages);
  }

  if (!useFinalPdf && drawnArtwork !== artworkPages) {
    console.warn(
      "[generateJobTicketPdf] artwork page count mismatch",
      { drawnArtwork, artworkPages }
    );
  }

  doc.end();

  const ticketBuffer: Buffer = await new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  if (!useFinalPdf) return ticketBuffer;
  return appendPdfDocuments(ticketBuffer, finalBuffers);
}
