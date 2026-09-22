import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appAuthUrlFromRedirect,
  buildAppAuthVerifyUrl,
  hashedTokenFromGenerateLink,
} from "./auth-email-link.ts";

test("buildAppAuthVerifyUrl puts token_hash on the app path", () => {
  const url = buildAppAuthVerifyUrl({
    origin: "https://workflow-rho-one.vercel.app",
    path: "/set-password",
    hashedToken: "abc123",
    type: "recovery",
  });
  assert.equal(
    url,
    "https://workflow-rho-one.vercel.app/set-password?token_hash=abc123&type=recovery"
  );
});

test("appAuthUrlFromRedirect keeps invite query params", () => {
  const url = appAuthUrlFromRedirect({
    redirectTo:
      "https://app.example.com/signup?invite_email=taron%40bazaarprinting.com&invite_name=Taron",
    hashedToken: "tok",
    type: "invite",
  });
  const parsed = new URL(url);
  assert.equal(parsed.pathname, "/signup");
  assert.equal(parsed.searchParams.get("token_hash"), "tok");
  assert.equal(parsed.searchParams.get("type"), "invite");
  assert.equal(
    parsed.searchParams.get("invite_email"),
    "taron@bazaarprinting.com"
  );
  assert.equal(parsed.searchParams.get("invite_name"), "Taron");
});

test("hashedTokenFromGenerateLink trims and rejects empty", () => {
  assert.equal(
    hashedTokenFromGenerateLink({ hashed_token: "  xyz  " }),
    "xyz"
  );
  assert.equal(hashedTokenFromGenerateLink({ hashed_token: "" }), null);
  assert.equal(hashedTokenFromGenerateLink(null), null);
});
