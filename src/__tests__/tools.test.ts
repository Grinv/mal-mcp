import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { silentLogger, jsonResponse, mockFetch, installFetch } from "./helpers.js";

async function connect(env: NodeJS.ProcessEnv) {
  const server = buildServer(loadConfig(env), silentLogger());
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { server, client };
}

test("search_anime tool returns structured results end-to-end", async () => {
  const mock = mockFetch(() =>
    jsonResponse({
      data: [{ mal_id: 1, title: "Bebop", score: 8.7 }],
      pagination: { current_page: 1 },
    }),
  );
  const restore = installFetch(mock);
  const { client, server } = await connect({ JIKAN_MIN_INTERVAL_MS: "0" });
  try {
    const res = await client.callTool({ name: "search_anime", arguments: { q: "bebop" } });
    assert.notEqual(res.isError, true);
    const structured = res.structuredContent as { results: Record<string, unknown>[] };
    assert.equal(structured.results[0]!["title"], "Bebop");
  } finally {
    restore();
    await client.close();
    await server.close();
  }
});

test("new read tools are wired and return structured content end-to-end", async () => {
  // A generic list payload satisfies every list-shaped endpoint these tools hit.
  const mock = mockFetch(() =>
    jsonResponse({ data: [{ mal_id: 1, name: "Action", title: "T" }], pagination: {} }),
  );
  const restore = installFetch(mock);
  const { client, server } = await connect({ JIKAN_MIN_INTERVAL_MS: "0", CACHE_TTL_MS: "0" });
  try {
    const cases: [string, Record<string, unknown>, string][] = [
      ["get_anime_genres", {}, "genres"],
      ["get_manga_genres", { filter: "themes" }, "genres"],
      ["get_anime_episodes", { id: 1 }, "episodes"],
      ["get_manga_characters", { id: 1 }, "characters"],
      ["get_manga_recommendations", { id: 1 }, "recommendations"],
      ["get_manga_reviews", { id: 1 }, "reviews"],
      ["search_characters", { q: "spike" }, "results"],
      ["search_people", { q: "ito" }, "results"],
      ["get_anime_staff", { id: 1 }, "staff"],
      ["get_producers", {}, "results"],
      ["get_top_characters", {}, "results"],
      ["get_upcoming_season", {}, "results"],
      ["get_seasons_list", {}, "seasons"],
      ["get_anime_news", { id: 1 }, "results"],
    ];
    for (const [name, args, key] of cases) {
      const res = await client.callTool({ name, arguments: args });
      assert.notEqual(res.isError, true, `${name} errored`);
      assert.ok(
        Array.isArray((res.structuredContent as Record<string, unknown>)[key]),
        `${name} missing ${key}`,
      );
    }
  } finally {
    restore();
    await client.close();
    await server.close();
  }
});

test("personal-list tool without a token returns an actionable error", async () => {
  const { client, server } = await connect({});
  try {
    const res = await client.callTool({ name: "get_my_user_info", arguments: {} });
    assert.equal(res.isError, true);
    const text = (res.content as { type: string; text: string }[])[0]!.text;
    assert.match(text, /token/i);
    assert.match(text, /docs\/auth\.md/);
  } finally {
    await client.close();
    await server.close();
  }
});

test("personal-list tools work end-to-end with a token (exercises the MAL client)", async () => {
  const mock = mockFetch((url, init) => {
    if (init?.method === "PATCH") return jsonResponse({ status: "watching", score: 8 });
    if (init?.method === "DELETE") return jsonResponse({}, { status: 200 });
    // GET list endpoints (anime + manga share the shape).
    return jsonResponse({
      data: [{ node: { id: 1, title: "Bebop" }, list_status: { status: "completed" } }],
      paging: {},
    });
  });
  const restore = installFetch(mock);
  const { client, server } = await connect({ MAL_ACCESS_TOKEN: "tok" });
  try {
    const list = await client.callTool({
      name: "get_my_manga_list",
      arguments: { status: "reading" },
    });
    assert.notEqual(list.isError, true);
    assert.ok(Array.isArray((list.structuredContent as Record<string, unknown>)["items"]));

    const upd = await client.callTool({
      name: "update_my_anime_status",
      arguments: { anime_id: 1, status: "watching", score: 8, priority: 2, tags: "fav,rewatch" },
    });
    assert.notEqual(upd.isError, true);
    const patch = mock.calls.at(-1)!;
    assert.match(patch.url, /anime\/1\/my_list_status$/);
    // The new priority/tags fields are serialized into the form body.
    const body = patch.init?.body as string;
    assert.match(body, /priority=2/);
    assert.match(body, /tags=fav/);

    const del = await client.callTool({
      name: "delete_my_manga_list_item",
      arguments: { manga_id: 2 },
    });
    assert.notEqual(del.isError, true);
    assert.deepEqual(del.structuredContent, { deleted: true, manga_id: 2 });
  } finally {
    restore();
    await client.close();
    await server.close();
  }
});

test("the server advertises all expected tools", async () => {
  const { client, server } = await connect({});
  try {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    assert.ok(names.includes("search_anime"));
    assert.ok(names.includes("update_my_anime_status"));
    assert.ok(names.includes("get_anime_genres"));
    assert.ok(names.includes("get_manga_characters"));
    assert.ok(names.includes("get_anime_episodes"));
    assert.ok(names.includes("get_character"));
    assert.ok(names.includes("search_people"));
    assert.ok(names.includes("get_random_anime"));
    assert.ok(names.includes("get_producers"));
    assert.ok(names.includes("get_seasons_list"));
    assert.ok(names.includes("get_anime_news"));
    assert.equal(names.length, 43);
    // Destructive hint is set on deletions.
    const del = tools.find((t) => t.name === "delete_my_anime_list_item");
    assert.equal(del?.annotations?.destructiveHint, true);
  } finally {
    await client.close();
    await server.close();
  }
});
