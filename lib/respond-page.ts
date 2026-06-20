export interface OrderMetaChip {
  label: string;
  value: string;
}

function pickField(
  fields: Record<string, unknown>,
  ...names: string[]
): string | null {
  const lower = new Map(
    Object.entries(fields).map(([k, v]) => [k.toLowerCase(), v])
  );
  for (const name of names) {
    const v = lower.get(name.toLowerCase());
    if (v !== null && v !== undefined && v !== "") return String(v);
  }
  return null;
}

export function orderMetaChips(
  fields: Record<string, unknown>,
  specs: Record<string, unknown>
): OrderMetaChip[] {
  const qtyFromSkus = Array.isArray(specs.skus)
    ? (specs.skus as { qty?: number }[]).reduce(
        (sum, s) => sum + (s.qty ?? 0),
        0
      )
    : 0;

  const chips: (OrderMetaChip | null)[] = [
    pickField(fields, "Product")
      ? {
          label: "Product",
          value: pickField(fields, "Product")!,
        }
      : null,
    pickField(fields, "Finished Size", "Size")
      ? {
          label: "Size",
          value: pickField(fields, "Finished Size", "Size")!,
        }
      : null,
    pickField(fields, "Order QTY", "Quantity") || qtyFromSkus > 0
      ? {
          label: "Quantity",
          value:
            pickField(fields, "Order QTY", "Quantity") ??
            String(qtyFromSkus),
        }
      : null,
    pickField(fields, "Materials", "Material", "Paper Stock")
      ? {
          label: "Material",
          value: pickField(fields, "Materials", "Material", "Paper Stock")!,
        }
      : null,
  ];

  return chips.filter(Boolean) as OrderMetaChip[];
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const RESPOND_ACCEPT =
  ".pdf,.ai,.eps,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg";

export const RESPOND_MAX_BYTES = 50 * 1024 * 1024;
