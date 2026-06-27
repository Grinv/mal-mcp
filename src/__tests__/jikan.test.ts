import { test } from "node:test";
import assert from "node:assert/strict";
import { JikanClient } from "../clients/jikan.js";
import { loadConfig } from "../config.js";
import { silentLogger, jsonResponse, mockFetch, installFetch } from "./helpers.js";

function jikan() {
  // No rate-limit delay in tests; small cache TTL.
  const config = loadConfig({ JIKAN_MIN_INTERVAL_MS: "0", CACHE_TTL_MS: "60000" });
  return new JikanClient(config, silentLogger());
}

test("searchAnime returns trimmed results and pagination", async () => {
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
  const restore = installFetch(mock);
  try {
    const res = (await jikan().searchAnime({ q: "frieren" })) as {
      results: Record<string, unknown>[];
      page: Record<string, unknown>;
    };
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0]!["title"], "Frieren");
    assert.deepEqual(res.results[0]!["genres"], ["Adventure"]);
    assert.equal(res.page["current_page"], 1);
    assert.match(mock.calls[0]!.url, /\/anime\?/);
    assert.match(mock.calls[0]!.url, /q=frieren/);
  } finally {
    restore();
  }
});

test("getAnime caches by id (second call hits cache, no second fetch)", async () => {
  const mock = mockFetch(() => jsonResponse({ data: { mal_id: 1, title: "Bebop" } }));
  const restore = installFetch(mock);
  try {
    const client = jikan();
    const a = (await client.getAnime(1)) as Record<string, unknown>;
    const b = (await client.getAnime(1)) as Record<string, unknown>;
    assert.equal(a["title"], "Bebop");
    assert.equal(b["title"], "Bebop");
    assert.equal(mock.calls.length, 1);
    assert.match(mock.calls[0]!.url, /\/anime\/1\/full$/);
  } finally {
    restore();
  }
});
