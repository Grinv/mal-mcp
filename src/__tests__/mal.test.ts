import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MalClient } from "../clients/mal.js";
import { TokenStore, type TokenState } from "../lib/tokenStore.js";
import { loadConfig } from "../config.js";
import { silentLogger, jsonResponse, mockFetch, installFetch } from "./helpers.js";

function tempStorePath(name: string): string {
  return join(tmpdir(), `mal-mcp-test-${name}.json`);
}

test("silent refresh: 401 triggers refresh, retries, and persists the rotated token", async () => {
  const storePath = tempStorePath("refresh");
  rmSync(storePath, { force: true });

  const config = loadConfig({
    MAL_ACCESS_TOKEN: "old",
    MAL_CLIENT_ID: "id",
    MAL_CLIENT_SECRET: "secret",
    MAL_REFRESH_TOKEN: "refresh0",
  });
  const store = new TokenStore(storePath, silentLogger());

  let refreshCalls = 0;
  const mock = mockFetch((url, init) => {
    if (url.includes("/oauth2/token")) {
      refreshCalls += 1;
      return jsonResponse({ access_token: "new", refresh_token: "rot1", expires_in: 2_592_000 });
    }
    const auth = (init?.headers as Record<string, string>)["Authorization"];
    if (auth === "Bearer old") return jsonResponse({ error: "unauthorized" }, { status: 401 });
    return jsonResponse({ id: 42, name: "tester" });
  });
  const restore = installFetch(mock);
  try {
    const client = new MalClient(config, silentLogger(), store);
    const info = (await client.getMyUserInfo()) as Record<string, unknown>;
    assert.equal(info["name"], "tester");
    assert.equal(refreshCalls, 1);

    const persisted = JSON.parse(readFileSync(storePath, "utf8")) as TokenState;
    assert.equal(persisted.accessToken, "new");
    assert.equal(persisted.refreshToken, "rot1");
    assert.ok(persisted.expiresAt > Date.now());
  } finally {
    restore();
    rmSync(storePath, { force: true });
  }
});

test("delete returns a confirmation and uses DELETE", async () => {
  const config = loadConfig({ MAL_ACCESS_TOKEN: "tok" });
  const mock = mockFetch(() => jsonResponse({}, { status: 200 }));
  const restore = installFetch(mock);
  try {
    const client = new MalClient(config, silentLogger());
    const res = (await client.deleteMyAnimeListItem(123)) as Record<string, unknown>;
    assert.deepEqual(res, { deleted: true, anime_id: 123 });
    assert.equal(mock.calls[0]!.init?.method, "DELETE");
    assert.match(mock.calls[0]!.url, /anime\/123\/my_list_status$/);
  } finally {
    restore();
  }
});

test("a stored token takes precedence over the env access token", async () => {
  const storePath = tempStorePath("precedence");
  const store = new TokenStore(storePath, silentLogger());
  store.save({ accessToken: "stored", refreshToken: "r", expiresAt: Date.now() + 3_600_000 });

  const config = loadConfig({ MAL_ACCESS_TOKEN: "env-token" });
  const mock = mockFetch((_url, init) => {
    const auth = (init?.headers as Record<string, string>)["Authorization"];
    return jsonResponse({ used: auth });
  });
  const restore = installFetch(mock);
  try {
    const client = new MalClient(config, silentLogger(), store);
    const res = (await client.getMyUserInfo()) as Record<string, unknown>;
    assert.equal(res["used"], "Bearer stored");
  } finally {
    restore();
    rmSync(storePath, { force: true });
  }
});

test("concurrent 401s trigger a single (deduped) token refresh", async () => {
  const config = loadConfig({
    MAL_ACCESS_TOKEN: "old",
    MAL_CLIENT_ID: "id",
    MAL_CLIENT_SECRET: "secret",
    MAL_REFRESH_TOKEN: "refresh0",
  });
  let refreshCalls = 0;
  const mock = mockFetch((url, init) => {
    if (url.includes("/oauth2/token")) {
      refreshCalls += 1;
      return jsonResponse({ access_token: "new", refresh_token: "rot1", expires_in: 2_592_000 });
    }
    const auth = (init?.headers as Record<string, string>)["Authorization"];
    if (auth === "Bearer old") return jsonResponse({ error: "unauthorized" }, { status: 401 });
    return jsonResponse({ ok: true });
  });
  const restore = installFetch(mock);
  try {
    const client = new MalClient(config, silentLogger());
    await Promise.all([client.getMyUserInfo(), client.getMyAnimeList({})]);
    assert.equal(refreshCalls, 1);
  } finally {
    restore();
  }
});
