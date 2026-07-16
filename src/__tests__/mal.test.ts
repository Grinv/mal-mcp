import { test, describe } from "node:test";
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

test("silent refresh: 401 triggers refresh, retries, and persists the rotated token", async (t) => {
  const storePath = tempStorePath("refresh");
  rmSync(storePath, { force: true });

  const config = loadConfig({
    MAL_ACCESS_TOKEN: "old",
    MAL_CLIENT_ID: "id",
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
  installFetch(t, mock);
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
    rmSync(storePath, { force: true });
  }
});

test("delete returns a confirmation and uses DELETE", async (t) => {
  const config = loadConfig({ MAL_ACCESS_TOKEN: "tok" });
  const mock = mockFetch(() => jsonResponse({}, { status: 200 }));
  installFetch(t, mock);
  const client = new MalClient(config, silentLogger());
  const res = (await client.deleteMyAnimeListItem(123)) as Record<string, unknown>;
  assert.deepEqual(res, { deleted: true, anime_id: 123 });
  assert.equal(mock.calls[0]!.init?.method, "DELETE");
  assert.match(mock.calls[0]!.url, /anime\/123\/my_list_status$/);
});

test("getMyAnimeList requests and round-trips the list_status annotation fields", async (t) => {
  const config = loadConfig({ MAL_ACCESS_TOKEN: "tok" });
  const mock = mockFetch(() =>
    jsonResponse({
      data: [
        {
          node: { id: 1, title: "Test" },
          list_status: {
            status: "watching",
            score: 8,
            priority: 1,
            tags: ["fav"],
            comments: "note",
            num_times_rewatched: 2,
            rewatch_value: 3,
          },
        },
      ],
      paging: { next: "https://api/next" },
    }),
  );
  installFetch(t, mock);
  const client = new MalClient(config, silentLogger());
  const res = (await client.getMyAnimeList({})) as {
    items: { list_status: Record<string, unknown> }[];
    has_next_page: boolean;
  };
  // The request must ask MAL for the write-capable annotation fields.
  const url = mock.calls[0]!.url;
  for (const f of ["priority", "tags", "comments", "num_times_rewatched", "rewatch_value"])
    assert.ok(decodeURIComponent(url).includes(f), `list request should request ${f}`);
  // And trimList must pass them straight through to the caller.
  const ls = res.items[0]!.list_status;
  assert.equal(ls["priority"], 1);
  assert.deepEqual(ls["tags"], ["fav"]);
  assert.equal(ls["comments"], "note");
  assert.equal(res.has_next_page, true);
});

test("getMyMangaList requests the manga-specific annotation fields", async (t) => {
  const config = loadConfig({ MAL_ACCESS_TOKEN: "tok" });
  const mock = mockFetch(() => jsonResponse({ data: [], paging: {} }));
  installFetch(t, mock);
  const client = new MalClient(config, silentLogger());
  await client.getMyMangaList({});
  const url = decodeURIComponent(mock.calls[0]!.url);
  for (const f of ["num_times_reread", "reread_value", "priority", "tags", "comments"])
    assert.ok(url.includes(f), `manga list request should request ${f}`);
});

test("a stored token takes precedence over the env access token", async (t) => {
  const storePath = tempStorePath("precedence");
  const store = new TokenStore(storePath, silentLogger());
  store.save({ accessToken: "stored", refreshToken: "r", expiresAt: Date.now() + 3_600_000 });

  const config = loadConfig({ MAL_ACCESS_TOKEN: "env-token" });
  const mock = mockFetch((_url, init) => {
    const auth = (init?.headers as Record<string, string>)["Authorization"];
    return jsonResponse({ used: auth });
  });
  installFetch(t, mock);
  try {
    const client = new MalClient(config, silentLogger(), store);
    const res = (await client.getMyUserInfo()) as Record<string, unknown>;
    assert.equal(res["used"], "Bearer stored");
  } finally {
    rmSync(storePath, { force: true });
  }
});

describe("login", () => {
  test("startLogin builds an authorize URL; submitRedirect exchanges the code (no secret) and configures the client", async (t) => {
    const config = loadConfig({ MAL_CLIENT_ID: "cid", MAL_OAUTH_PORT: "8199" });
    const tokenBodies: string[] = [];
    const mock = mockFetch((url, init) => {
      if (url.includes("/oauth2/token")) {
        tokenBodies.push(String(init?.body ?? ""));
        return jsonResponse({ access_token: "acc", refresh_token: "ref", expires_in: 2_592_000 });
      }
      return jsonResponse({ id: 1, name: "me" });
    });
    installFetch(t, mock);
    const client = new MalClient(config, silentLogger());
    assert.equal(client.isConfigured(), false);

    const { authorizeUrl, redirectUri } = await client.startLogin({ open: () => {} });
    assert.match(authorizeUrl, /\/authorize\?/);
    assert.match(authorizeUrl, /code_challenge_method=plain/);
    assert.equal(redirectUri, "http://localhost:8199/callback");

    await client.submitRedirect("http://localhost:8199/callback?code=THECODE&state=login_mal");
    assert.equal(client.isConfigured(), true); // token obtained → tools unlock live

    const body = tokenBodies[0] ?? "";
    assert.match(body, /grant_type=authorization_code/);
    assert.match(body, /code=THECODE/);
    assert.match(body, /code_verifier=/);
    assert.doesNotMatch(body, /client_secret/); // public client — no secret sent

    // A personal-list call now works with the freshly obtained token.
    const info = (await client.getMyUserInfo()) as { name?: string };
    assert.equal(info.name, "me");
  });

  test("submitRedirect without a started login errors", async () => {
    const client = new MalClient(loadConfig({ MAL_CLIENT_ID: "cid" }), silentLogger());
    await assert.rejects(
      () => client.submitRedirect("http://x/cb?code=Y"),
      /no login in progress/i,
    );
  });

  test("startLogin requires a client id", async () => {
    const client = new MalClient(loadConfig({}), silentLogger());
    await assert.rejects(() => client.startLogin({ open: () => {} }), /MAL_CLIENT_ID/);
  });
});

test("concurrent 401s trigger a single (deduped) token refresh", async (t) => {
  const config = loadConfig({
    MAL_ACCESS_TOKEN: "old",
    MAL_CLIENT_ID: "id",
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
  installFetch(t, mock);
  const client = new MalClient(config, silentLogger());
  await Promise.all([client.getMyUserInfo(), client.getMyAnimeList({})]);
  assert.equal(refreshCalls, 1);
});
