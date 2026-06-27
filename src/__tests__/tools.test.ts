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

test("the server advertises all expected tools", async () => {
  const { client, server } = await connect({});
  try {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    assert.ok(names.includes("search_anime"));
    assert.ok(names.includes("update_my_anime_status"));
    assert.equal(names.length, 20);
    // Destructive hint is set on deletions.
    const del = tools.find((t) => t.name === "delete_my_anime_list_item");
    assert.equal(del?.annotations?.destructiveHint, true);
  } finally {
    await client.close();
    await server.close();
  }
});
