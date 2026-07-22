"use client";

import { Label, Select } from "@/components/ui/input";
import {
  PRODUCT_CATEGORY_NAMES,
  categoryForProduct,
  materialsForProduct,
  productsForCategory,
} from "@/lib/product-data";
import { uniqueOptions } from "@/lib/field-links";
import type { CustomField } from "@/lib/types";

interface Props {
  categoryField?: CustomField | null;
  productField: CustomField;
  materialsField: CustomField;
  categoryValue?: unknown;
  productValue: unknown;
  materialsValue: unknown;
  onCategoryChange?: (value: unknown) => void;
  onProductChange: (value: unknown) => void;
  onMaterialsChange: (value: unknown) => void;
  readOnly?: boolean;
  /** When true, hide empty fields (view mode). */
  hideEmpty?: boolean;
  /**
   * When set (including empty array), replaces hard-coded Product→Materials
   * filtering from product-data. Pass null/undefined to keep the catalog fallback.
   */
  materialOptionsOverride?: string[] | null;
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value != null) return String(value);
  return "";
}

export function ProductMaterialsFields({
  categoryField,
  productField,
  materialsField,
  categoryValue,
  productValue,
  materialsValue,
  onCategoryChange,
  onProductChange,
  onMaterialsChange,
  readOnly = false,
  hideEmpty = false,
  materialOptionsOverride = null,
}: Props) {
  const product = asString(productValue);
  const materials = asString(materialsValue);
  const storedCategory = asString(categoryValue);
  const inferredCategory = categoryForProduct(product) ?? "";
  const category = storedCategory || inferredCategory;

  const categoryOptions = uniqueOptions(
    categoryField?.options && categoryField.options.length > 0
      ? categoryField.options
      : [...PRODUCT_CATEGORY_NAMES]
  );

  const productOptions = uniqueOptions(
    productsForCategory(category || null, productField.options)
  );
  const materialOptions = uniqueOptions(
    materialOptionsOverride != null
      ? materialOptionsOverride
      : materialsForProduct(product || null, materialsField.options)
  );

  // Ensure current values still appear even if not in the filtered list (legacy data).
  const categorySelectOptions = uniqueOptions(
    category && !categoryOptions.some((c) => c === category)
      ? [category, ...categoryOptions]
      : categoryOptions
  );
  const productSelectOptions = uniqueOptions(
    product && !productOptions.some((p) => p === product)
      ? [product, ...productOptions]
      : productOptions
  );
  const materialSelectOptions = uniqueOptions(
    materials && !materialOptions.some((m) => m === materials)
      ? [materials, ...materialOptions]
      : materialOptions
  );

  function handleCategoryChange(next: string) {
    onCategoryChange?.(next);
    if (!next) return;
    const nextProducts = productsForCategory(next, productField.options);
    if (product && !nextProducts.includes(product)) {
      onProductChange("");
      onMaterialsChange("");
    }
  }

  function handleProductChange(next: string) {
    onProductChange(next);
    if (!next) {
      onMaterialsChange("");
      return;
    }
    const inferred = categoryForProduct(next);
    if (inferred && onCategoryChange) {
      onCategoryChange(inferred);
    }
    // Linked-dropdown override is computed for the previous product in the parent;
    // always clear materials so the parent can re-filter for the new product.
    if (materialOptionsOverride != null) {
      onMaterialsChange("");
      return;
    }
    const allowed = materialsForProduct(next, materialsField.options);
    if (materials && !allowed.includes(materials)) {
      onMaterialsChange("");
    }
  }

  const showCategory =
    Boolean(categoryField) &&
    (!hideEmpty || Boolean(category || product));
  const showProduct = !hideEmpty || Boolean(product);
  const showMaterials = !hideEmpty || Boolean(materials);

  if (!showCategory && !showProduct && !showMaterials) return null;

  return (
    <>
      {showCategory && categoryField ? (
        <div className="sm:col-span-2">
          <Label htmlFor="order-category">
            {categoryField.name}
            {categoryField.required ? (
              <span className="ml-0.5 text-red-500">*</span>
            ) : null}
          </Label>
          <Select
            id="order-category"
            value={category}
            disabled={readOnly}
            onChange={(e) => handleCategoryChange(e.target.value)}
          >
            <option value="">—</option>
            {categorySelectOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      {showProduct ? (
        <div>
          <Label>
            {productField.name}
            {productField.required ? (
              <span className="ml-0.5 text-red-500">*</span>
            ) : null}
          </Label>
          <Select
            value={product}
            disabled={readOnly}
            onChange={(e) => handleProductChange(e.target.value)}
          >
            <option value="">—</option>
            {productSelectOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      {showMaterials ? (
        <div>
          <Label>
            {materialsField.name}
            {materialsField.required ? (
              <span className="ml-0.5 text-red-500">*</span>
            ) : null}
          </Label>
          <Select
            value={materials}
            disabled={readOnly || (!readOnly && !product)}
            onChange={(e) => onMaterialsChange(e.target.value)}
          >
            <option value="">
              {!product
                ? "Select product first"
                : materialOptions.length === 0
                  ? "No materials for this product"
                  : "—"}
            </option>
            {materialSelectOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
    </>
  );
}
