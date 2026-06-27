import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../config.js";

test("no credentials → not configured", () => {
  const c = loadConfig({});
  assert.equal(c.auth.configured, false);
  assert.equal(c.auth.canRefresh, false);
  assert.equal(c.jikanBaseUrl, "https://api.jikan.moe/v4");
});

test("access token only → configured but cannot refresh", () => {
  const c = loadConfig({ MAL_ACCESS_TOKEN: "tok" });
  assert.equal(c.auth.configured, true);
  assert.equal(c.auth.canRefresh, false);
});

test("client credentials + refresh token → can refresh", () => {
  const c = loadConfig({
    MAL_CLIENT_ID: "id",
    MAL_CLIENT_SECRET: "secret",
    MAL_REFRESH_TOKEN: "refresh",
  });
  assert.equal(c.auth.canRefresh, true);
  assert.equal(c.auth.configured, true);
});

test("empty-string values are treated as unset (mcpb passes unset config as '')", () => {
  const c = loadConfig({ MAL_ACCESS_TOKEN: "", MAL_CLIENT_ID: "", LOG_LEVEL: "" });
  assert.equal(c.auth.configured, false);
  assert.equal(c.logLevel, "info"); // default still applies
});

test("numeric env vars are coerced", () => {
  const c = loadConfig({ HTTP_TIMEOUT_MS: "5000", JIKAN_MIN_INTERVAL_MS: "0" });
  assert.equal(c.httpTimeoutMs, 5000);
  assert.equal(c.jikanMinIntervalMs, 0);
});
