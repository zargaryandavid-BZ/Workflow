"use client";

import { Label, Select } from "@/components/ui/input";
import {
  PRODUCT_CATEGORY_NAMES,
  categoryForProduct,
  materialsForProduct,
  productsForCategory,
} from "@/lib/product-data";
import {
  findMatchingOption,
  optionsMatch,
  uniqueOptions,
} from "@/lib/field-links";
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
   * When set (including empty array), replaces hard-coded Category→Product
   * filtering from product-data. Pass null/undefined to keep the catalog fallback.
   */
  productOptionsOverride?: string[] | null;
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
  productOptionsOverride = null,
  materialOptionsOverride = null,
}: Props) {
  const product = asString(productValue);
  const materials = asString(materialsValue);
  // Only the stored custom-field value drives filtering — never an inferred label.
  const storedCategory = asString(categoryValue).trim();

  const categoryOptions = uniqueOptions(
    categoryField?.options && categoryField.options.length > 0
      ? categoryField.options
      : [...PRODUCT_CATEGORY_NAMES]
  );

  const productOptions = uniqueOptions(
    productOptionsOverride != null
      ? productOptionsOverride
      : productsForCategory(storedCategory || null, productField.options)
  );
  const materialOptions = uniqueOptions(
    materialOptionsOverride != null
      ? materialOptionsOverride
      : materialsForProduct(product || null, materialsField.options)
  );

  const categorySelectOptions = uniqueOptions(
    storedCategory &&
      !categoryOptions.some((c) => optionsMatch(c, storedCategory))
      ? [storedCategory, ...categoryOptions]
      : categoryOptions
  );
  const productSelectOptions = uniqueOptions(
    product && !productOptions.some((p) => optionsMatch(p, product))
      ? [product, ...productOptions]
      : productOptions
  );
  const materialSelectOptions = uniqueOptions(
    materials && !materialOptions.some((m) => optionsMatch(m, materials))
      ? [materials, ...materialOptions]
      : materialOptions
  );

  function syncCategoryFromProduct(productName: string) {
    if (storedCategory || !onCategoryChange) return;
    const inferred = categoryForProduct(productName);
    if (!inferred) return;
    const match = findMatchingOption(categoryOptions, inferred);
    if (match) onCategoryChange(match);
  }

  function handleCategoryChange(next: string) {
    onCategoryChange?.(next);
    if (!next) {
      onProductChange("");
      onMaterialsChange("");
      return;
    }

    if (productOptionsOverride != null) {
      // Parent clears Product / Materials / Finishing via field_links.
      return;
    }

    const nextProducts = productsForCategory(next, productField.options);
    if (product && !nextProducts.some((p) => optionsMatch(p, product))) {
      if (nextProducts.length === 1) {
        onProductChange(nextProducts[0]);
      } else {
        onProductChange("");
      }
      onMaterialsChange("");
      return;
    }

    if (!product && nextProducts.length === 1) {
      onProductChange(nextProducts[0]);
      onMaterialsChange("");
    }
  }

  function handleProductChange(next: string) {
    onProductChange(next);
    if (!next) {
      onMaterialsChange("");
      return;
    }
    syncCategoryFromProduct(next);
    if (materialOptionsOverride != null) {
      onMaterialsChange("");
      return;
    }
    const allowed = materialsForProduct(next, materialsField.options);
    if (materials && !allowed.some((m) => optionsMatch(m, materials))) {
      onMaterialsChange("");
    }
  }

  const showCategory =
    Boolean(categoryField) &&
    (!hideEmpty || Boolean(storedCategory || product));
  const showProduct = !hideEmpty || Boolean(product);
  const showMaterials = !hideEmpty || Boolean(materials);

  if (!showCategory && !showProduct && !showMaterials) return null;

  const needsCategory = Boolean(categoryField) && !storedCategory;
  const productPlaceholder = needsCategory
    ? "Select category first"
    : productOptions.length === 0
      ? "No products for this category"
      : "—";

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
            value={storedCategory}
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
            disabled={readOnly || (!readOnly && needsCategory)}
            onChange={(e) => handleProductChange(e.target.value)}
          >
            <option value="">{productPlaceholder}</option>
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
