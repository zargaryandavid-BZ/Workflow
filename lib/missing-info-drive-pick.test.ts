import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FOLDER_MIME,
  MIRROR_PROP,
  isCustomerUpload,
  isPerItemFolderName,
  newCustomerFilesSince,
  pickFilesToMirror,
} from "./missing-info-drive-pick.ts";

const staff = new Set(["designer@bazaarprinting.com"]);

describe("isPerItemFolderName", () => {
  it("matches item folders only", () => {
    assert.equal(isPerItemFolderName("685_Safe Care Packaging_1"), true);
    assert.equal(isPerItemFolderName("685_Safe Care Packaging"), false);
    assert.equal(isPerItemFolderName("685_Safe Care Packaging_1_FinalProd"), false);
    assert.equal(isPerItemFolderName(""), false);
  });
});

describe("pickFilesToMirror", () => {
  const parent = [
    { id: "f1", name: "5 ml PSP ROSIN.pdf", mimeType: "application/pdf" },
    { id: "d1", name: "685_x_1", mimeType: FOLDER_MIME },
    { id: "f2", name: "back.ai", mimeType: "application/postscript" },
  ];
  it("copies loose files the item folder lacks", () => {
    assert.deepEqual(pickFilesToMirror(parent, []).map((f) => f.id), ["f1", "f2"]);
  });
  it("skips already mirrored and same-name files", () => {
    const item = [
      { id: "c1", name: "5 ml PSP ROSIN.pdf", appProperties: { [MIRROR_PROP]: "f1" } },
      { id: "c2", name: "BACK.AI" },
    ];
    assert.deepEqual(pickFilesToMirror(parent, item), []);
  });
});

describe("customer uploads", () => {
  it("excludes staff, service account, mirrors and folders", () => {
    assert.equal(isCustomerUpload({ id: "a", name: "a.pdf", lastModifyingUser: { emailAddress: "client@safecare.com" } }, staff), true);
    assert.equal(isCustomerUpload({ id: "a", name: "a.pdf" }, staff), true);
    assert.equal(isCustomerUpload({ id: "a", name: "a.pdf", lastModifyingUser: { emailAddress: "Designer@bazaarprinting.com" } }, staff), false);
    assert.equal(isCustomerUpload({ id: "a", name: "a.pdf", lastModifyingUser: { emailAddress: "x@proj.iam.gserviceaccount.com" } }, staff), false);
    assert.equal(isCustomerUpload({ id: "a", name: "a.pdf", appProperties: { [MIRROR_PROP]: "z" } }, staff), false);
    assert.equal(isCustomerUpload({ id: "a", name: "d", mimeType: FOLDER_MIME }, staff), false);
  });
  it("only counts files after the card entered Missing Info", () => {
    const files = [
      { id: "old", name: "a.pdf", createdTime: "2026-11-24T22:51:00Z" },
      { id: "new", name: "b.pdf", createdTime: "2026-11-25T02:00:00Z" },
      { id: "none", name: "c.pdf" },
    ];
    assert.deepEqual(
      newCustomerFilesSince(files, "2026-11-25T01:22:12Z", staff).map((f) => f.id),
      ["new"]
    );
    assert.deepEqual(newCustomerFilesSince(files, null, staff), []);
  });
});
