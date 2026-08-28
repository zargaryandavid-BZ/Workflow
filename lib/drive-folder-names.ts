/** Drive folder names cannot contain / — keep the rest printable. */
export function sanitizeDriveFolderName(name: string): string {
  const cleaned = name
    .replace(/[\\/]+/g, "-")
    .replace(/[\u0000-\u001f]/g, "")
    .trim()
    .slice(0, 200);
  return cleaned || "Untitled";
}

/**
 * Line-item / part titles go straight into a Drive folder name, so strip the
 * characters that are illegal in Windows / Drive-synced folder names
 * (`/ \\ : * ? " < > |`), collapse whitespace, and cap the length so the folder
 * name stays tidy. Returns "" when nothing printable is left (caller falls back
 * to the index-based name).
 */
export function sanitizeDriveItemTitle(title: string): string {
  return title
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .trim();
}

/**
 * Drop a leading `YY-` year prefix: `26-0269` → `0269`, `26-3009` → `3009`.
 * Also strips it when a part suffix remains (`26-3009-1` → `3009-1`).
 */
export function stripDriveYearPrefix(code: string): string {
  const trimmed = code.trim();
  const match = /^(\d{2})-(\d{3,})(.*)$/.exec(trimmed);
  return match ? `${match[2]}${match[3]}` : trimmed;
}

/**
 * Order key for Drive (before shortening): keep `26-3009` intact.
 * Do not treat `26-3009` as job `26` + part `3009`.
 */
export function driveOrderKeyFromTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return "Untitled order";
  if (/^\d{2}-\d{3,}$/.test(trimmed)) return trimmed;
  const yearAndPart = /^(\d{2}-\d{3,})-(\d+)$/.exec(trimmed);
  if (yearAndPart) return yearAndPart[1]!;
  const match = trimmed.match(/^(.+)-(\d+)$/);
  if (match) return match[1]!;
  return trimmed;
}

/**
 * Short code for folder names: ORD-2026-0269 → 0269.
 * Also accepts already-short values (`26-0269`, `0269`).
 */
export function shortDriveOrderCode(orderKey: string): string {
  const trimmed = orderKey.trim();
  if (!trimmed) return "order";
  const withYear = /^ord-(\d{4})-(.+)$/i.exec(trimmed);
  if (withYear) {
    const rest = withYear[2].trim();
    const stripped = stripDriveYearPrefix(rest || withYear[1].slice(2));
    return stripped || "order";
  }
  const withoutOrd = trimmed.replace(/^ORD-/i, "");
  return stripDriveYearPrefix(withoutOrd) || "order";
}

/** Older `YY-####` codes used before year prefixes were dropped. */
export function legacyDriveOrderCodes(orderKey: string, code: string): string[] {
  const aliases = new Set<string>();
  const trimmed = orderKey.trim();
  const withYear = /^ord-(\d{4})-(.+)$/i.exec(trimmed);
  if (withYear) {
    const yy = withYear[1].slice(2);
    const rest = stripDriveYearPrefix(withYear[2].trim());
    if (rest) aliases.add(`${yy}-${rest}`);
  }
  const yyDash = /^(\d{2})-(\d{3,})$/.exec(trimmed.replace(/^ORD-/i, ""));
  if (yyDash) aliases.add(`${yyDash[1]}-${yyDash[2]}`);
  aliases.delete(code);
  return [...aliases];
}

/**
 * Production subfolder suffix. The old setting default "Final for Prod"
 * becomes `FinalProd` so folders look like `0269_Dessertz_1_FinalProd`.
 */
export function compactFinalProdLabel(settingsName: string): string {
  const trimmed = settingsName.trim() || "FinalProd";
  if (/^final(\s+for)?\s*prod$/i.test(trimmed)) return "FinalProd";
  return sanitizeDriveFolderName(trimmed.replace(/\s+/g, "")) || "FinalProd";
}

function uniqueNames(preferred: string, aliases: string[]): string[] {
  const seen = new Set<string>([preferred]);
  const extra: string[] = [];
  for (const name of aliases) {
    const cleaned = sanitizeDriveFolderName(name);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    extra.push(cleaned);
  }
  return extra;
}

export type DriveFolderPlan = {
  designerName: string;
  designerAliases: string[];
  itemName: string;
  itemAliases: string[];
  finalName: string;
  finalAliases: string[];
};

export function buildDriveFolderPlan(args: {
  orderKey: string;
  customerName: string;
  itemIndex?: number | null;
  itemTitle?: string | null;
  appendIndex?: boolean;
  finalFolderName?: string | null;
}): DriveFolderPlan {
  const code = sanitizeDriveFolderName(shortDriveOrderCode(args.orderKey));
  const customer = sanitizeDriveFolderName(args.customerName);
  const finalLabel = compactFinalProdLabel(
    args.finalFolderName || "FinalProd"
  );
  const y =
    typeof args.itemIndex === "number" && args.itemIndex >= 1
      ? Math.floor(args.itemIndex)
      : 1;
  const suffix = `_${y}`;
  const legacyCodes = legacyDriveOrderCodes(args.orderKey, code);

  const designerName = sanitizeDriveFolderName(`${code}_${customer}`);
  const designerAliases = uniqueNames(
    designerName,
    legacyCodes.map((legacy) => `${legacy}_${customer}`)
  );

  const indexItemName = sanitizeDriveFolderName(`${code}_${customer}${suffix}`);
  const cleanTitle =
    typeof args.itemTitle === "string"
      ? sanitizeDriveItemTitle(args.itemTitle)
      : "";
  // Main working folder is always `{code}_{customer}_{Y}` (e.g. 0269_Dessertz_1).
  const itemName = indexItemName;
  const titleNames = cleanTitle
    ? [
        `${code}_${cleanTitle}`,
        `${code}_${cleanTitle}${suffix}`,
        ...legacyCodes.flatMap((legacy) => [
          `${legacy}_${cleanTitle}`,
          `${legacy}_${cleanTitle}${suffix}`,
        ]),
      ]
    : [];
  const itemAliases = uniqueNames(itemName, [
    ...legacyCodes.map((legacy) => `${legacy}_${customer}${suffix}`),
    ...titleNames,
  ]);

  const finalName = sanitizeDriveFolderName(`${itemName}_${finalLabel}`);
  const oldFinals = [
    `${finalLabel}${suffix}`,
    `Final for Prod${suffix}`,
    `FinalProd${suffix}`,
    `${code}_Final for Prod${suffix}`,
    `${code}_${finalLabel}${suffix}`,
    `${indexItemName}_${finalLabel}`,
    `${indexItemName}_Final for Prod`,
    `${itemName}_Final for Prod`,
    ...legacyCodes.flatMap((legacy) => [
      `${legacy}_Final for Prod${suffix}`,
      `${legacy}_${finalLabel}${suffix}`,
      `${legacy}_${customer}${suffix}_${finalLabel}`,
      `${legacy}_${customer}${suffix}_Final for Prod`,
    ]),
  ];
  const finalAliases = uniqueNames(finalName, oldFinals);

  return {
    designerName,
    designerAliases,
    itemName,
    itemAliases,
    finalName,
    finalAliases,
  };
}
