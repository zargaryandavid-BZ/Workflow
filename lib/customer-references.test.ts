import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  groupReferenceFiles,
  isAllowedReferenceFile,
  isCustomerReferenceResponseActivity,
  isCustomerReferencePath,
  isPreviewableReferenceImage,
  ownsReferencePath,
  parseReferenceFilesMeta,
  referenceSkuIdFromPath,
  referenceSkuLabel,
  referenceStoragePath,
  toCustomerReferenceFiles,
} from "./customer-references.ts";

const T = "tenant-1";
const O = "order-1";
const N = "notif-1";

describe("customer reference storage paths", () => {
  it("puts whole-proof references under all/", () => {
    const path = referenceStoragePath({
      tenantId: T,
      orderId: O,
      notificationId: N,
      fileName: "my logo (final).png",
      now: 123,
    });
    assert.equal(
      path,
      "tenant-1/order-1/customer-references/notif-1/all/123-my_logo__final_.png"
    );
    assert.equal(isCustomerReferencePath(path), true);
    assert.equal(referenceSkuIdFromPath(path), null);
  });

  it("encodes the SKU in the folder, not in sku_key", () => {
    const path = referenceStoragePath({
      tenantId: T,
      orderId: O,
      notificationId: N,
      skuId: "abc-123",
      fileName: "ref.jpg",
      now: 1,
    });
    assert.equal(referenceSkuIdFromPath(path), "abc-123");
    assert.equal(
      referenceSkuLabel(path, [
        { id: "x", name: "First" },
        { id: "abc-123", name: "Caviar" },
      ]),
      "SKU 2 — Caviar"
    );
    assert.equal(referenceSkuLabel(path, [{ id: "abc-123", name: " " }]), "SKU 1");
    assert.equal(referenceSkuLabel(path, []), null);
  });

  it("only owns paths inside this response's folder", () => {
    const good = referenceStoragePath({
      tenantId: T,
      orderId: O,
      notificationId: N,
      fileName: "a.png",
    });
    assert.equal(ownsReferencePath(good, T, O, N), true);
    assert.equal(ownsReferencePath(good, T, O, "other"), false);
    assert.equal(ownsReferencePath(`${T}/${O}/123-a.png`, T, O, N), false);
    assert.equal(
      ownsReferencePath(`${T}/${O}/customer-references/${N}/../x.png`, T, O, N),
      false
    );
  });

  it("does not treat missing-info or artwork paths as references", () => {
    assert.equal(isCustomerReferencePath(`${T}/${O}/123-art.pdf`), false);
    assert.equal(isCustomerReferencePath(`${T}/${O}/assets/1-x.png`), false);
    assert.equal(isCustomerReferencePath(null), false);
  });
});

describe("customer reference file types", () => {
  it("allows images and PDFs only", () => {
    for (const n of ["a.PNG", "b.jpg", "c.jpeg", "d.webp", "e.gif", "f.heic", "g.pdf"]) {
      assert.equal(isAllowedReferenceFile(n), true, n);
    }
    for (const n of ["a.ai", "b.eps", "c.zip", "d.exe", "noext"]) {
      assert.equal(isAllowedReferenceFile(n), false, n);
    }
  });

  it("previews browser-renderable images only", () => {
    assert.equal(isPreviewableReferenceImage("a.jpg"), true);
    assert.equal(isPreviewableReferenceImage("a.heic", "image/heic"), false);
    assert.equal(isPreviewableReferenceImage("a.pdf", "application/pdf"), false);
    assert.equal(isPreviewableReferenceImage("blob", "image/png"), true);
  });
});

describe("customer reference display", () => {
  it("keeps only reference-folder assets and labels SKUs", () => {
    const files = toCustomerReferenceFiles(
      [
        {
          id: "1",
          file_name: "ref.png",
          mime_type: "image/png",
          size: 10,
          storage_path: `${T}/${O}/customer-references/${N}/sku-s2/1-ref.png`,
        },
        {
          id: "2",
          file_name: "artwork.pdf",
          storage_path: `${T}/${O}/99-artwork.pdf`,
        },
        {
          id: "3",
          file_name: "all.pdf",
          storage_path: `${T}/${O}/customer-references/${N}/all/2-all.pdf`,
        },
      ],
      [
        { id: "s1", name: "One" },
        { id: "s2", name: "Two" },
      ]
    );
    assert.deepEqual(
      files.map((f) => [f.id, f.sku_label]),
      [
        ["1", "SKU 2 — Two"],
        ["3", null],
      ]
    );
    const groups = groupReferenceFiles(files);
    assert.deepEqual(
      groups.map((g) => [g.label, g.files.length]),
      [
        [null, 1],
        ["SKU 2 — Two", 1],
      ]
    );
  });

  it("parses activity metadata defensively", () => {
    assert.deepEqual(parseReferenceFilesMeta(null), []);
    assert.deepEqual(parseReferenceFilesMeta({ reference_files: "x" }), []);
    const parsed = parseReferenceFilesMeta({
      reference_files: [
        { id: "a", file_name: "a.png", mime_type: "image/png", size: 5, sku_label: "SKU 1" },
        { id: "", file_name: "bad.png" },
        null,
        { id: "b", file_name: "b.pdf" },
      ],
    });
    assert.deepEqual(parsed, [
      { id: "a", file_name: "a.png", mime_type: "image/png", size: 5, sku_label: "SKU 1" },
      { id: "b", file_name: "b.pdf", mime_type: null, size: null, sku_label: null },
    ]);
  });
});

describe("customer rejection with references in Com. History", () => {
  // Live shape (card 1177883, 2026-10-21): the rejection also moved the card,
  // so metadata carries from/to/movedTo — which used to hide it entirely.
  const rejectedMeta = {
    via: "customer",
    from: "col-waiting",
    to: "col-start",
    movedTo: "col-start",
    toName: "Start (Create Order)",
    note: "SKU 1 — Wine menu: Not approved",
    reference_files: [
      {
        id: "ecb51853",
        file_name: "IMG_2326.jpeg",
        mime_type: "image/jpeg",
        size: 2079112,
        sku_label: "SKU 1 — Wine menu",
      },
    ],
  };

  it("shows a moving customer rejection that has reference files", () => {
    assert.equal(
      isCustomerReferenceResponseActivity("rejected", rejectedMeta),
      true
    );
    assert.equal(
      isCustomerReferenceResponseActivity("approved", rejectedMeta),
      true
    );
  });

  it("ignores responses without files and non-customer actions", () => {
    assert.equal(
      isCustomerReferenceResponseActivity("rejected", {
        ...rejectedMeta,
        reference_files: [],
      }),
      false
    );
    assert.equal(isCustomerReferenceResponseActivity("rejected", null), false);
    assert.equal(
      isCustomerReferenceResponseActivity("moved", rejectedMeta),
      false
    );
  });
});
