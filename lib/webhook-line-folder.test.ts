import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  driveFolderUrlFromOrderSpecs,
  resolveWebhookLineFolderUrl,
} from "./webhook-line-folder.ts";

describe("resolveWebhookLineFolderUrl", () => {
  it("prefers files_url over item_folder_url (CRM sends both; same Drive folder)", () => {
    assert.equal(
      resolveWebhookLineFolderUrl({
        item_folder_url: "https://drive.google.com/drive/folders/abc123xyz",
        files_url: "https://drive.google.com/drive/folders/other",
      }),
      "https://drive.google.com/drive/folders/other"
    );
  });

  it("accepts files_url alias", () => {
    assert.equal(
      resolveWebhookLineFolderUrl({
        files_url: "https://drive.google.com/drive/folders/files1",
      }),
      "https://drive.google.com/drive/folders/files1"
    );
  });

  it("ignores empty folder fields so Workflow can create", () => {
    assert.equal(
      resolveWebhookLineFolderUrl({
        item_folder_url: "",
        files_url: "  ",
        design_task: "not a url",
      }),
      null
    );
  });

  it("falls back to design_task http(s) URL", () => {
    assert.equal(
      resolveWebhookLineFolderUrl({
        design_task: "https://drive.google.com/drive/folders/from-task",
      }),
      "https://drive.google.com/drive/folders/from-task"
    );
  });
});

describe("driveFolderUrlFromOrderSpecs", () => {
  it("prefers the stamped CRM folder over design_task", () => {
    assert.equal(
      driveFolderUrlFromOrderSpecs({
        gdrive_item_folder_url: "https://drive.google.com/drive/folders/crm",
        design_task: "https://drive.google.com/drive/folders/other",
      }),
      "https://drive.google.com/drive/folders/crm"
    );
  });
});
