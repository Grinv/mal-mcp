import { test } from "node:test";
import assert from "node:assert/strict";
import { TenraiClient } from "../clients/tenrai.js";
import { loadConfig } from "../config.js";
import { silentLogger, jsonResponse, mockFetch, installFetch } from "./helpers.js";

function tenrai() {
  // No rate-limit delay in tests; small cache TTL.
  const config = loadConfig({ TENRAI_MIN_INTERVAL_MS: "0", CACHE_TTL_MS: "60000" });
  return new TenraiClient(config, silentLogger());
}

test("searchAnime returns trimmed results and pagination", async (t) => {
  const mock = mockFetch(() =>
    jsonResponse({
      data: [
        {
          mal_id: 52991,
          title: "Frieren",
          type: "tv",
          score: 9.3,
          genres: [{ name: "Adventure" }],
        },
      ],
      pagination: { current_page: 1, has_next_page: false, items: { total: 1 } },
    }),
  );
  installFetch(t, mock);
  const res = (await tenrai().searchAnime({ q: "frieren" })) as {
    results: Record<string, unknown>[];
    page: Record<string, unknown>;
  };
  assert.equal(res.results.length, 1);
  assert.equal(res.results[0]!["title"], "Frieren");
  assert.deepEqual(res.results[0]!["genres"], ["Adventure"]);
  assert.equal(res.page["current_page"], 1);
  assert.match(mock.calls[0]!.url, /\/anime\?/);
  assert.match(mock.calls[0]!.url, /q=frieren/);
});

test("searchAnime sends sfw_strict as the hyphenated sfw-strict query param", async (t) => {
  const mock = mockFetch(() => jsonResponse({ data: [] }));
  installFetch(t, mock);
  await tenrai().searchAnime({ q: "x", sfw: true, sfw_strict: true });
  const url = mock.calls[0]!.url;
  assert.match(url, /sfw=true/);
  assert.match(url, /sfw-strict=true/);
  // The underscored field name itself must never leak into the outgoing request.
  assert.doesNotMatch(url, /sfw_strict=/);
});

test("getRandomAnime forwards sfw/sfw_strict as query params", async (t) => {
  const mock = mockFetch(() => jsonResponse({ data: { mal_id: 1, title: "T" } }));
  installFetch(t, mock);
  await tenrai().getRandomAnime(true, true);
  const url = mock.calls[0]!.url;
  assert.match(url, /sfw=true/);
  assert.match(url, /sfw-strict=true/);
});

test("getAnime caches by id (second call hits cache, no second fetch)", async (t) => {
  const mock = mockFetch(() => jsonResponse({ data: { mal_id: 1, title: "Bebop" } }));
  installFetch(t, mock);
  const client = tenrai();
  const a = (await client.getAnime(1)) as Record<string, unknown>;
  const b = (await client.getAnime(1)) as Record<string, unknown>;
  assert.equal(a["title"], "Bebop");
  assert.equal(b["title"], "Bebop");
  assert.equal(mock.calls.length, 1);
  assert.match(mock.calls[0]!.url, /\/anime\/1\/full$/);
});
