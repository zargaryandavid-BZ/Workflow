import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDesignTaskUrl, preserveDesignTaskUrl } from "./design-task.ts";

describe("isDesignTaskUrl", () => {
  it("accepts http(s) links only", () => {
    assert.equal(isDesignTaskUrl("https://drive.google.com/drive/folders/abc"), true);
    assert.equal(isDesignTaskUrl("http://example.com/x"), true);
    assert.equal(isDesignTaskUrl("samples | 25pcs"), false);
    assert.equal(isDesignTaskUrl(""), false);
    assert.equal(isDesignTaskUrl(null), false);
  });
});

describe("preserveDesignTaskUrl", () => {
  const folder = "https://drive.google.com/drive/folders/abc";

  it("keeps an existing Drive URL when the patch is empty or notes", () => {
    assert.equal(
      preserveDesignTaskUrl({ design_task: folder }, { design_task: null }).design_task,
      folder
    );
    assert.equal(
      preserveDesignTaskUrl({ design_task: folder }, { design_task: "" }).design_task,
      folder
    );
    assert.equal(
      preserveDesignTaskUrl(
        { design_task: folder },
        { design_task: "samples | 25pcs" }
      ).design_task,
      folder
    );
  });

  it("allows a new http(s) URL through", () => {
    const next = "https://drive.google.com/drive/folders/xyz";
    assert.equal(
      preserveDesignTaskUrl({ design_task: folder }, { design_task: next })
        .design_task,
      next
    );
  });
});
