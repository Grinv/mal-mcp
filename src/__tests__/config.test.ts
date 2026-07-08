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

test("client id + refresh token → can refresh (public client, no secret)", () => {
  const c = loadConfig({
    MAL_CLIENT_ID: "id",
    MAL_REFRESH_TOKEN: "refresh",
  });
  assert.equal(c.auth.canRefresh, true);
  assert.equal(c.auth.configured, true);
});

test("client id alone (no token yet) → not configured until login", () => {
  const c = loadConfig({ MAL_CLIENT_ID: "id" });
  assert.equal(c.auth.canRefresh, false);
  assert.equal(c.auth.configured, false);
});

test("empty-string values are treated as unset (mcpb passes unset config as '')", () => {
  const c = loadConfig({ MAL_ACCESS_TOKEN: "", MAL_CLIENT_ID: "", LOG_LEVEL: "" });
  assert.equal(c.auth.configured, false);
  assert.equal(c.logLevel, "info"); // default still applies
});

test("unsubstituted .mcpb placeholders are treated as unset", () => {
  // An unfilled optional field arrives as the literal "${user_config.X}".
  const c = loadConfig({
    MAL_ACCESS_TOKEN: "${user_config.mal_access_token}",
    MAL_CLIENT_ID: "${user_config.mal_client_id}",
    MAL_REFRESH_TOKEN: "${user_config.mal_refresh_token}",
  });
  // Must NOT be taken as real credentials (else configured → true → the
  // personal-list tools would try to authenticate with garbage).
  assert.equal(c.auth.configured, false);
  assert.equal(c.auth.accessToken, undefined);
  assert.equal(c.auth.clientId, undefined);
});

test("numeric env vars are coerced", () => {
  const c = loadConfig({ HTTP_TIMEOUT_MS: "5000", JIKAN_MIN_INTERVAL_MS: "0" });
  assert.equal(c.httpTimeoutMs, 5000);
  assert.equal(c.jikanMinIntervalMs, 0);
});

test("oauth callback port defaults to 8080 and is overridable", () => {
  assert.equal(loadConfig({}).oauthPort, 8080);
  assert.equal(loadConfig({ MAL_OAUTH_PORT: "9123" }).oauthPort, 9123);
});
