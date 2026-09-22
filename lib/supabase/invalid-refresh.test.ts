import assert from "node:assert/strict";
import { test } from "node:test";
import { isInvalidRefreshTokenError } from "./invalid-refresh.ts";
import { skipSupabaseSessionUpdate } from "./session-paths.ts";

test("detects refresh token not found", () => {
  assert.equal(
    isInvalidRefreshTokenError({
      name: "AuthApiError",
      message: "Invalid Refresh Token: Refresh Token Not Found",
    }),
    true
  );
});

test("login still updates cookies so a dead refresh token is cleared", () => {
  assert.equal(skipSupabaseSessionUpdate("/login"), false);
  assert.equal(skipSupabaseSessionUpdate("/signup"), false);
  assert.equal(skipSupabaseSessionUpdate("/respond/abc"), true);
  assert.equal(skipSupabaseSessionUpdate("/set-password"), true);
  assert.equal(skipSupabaseSessionUpdate("/board"), false);
});
