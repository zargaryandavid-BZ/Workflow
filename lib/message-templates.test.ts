import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_GOOGLE_REVIEW_URL,
  renderMessageTemplate,
} from "./message-templates.ts";

describe("renderMessageTemplate", () => {
  const vars = {
    customer_name: "Red Zone / Baggies / Bazaar",
    review_link: DEFAULT_GOOGLE_REVIEW_URL,
  };

  it("fills {{review_link}}", () => {
    assert.match(
      renderMessageTemplate("Review: {{review_link}}", vars),
      /https:\/\/g\.page\//
    );
  });

  it("fills {{review link}} with a space in the name", () => {
    const out = renderMessageTemplate(
      "appreciate a quick review here: {{review link}}",
      vars
    );
    assert.equal(
      out,
      `appreciate a quick review here: ${DEFAULT_GOOGLE_REVIEW_URL}`
    );
    assert.doesNotMatch(out, /\{\{?review/i);
  });

  it("fills a malformed {review link}} leftover", () => {
    const out = renderMessageTemplate(
      "review here: {review link}}...",
      vars
    );
    assert.equal(out, `review here: ${DEFAULT_GOOGLE_REVIEW_URL}...`);
  });
});
