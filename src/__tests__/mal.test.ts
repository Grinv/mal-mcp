import { test, describe, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { get as httpGet } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createServer, type AddressInfo } from "node:net";
import { MalClient } from "../clients/mal.ts";
import { ApiError } from "../lib/errors.ts";
import { TokenStore, type TokenState } from "../lib/tokenStore.ts";
import { loadConfig } from "../config.ts";
import { silentLogger, jsonResponse, mockFetch, installFetch } from "./helpers.ts";

// Unique per call: a fixed name let two runs at once read and wipe each other's token file.
function tempStorePath(name: string): string {
  return join(tmpdir(), `mal-mcp-test-${name}-${randomUUID()}.json`);
}

// Login tests bind real localhost ports. Fixed numbers made two runs at once (two worktrees, a
// watch run next to CI-style run) steal each other's port and fail; the OS hands out free ones.

/** Hold a random free port on `host` for the rest of the test, to make the callback port busy. */
async function occupyPort(t: TestContext, host = "127.0.0.1"): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve);
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return (server.address() as AddressInfo).port;
}

/** A port that was free a moment ago on both loopbacks the login listener binds (127.0.0.1 and,
 *  where there is one, ::1), for a test whose own listener must bind it. */
async function freePort(): Promise<number> {
  const bind = (port: number, host: string) =>
    new Promise<ReturnType<typeof createServer>>((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(port, host, () => resolve(server));
    });
  const close = (server: ReturnType<typeof createServer>) =>
    new Promise<void>((resolve) => server.close(() => resolve()));
  for (;;) {
    const v4 = await bind(0, "127.0.0.1");
    const { port } = v4.address() as AddressInfo;
    try {
      await close(await bind(port, "::1"));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EADDRINUSE") {
        await close(v4);
        continue; // taken on ::1 only; try another
      }
      if (code !== "EADDRNOTAVAIL" && code !== "EAFNOSUPPORT") throw err;
    }
    await close(v4);
    return port;
  }
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

test("getMyUserInfo rejects a malformed response instead of forwarding it as-is", async (t) => {
  const config = loadConfig({ MAL_ACCESS_TOKEN: "tok" });
  // Missing the required id/name fields — e.g. an upstream schema change or a proxy error page.
  const mock = mockFetch(() => jsonResponse({ unexpected: "shape" }));
  installFetch(t, mock);
  const client = new MalClient(config, silentLogger());
  await assert.rejects(
    () => client.getMyUserInfo(),
    (err: unknown) =>
      err instanceof ApiError &&
      err.code === "unknown" &&
      /unexpected response shape/i.test(err.message),
  );
});

test("updateMyAnimeStatus rejects a response that isn't the expected object shape", async (t) => {
  const config = loadConfig({ MAL_ACCESS_TOKEN: "tok" });
  // A broken upstream/proxy returning a bare array instead of the list_status object.
  const mock = mockFetch(() => jsonResponse([]));
  installFetch(t, mock);
  const client = new MalClient(config, silentLogger());
  await assert.rejects(
    () => client.updateMyAnimeStatus(1, { status: "watching" }),
    (err: unknown) =>
      err instanceof ApiError &&
      err.code === "unknown" &&
      /unexpected response shape for update_my_anime_status/i.test(err.message),
  );
});

test("updateMyMangaStatus uses the manga endpoint and PATCH", async (t) => {
  const config = loadConfig({ MAL_ACCESS_TOKEN: "tok" });
  const mock = mockFetch(() => jsonResponse({ status: "reading", score: 7 }));
  installFetch(t, mock);
  const client = new MalClient(config, silentLogger());
  const res = (await client.updateMyMangaStatus(55, { status: "reading", score: 7 })) as Record<
    string,
    unknown
  >;
  assert.equal(res["status"], "reading");
  assert.equal(mock.calls[0]!.init?.method, "PATCH");
  assert.match(mock.calls[0]!.url, /manga\/55\/my_list_status$/);
});

test("proactively refreshes an access token that's already expired (no 401 needed)", async (t) => {
  const storePath = tempStorePath("proactive-refresh");
  const store = new TokenStore(storePath, silentLogger());
  store.save({ accessToken: "old", refreshToken: "refresh0", expiresAt: Date.now() - 1000 });
  const config = loadConfig({ MAL_CLIENT_ID: "id" });

  let refreshCalls = 0;
  const authHeaders: (string | undefined)[] = [];
  const mock = mockFetch((url, init) => {
    if (url.includes("/oauth2/token")) {
      refreshCalls += 1;
      return jsonResponse({ access_token: "new", refresh_token: "rot1", expires_in: 2_592_000 });
    }
    authHeaders.push((init?.headers as Record<string, string>)["Authorization"]);
    return jsonResponse({ id: 1, name: "tester" });
  });
  installFetch(t, mock);
  try {
    const client = new MalClient(config, silentLogger(), store);
    const info = (await client.getMyUserInfo()) as Record<string, unknown>;
    assert.equal(info["name"], "tester");
    assert.equal(refreshCalls, 1);
    // The already-expired token must never be sent — refresh happens up front.
    assert.deepEqual(authHeaders, ["Bearer new"]);
  } finally {
    rmSync(storePath, { force: true });
  }
});

test("getMyUserInfo throws when no token is configured and refresh isn't possible", async (t) => {
  installFetch(
    t,
    mockFetch(() => {
      throw new Error("must not fetch — no token should mean no request is ever sent");
    }),
  );
  const client = new MalClient(loadConfig({}), silentLogger());
  await assert.rejects(
    () => client.getMyUserInfo(),
    (err: unknown) =>
      err instanceof ApiError &&
      err.code === "unauthorized" &&
      /No MyAnimeList access token configured/.test(err.message),
  );
});

test("returns a stale access token when refresh isn't possible, letting the request itself fail", async (t) => {
  const storePath = tempStorePath("stale-no-refresh");
  const store = new TokenStore(storePath, silentLogger());
  store.save({ accessToken: "stale", refreshToken: "r", expiresAt: Date.now() - 1000 });
  const config = loadConfig({}); // no MAL_CLIENT_ID → cannot refresh regardless of refreshToken
  const mock = mockFetch((_url, init) => {
    const auth = (init?.headers as Record<string, string>)["Authorization"];
    return auth === "Bearer stale"
      ? jsonResponse({ error: "unauthorized" }, { status: 401 })
      : jsonResponse({});
  });
  installFetch(t, mock);
  try {
    const client = new MalClient(config, silentLogger(), store);
    await assert.rejects(
      () => client.getMyUserInfo(),
      (err: unknown) => err instanceof ApiError && err.code === "unauthorized",
    );
    assert.equal(mock.calls.length, 1); // sent the stale token as-is; no refresh attempted
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

test("getMyAnimeList/getMyMangaList send nsfw=true — MAL otherwise hides the user's own gray entries", async (t) => {
  const config = loadConfig({ MAL_ACCESS_TOKEN: "tok" });
  const mock = mockFetch(() => jsonResponse({ data: [], paging: {} }));
  installFetch(t, mock);
  const client = new MalClient(config, silentLogger());
  await client.getMyAnimeList({});
  await client.getMyMangaList({});
  for (const call of mock.calls) assert.match(call.url, /[?&]nsfw=true(&|$)/);
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

test("getMyAnimeList drops a list entry with no node instead of failing the whole page", async (t) => {
  // A real (if rare) MAL data quirk: an entry pointing at a removed/merged title comes back
  // with no `node` at all.
  const config = loadConfig({ MAL_ACCESS_TOKEN: "tok" });
  const mock = mockFetch(() =>
    jsonResponse({
      data: [
        { node: { id: 1, title: "Real" }, list_status: { status: "completed" } },
        { list_status: { status: "completed" } },
      ],
      paging: {},
    }),
  );
  installFetch(t, mock);
  const client = new MalClient(config, silentLogger());
  const res = (await client.getMyAnimeList({})) as { items: { mal_id: number }[] };
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0]!.mal_id, 1);
});

test("a stored token takes precedence over the env access token", async (t) => {
  const storePath = tempStorePath("precedence");
  const store = new TokenStore(storePath, silentLogger());
  store.save({ accessToken: "stored", refreshToken: "r", expiresAt: Date.now() + 3_600_000 });

  const config = loadConfig({ MAL_ACCESS_TOKEN: "env-token" });
  const mock = mockFetch((_url, init) => {
    const auth = (init?.headers as Record<string, string>)["Authorization"];
    return jsonResponse({ id: 1, name: "tester", used: auth });
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

describe("login", { timeout: 10_000 }, () => {
  test("startLogin builds an authorize URL; submitRedirect exchanges the code (no secret) and configures the client", async (t) => {
    const port = await freePort();
    const config = loadConfig({ MAL_CLIENT_ID: "cid", MAL_OAUTH_PORT: String(port) });
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
    assert.equal(redirectUri, `http://localhost:${port}/callback`);

    // Round-trip the exact `state` startLogin issued (MAL echoes it on the redirect).
    const state = new URL(authorizeUrl).searchParams.get("state");
    assert.ok(state, "authorize URL carries a random state");
    await client.submitRedirect(`http://localhost:${port}/callback?code=THECODE&state=${state}`);
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

  test("falls back to manual-paste mode when the local callback port is busy", async (t) => {
    const port = await occupyPort(t);

    const config = loadConfig({ MAL_CLIENT_ID: "cid", MAL_OAUTH_PORT: String(port) });
    const client = new MalClient(config, silentLogger());
    const { authorizeUrl, listening } = await client.startLogin({ open: () => {} });
    assert.equal(listening, false);
    assert.match(authorizeUrl, /\/authorize\?/);
  });

  test("submitRedirect rejects a redirect whose state doesn't match the issued one", async (t) => {
    // Occupy the callback port so startLogin can't bind a localhost listener
    // (listening: false) — keeps this test from leaking an open server handle.
    const port = await occupyPort(t);

    const config = loadConfig({ MAL_CLIENT_ID: "cid", MAL_OAUTH_PORT: String(port) });
    const client = new MalClient(config, silentLogger());
    await client.startLogin({ open: () => {} });
    await assert.rejects(
      () => client.submitRedirect(`http://localhost:${port}/callback?code=X&state=forged`),
      /state mismatch/i,
    );
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
    return jsonResponse({ id: 1, name: "tester", data: [], paging: {} });
  });
  installFetch(t, mock);
  const client = new MalClient(config, silentLogger());
  await Promise.all([client.getMyUserInfo(), client.getMyAnimeList({})]);
  assert.equal(refreshCalls, 1);
});

test("a rejected refresh token reports as unauthorized and points at login_mal", async (t) => {
  // MAL answers an expired or revoked refresh token with 400, which used to reach the agent as
  // "The request was rejected as invalid" with no hint that re-authorizing is the fix.
  const storePath = tempStorePath("refresh-rejected");
  rmSync(storePath, { force: true });

  const config = loadConfig({
    MAL_ACCESS_TOKEN: "old",
    MAL_CLIENT_ID: "id",
    MAL_REFRESH_TOKEN: "dead",
  });
  const store = new TokenStore(storePath, silentLogger());

  const mock = mockFetch((url) => {
    if (url.includes("/oauth2/token")) {
      return jsonResponse({ error: "invalid_grant" }, { status: 400 });
    }
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  });
  installFetch(t, mock);
  try {
    const client = new MalClient(config, silentLogger(), store);
    await assert.rejects(
      () => client.getMyUserInfo(),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.code, "unauthorized");
        assert.match(err.message, /expired or been revoked/);
        assert.match(err.message, /login_mal/);
        return true;
      },
    );
    // The dead token is dropped rather than replayed against MAL on every later call.
    const persisted = JSON.parse(readFileSync(storePath, "utf8")) as TokenState;
    assert.equal(persisted.refreshToken, "");
    assert.equal(persisted.accessToken, "");
  } finally {
    rmSync(storePath, { force: true });
  }
});

test("a 5xx during refresh does not discard the stored refresh token", async (t) => {
  // An outage says nothing about the token's validity; throwing it away would log the user out
  // over a blip.
  const storePath = tempStorePath("refresh-outage");
  rmSync(storePath, { force: true });

  const config = loadConfig({
    MAL_ACCESS_TOKEN: "old",
    MAL_CLIENT_ID: "id",
    MAL_REFRESH_TOKEN: "still-good",
  });
  const store = new TokenStore(storePath, silentLogger());
  store.save({ accessToken: "old", refreshToken: "still-good", expiresAt: 0 });

  const mock = mockFetch((url) => {
    if (url.includes("/oauth2/token")) return jsonResponse({ error: "boom" }, { status: 503 });
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  });
  installFetch(t, mock);
  try {
    const client = new MalClient(config, silentLogger(), store);
    await assert.rejects(() => client.getMyUserInfo());
    const persisted = JSON.parse(readFileSync(storePath, "utf8")) as TokenState;
    assert.equal(persisted.refreshToken, "still-good");
  } finally {
    rmSync(storePath, { force: true });
  }
});

describe("token store shared by several server processes", () => {
  // Each MCP client runs its own server process, and they all share one token file. MAL rotates
  // the refresh token on every use, so a process still holding the old one is holding a dead one.
  function rotatingTokenEndpoint(): { posted: string[]; handler: (body: string) => Response } {
    const valid = new Set(["r0"]);
    const posted: string[] = [];
    let n = 0;
    return {
      posted,
      handler: (body) => {
        const token = new URLSearchParams(body).get("refresh_token") ?? "";
        posted.push(token);
        if (!valid.delete(token)) return jsonResponse({ error: "invalid_grant" }, { status: 400 });
        n += 1;
        valid.add(`r${n}`);
        return jsonResponse({ access_token: `a${n}`, refresh_token: `r${n}`, expires_in: 3600 });
      },
    };
  }

  function sharedSetup(t: TestContext, name: string) {
    const storePath = tempStorePath(name);
    rmSync(storePath, { force: true });
    t.after(() => rmSync(storePath, { force: true }));
    new TokenStore(storePath, silentLogger()).save({
      accessToken: "a0",
      refreshToken: "r0",
      expiresAt: 0,
    });
    const endpoint = rotatingTokenEndpoint();
    installFetch(
      t,
      mockFetch((url, init) =>
        url.includes("/oauth2/token")
          ? endpoint.handler(String(init?.body ?? ""))
          : jsonResponse({ id: 1, name: "tester" }),
      ),
    );
    const config = loadConfig({ MAL_CLIENT_ID: "id" });
    const client = () =>
      new MalClient(config, silentLogger(), new TokenStore(storePath, silentLogger()));
    return { storePath, endpoint, client };
  }

  test("a process that starts with an outdated token takes over the one another process saved", async (t) => {
    const { storePath, endpoint, client } = sharedSetup(t, "shared-adopt");
    const a = client();
    const b = client(); // both loaded r0
    await a.getMyUserInfo(); // A spends r0, saves r1
    await b.getMyUserInfo(); // B must not spend r0 again
    assert.deepEqual(endpoint.posted, ["r0"]);
    const persisted = JSON.parse(readFileSync(storePath, "utf8")) as TokenState;
    assert.equal(persisted.refreshToken, "r1");
  });

  test("losing a refresh race to another process doesn't wipe the shared store", async (t) => {
    const { storePath, endpoint, client } = sharedSetup(t, "shared-race");
    const a = client();
    const b = client();
    await a.getMyUserInfo(); // saves r1 + a fresh a1
    // B rereads the store before refreshing; make it look unchanged then, as if A's write landed
    // just after B's read, so B really does post its spent r0 and gets the 400.
    const realLoad = TokenStore.prototype.load;
    let first = true;
    t.mock.method(TokenStore.prototype, "load", function (this: TokenStore) {
      if (first) {
        first = false;
        return { accessToken: "a0", refreshToken: "r0", expiresAt: 0 };
      }
      return realLoad.call(this);
    });
    const info = await b.getMyUserInfo();
    assert.equal(info.name, "tester");
    assert.deepEqual(endpoint.posted, ["r0", "r0"]);
    const persisted = JSON.parse(readFileSync(storePath, "utf8")) as TokenState;
    assert.equal(persisted.refreshToken, "r1");
  });
});

test("an empty token store (left by a rejected refresh) doesn't shadow an env access token", async (t) => {
  const storePath = tempStorePath("empty-store");
  const store = new TokenStore(storePath, silentLogger());
  store.save({ accessToken: "", refreshToken: "", expiresAt: 0 });
  t.after(() => rmSync(storePath, { force: true }));
  installFetch(
    t,
    mockFetch((_url, init) => {
      const auth = (init?.headers as Record<string, string>)["Authorization"];
      return jsonResponse({ id: 1, name: "tester", used: auth });
    }),
  );
  const client = new MalClient(
    loadConfig({ MAL_ACCESS_TOKEN: "env-token" }),
    silentLogger(),
    store,
  );
  assert.equal(client.isConfigured(), true);
  const res = (await client.getMyUserInfo()) as Record<string, unknown>;
  assert.equal(res["used"], "Bearer env-token");
});

test("a rejected env refresh token isn't replayed against MAL on every call", async (t) => {
  let refreshCalls = 0;
  installFetch(
    t,
    mockFetch((url) => {
      if (url.includes("/oauth2/token")) {
        refreshCalls += 1;
        return jsonResponse({ error: "invalid_grant" }, { status: 400 });
      }
      return jsonResponse({ error: "unauthorized" }, { status: 401 });
    }),
  );
  const config = loadConfig({ MAL_CLIENT_ID: "id", MAL_REFRESH_TOKEN: "dead" });
  const client = new MalClient(config, silentLogger());
  await assert.rejects(() => client.getMyUserInfo(), /login_mal/);
  await assert.rejects(() => client.getMyUserInfo());
  assert.equal(refreshCalls, 1);
  assert.equal(client.isConfigured(), false);
});

test("a refresh response without a refresh_token keeps the one we have", async (t) => {
  // The token comes from the store, not the env, so losing it can't be masked by the env copy.
  const storePath = tempStorePath("keep-refresh");
  const store = new TokenStore(storePath, silentLogger());
  store.save({ accessToken: "a0", refreshToken: "keep-me", expiresAt: 0 });
  t.after(() => rmSync(storePath, { force: true }));
  const bodies: string[] = [];
  let calls = 0;
  installFetch(
    t,
    mockFetch((url, init) => {
      if (url.includes("/oauth2/token")) {
        bodies.push(String(init?.body ?? ""));
        calls += 1;
        // Already expired on arrival, so the next call has to refresh again.
        return jsonResponse({ access_token: `a${calls}`, expires_in: 0 });
      }
      return jsonResponse({ id: 1, name: "tester" });
    }),
  );
  const client = new MalClient(loadConfig({ MAL_CLIENT_ID: "id" }), silentLogger(), store);
  await client.getMyUserInfo();
  await client.getMyUserInfo();
  assert.equal(bodies.length, 2);
  assert.match(bodies[1]!, /refresh_token=keep-me/);
  assert.equal((JSON.parse(readFileSync(storePath, "utf8")) as TokenState).refreshToken, "keep-me");
});

test("a 401 that lands after another call already refreshed reuses that token", async (t) => {
  // Not coalesced by the single-flight refresh: by the time B's 401 arrives, A's refresh is over.
  let refreshCalls = 0;
  const { promise: aDone, resolve: releaseB } = Promise.withResolvers<void>();
  installFetch(
    t,
    mockFetch(async (url, init) => {
      if (url.includes("/oauth2/token")) {
        refreshCalls += 1;
        return jsonResponse({ access_token: "new", refresh_token: "r1", expires_in: 3600 });
      }
      const auth = (init?.headers as Record<string, string>)["Authorization"];
      if (auth === "Bearer old") {
        if (url.includes("/animelist")) await aDone;
        return jsonResponse({ error: "unauthorized" }, { status: 401 });
      }
      return jsonResponse({ id: 1, name: "tester", data: [], paging: {} });
    }),
  );
  const config = loadConfig({
    MAL_ACCESS_TOKEN: "old",
    MAL_CLIENT_ID: "id",
    MAL_REFRESH_TOKEN: "r0",
  });
  const client = new MalClient(config, silentLogger());
  const b = client.getMyAnimeList({});
  await client.getMyUserInfo();
  releaseB();
  await b;
  assert.equal(refreshCalls, 1);
});

test("a token that can't be saved still works, and login says it won't survive a restart", async (t) => {
  // The store's parent "directory" is a file, so every save fails.
  const blocker = tempStorePath("save-blocker");
  writeFileSync(blocker, "");
  t.after(() => rmSync(blocker, { force: true }));
  const store = new TokenStore(join(blocker, "tokens.json"), silentLogger());

  const port = await occupyPort(t);

  installFetch(
    t,
    mockFetch((url) =>
      url.includes("/oauth2/token")
        ? jsonResponse({ access_token: "acc", refresh_token: "ref", expires_in: 3600 })
        : jsonResponse({ id: 1, name: "me" }),
    ),
  );
  const config = loadConfig({ MAL_CLIENT_ID: "cid", MAL_OAUTH_PORT: String(port) });
  const client = new MalClient(config, silentLogger(), store);
  const { authorizeUrl } = await client.startLogin({ open: () => {} });
  const state = new URL(authorizeUrl).searchParams.get("state");
  const warning = await client.submitRedirect(
    `http://localhost:${port}/callback?code=C&state=${state}`,
  );
  assert.match(warning ?? "", /could not save/i);
  assert.equal((await client.getMyUserInfo()).name, "me");
});

describe("login callback listener", { timeout: 10_000 }, () => {
  function get(port: number, path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      httpGet({ host: "127.0.0.1", port, path }, (res) => {
        let body = "";
        res.on("data", (c: Buffer) => (body += c.toString()));
        res.on("end", () => resolve(body));
      }).on("error", reject);
    });
  }

  async function started(t: TestContext, port: number) {
    let exchanges = 0;
    installFetch(
      t,
      mockFetch((url) => {
        if (url.includes("/oauth2/token")) {
          exchanges += 1;
          return jsonResponse({ access_token: "acc", refresh_token: "ref", expires_in: 3600 });
        }
        return jsonResponse({ id: 1, name: "me" });
      }),
    );
    const config = loadConfig({ MAL_CLIENT_ID: "cid", MAL_OAUTH_PORT: String(port) });
    const client = new MalClient(config, silentLogger());
    const { authorizeUrl, listening } = await client.startLogin({ open: () => {} });
    assert.equal(listening, true);
    const state = new URL(authorizeUrl).searchParams.get("state")!;
    // A denial ends the login and closes the listener; a no-op if the test already finished it.
    t.after(() => get(port, `/callback?error=cleanup&state=${state}`).catch(() => undefined));
    return { client, state, exchanges: () => exchanges };
  }

  test("a redirect with the wrong state is not shown as a successful login", async (t) => {
    const port = await freePort();
    const { client } = await started(t, port);
    const page = await get(port, "/callback?code=X&state=forged");
    assert.doesNotMatch(page, /Logged in/);
    assert.equal(client.isConfigured(), false);
  });

  test("the same code arriving by listener and by paste is exchanged once, and both succeed", async (t) => {
    const port = await freePort();
    const { client, state, exchanges } = await started(t, port);
    const page = await get(port, `/callback?code=ONE&state=${state}`);
    assert.match(page, /Logged in/);
    await client.submitRedirect(`http://localhost:${port}/callback?code=ONE&state=${state}`);
    assert.equal(exchanges(), 1);
    assert.equal(client.isConfigured(), true);
  });

  test("a denied authorization ends the pending login", async (t) => {
    const port = await freePort();
    const { client, state } = await started(t, port);
    await get(port, `/callback?error=access_denied&state=${state}`);
    await assert.rejects(() => client.submitRedirect("BARECODE"), /no login in progress/i);
  });

  test("a port already taken on ::1 counts as busy, so the redirect isn't lost to that server", async (t) => {
    let port: number;
    try {
      port = await occupyPort(t, "::1");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EADDRNOTAVAIL" || code === "EAFNOSUPPORT") {
        return t.skip("no IPv6 loopback on this machine");
      }
      throw err;
    }
    const config = loadConfig({ MAL_CLIENT_ID: "cid", MAL_OAUTH_PORT: String(port) });
    const client = new MalClient(config, silentLogger());
    const { listening } = await client.startLogin({ open: () => {} });
    assert.equal(listening, false);
  });
});

test("a process with no token picks up a login another process saved", async (t) => {
  const storePath = tempStorePath("late-login");
  rmSync(storePath, { force: true });
  t.after(() => rmSync(storePath, { force: true }));
  installFetch(
    t,
    mockFetch((_url, init) => {
      const auth = (init?.headers as Record<string, string>)["Authorization"];
      return jsonResponse({ id: 1, name: "tester", used: auth });
    }),
  );
  const b = new MalClient(
    loadConfig({ MAL_CLIENT_ID: "id" }),
    silentLogger(),
    new TokenStore(storePath, silentLogger()),
  );
  assert.equal(b.isConfigured(), false);
  // login_mal ran in another client's server process.
  new TokenStore(storePath, silentLogger()).save({
    accessToken: "from-a",
    refreshToken: "r-a",
    expiresAt: Date.now() + 3_600_000,
  });
  assert.equal(b.isConfigured(), true);
  const res = (await b.getMyUserInfo()) as Record<string, unknown>;
  assert.equal(res["used"], "Bearer from-a");
});

test("a process locked out by a lost refresh race recovers once the winner saves", async (t) => {
  // MAL rejected B's spent token before A had written the rotated pair, so B found nothing newer
  // and wiped. A's save lands afterwards; B must not stay logged out until a restart.
  const storePath = tempStorePath("race-recover");
  rmSync(storePath, { force: true });
  t.after(() => rmSync(storePath, { force: true }));
  const store = new TokenStore(storePath, silentLogger());
  store.save({ accessToken: "a0", refreshToken: "r0", expiresAt: 0 });
  installFetch(
    t,
    mockFetch((url, init) => {
      if (url.includes("/oauth2/token"))
        return jsonResponse({ error: "invalid_grant" }, { status: 400 });
      const auth = (init?.headers as Record<string, string>)["Authorization"];
      return jsonResponse({ id: 1, name: "tester", used: auth });
    }),
  );
  const b = new MalClient(loadConfig({ MAL_CLIENT_ID: "id" }), silentLogger(), store);
  await assert.rejects(() => b.getMyUserInfo(), /login_mal/);
  assert.equal(b.isConfigured(), false);
  new TokenStore(storePath, silentLogger()).save({
    accessToken: "a1",
    refreshToken: "r1",
    expiresAt: Date.now() + 3_600_000,
  });
  const res = (await b.getMyUserInfo()) as Record<string, unknown>;
  assert.equal(res["used"], "Bearer a1");
});

test("a code exchange that failed on a blip can be retried with the same paste", async (t) => {
  const port = await occupyPort(t);
  let exchanges = 0;
  installFetch(
    t,
    mockFetch((url) => {
      if (url.includes("/oauth2/token")) {
        exchanges += 1;
        return exchanges === 1
          ? jsonResponse({ error: "boom" }, { status: 503 })
          : jsonResponse({ access_token: "acc", refresh_token: "ref", expires_in: 3600 });
      }
      return jsonResponse({ id: 1, name: "me" });
    }),
  );
  const client = new MalClient(
    loadConfig({ MAL_CLIENT_ID: "cid", MAL_OAUTH_PORT: String(port) }),
    silentLogger(),
  );
  const { authorizeUrl } = await client.startLogin({ open: () => {} });
  const state = new URL(authorizeUrl).searchParams.get("state");
  const redirect = `http://localhost:${port}/callback?code=C&state=${state}`;
  await assert.rejects(() => client.submitRedirect(redirect));
  await client.submitRedirect(redirect);
  assert.equal(exchanges, 2);
  assert.equal(client.isConfigured(), true);
});

test("the callback page says when the token couldn't be saved", { timeout: 10_000 }, async (t) => {
  const blocker = tempStorePath("page-save-blocker");
  writeFileSync(blocker, "");
  t.after(() => rmSync(blocker, { force: true }));
  installFetch(
    t,
    mockFetch(() => jsonResponse({ access_token: "acc", refresh_token: "ref", expires_in: 3600 })),
  );
  const port = await freePort();
  const config = loadConfig({ MAL_CLIENT_ID: "cid", MAL_OAUTH_PORT: String(port) });
  const client = new MalClient(
    config,
    silentLogger(),
    new TokenStore(join(blocker, "t.json"), silentLogger()),
  );
  const { authorizeUrl, listening } = await client.startLogin({ open: () => {} });
  assert.equal(listening, true);
  const state = new URL(authorizeUrl).searchParams.get("state");
  const page = await new Promise<string>((resolve, reject) => {
    httpGet({ host: "127.0.0.1", port, path: `/callback?code=C&state=${state}` }, (res) => {
      let body = "";
      res.on("data", (c: Buffer) => (body += c.toString()));
      res.on("end", () => resolve(body));
    }).on("error", reject);
  });
  assert.match(page, /could not be saved/);
});
