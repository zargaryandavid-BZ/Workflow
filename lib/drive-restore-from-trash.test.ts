import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  restoreDriveFileFromTrash,
  type DriveTrashClient,
} from "./drive-restore-from-trash.ts";

const FOLDER_MIME = "application/vnd.google-apps.folder";

function mockDrive(opts: {
  files: Record<
    string,
    { trashed: boolean; parents?: string[]; mimeType?: string }
  >;
}): { drive: DriveTrashClient; restored: string[] } {
  const restored: string[] = [];
  const files = { ...opts.files };
  const drive: DriveTrashClient = {
    files: {
      async get({ fileId }) {
        const row = files[fileId];
        if (!row) throw new Error("not found");
        return {
          data: {
            id: fileId,
            trashed: row.trashed,
            parents: row.parents ?? [],
            // Default to a folder — restore only ever targets folders now.
            mimeType: row.mimeType ?? FOLDER_MIME,
          },
        };
      },
      async update({ fileId, requestBody }) {
        const row = files[fileId];
        if (!row) throw new Error("not found");
        if (requestBody.trashed === false) {
          row.trashed = false;
          restored.push(fileId);
        }
        return { data: { id: fileId, trashed: row.trashed } };
      },
    },
  };
  return { drive, restored };
}

describe("restoreDriveFileFromTrash", () => {
  it("returns true when the file is already live", async () => {
    const { drive, restored } = mockDrive({
      files: { a: { trashed: false } },
    });
    assert.equal(await restoreDriveFileFromTrash(drive, "a"), true);
    assert.deepEqual(restored, []);
  });

  it("restores a trashed folder", async () => {
    const { drive, restored } = mockDrive({
      files: { final: { trashed: true, parents: ["job"] } },
    });
    assert.equal(await restoreDriveFileFromTrash(drive, "final"), true);
    assert.deepEqual(restored, ["final"]);
  });

  it("restores trashed parents before the folder", async () => {
    const { drive, restored } = mockDrive({
      files: {
        job: { trashed: true, parents: ["root"] },
        final: { trashed: true, parents: ["job"] },
        root: { trashed: false },
      },
    });
    assert.equal(await restoreDriveFileFromTrash(drive, "final"), true);
    assert.deepEqual(restored, ["job", "final"]);
  });

  it("returns false when Drive get fails", async () => {
    const { drive } = mockDrive({ files: {} });
    assert.equal(await restoreDriveFileFromTrash(drive, "missing"), false);
  });

  it("never un-trashes a FILE (stays deleted)", async () => {
    const { drive, restored } = mockDrive({
      files: {
        doc: { trashed: true, parents: ["final"], mimeType: "application/pdf" },
        final: { trashed: false },
      },
    });
    assert.equal(await restoreDriveFileFromTrash(drive, "doc"), false);
    assert.deepEqual(restored, []);
  });
});
