import { test } from "node:test";
import assert from "node:assert/strict";
import { OfficialReadsClient } from "../clients/officialReads.js";
import { loadConfig } from "../config.js";
import { silentLogger, jsonResponse, mockFetch, installFetch } from "./helpers.js";

test("searchAnimeOfficial sends the Client ID header and maps the official response shape", async (t) => {
  const config = loadConfig({ MAL_CLIENT_ID: "cid" });
  const mock = mockFetch(() =>
    jsonResponse({
      data: [
        {
          node: {
            id: 1735,
            title: "Naruto: Shippuuden",
            alternative_titles: { en: "Naruto Shippuden" },
            media_type: "tv",
            status: "finished_airing",
            mean: 8.29,
            genres: [{ id: 1, name: "Action" }],
            num_episodes: 500,
          },
        },
      ],
      paging: { next: "https://api/next" },
    }),
  );
  installFetch(t, mock);
  const client = new OfficialReadsClient(config, silentLogger());
  const res = (await client.searchAnimeOfficial({ q: "naruto", limit: 5, page: 2 })) as {
    results: Record<string, unknown>[];
    page: { has_next_page: boolean };
  };
  assert.equal(res.results[0]!["title"], "Naruto: Shippuuden");
  assert.equal(res.results[0]!["title_english"], "Naruto Shippuden");
  assert.equal(res.results[0]!["status"], "Finished Airing");
  assert.equal(res.results[0]!["url"], "https://myanimelist.net/anime/1735");
  assert.equal(res.page.has_next_page, true);

  const call = mock.calls[0]!;
  const headers = call.init?.headers as Record<string, string>;
  assert.equal(headers["X-MAL-CLIENT-ID"], "cid");
  const url = decodeURIComponent(call.url);
  assert.match(url, /\/anime\?/);
  assert.match(url, /q=naruto/);
  assert.match(url, /limit=5/);
  assert.match(url, /offset=5/); // page 2, limit 5 → offset 5
});

test("searchMangaOfficial maps authors and manga-specific fields", async (t) => {
  const config = loadConfig({ MAL_CLIENT_ID: "cid" });
  const mock = mockFetch(() =>
    jsonResponse({
      data: [
        {
          node: {
            id: 11,
            title: "Naruto",
            media_type: "manga",
            status: "finished",
            num_chapters: 700,
            num_volumes: 72,
            authors: [{ node: { first_name: "Masashi", last_name: "Kishimoto" } }],
          },
        },
      ],
      paging: {},
    }),
  );
  installFetch(t, mock);
  const client = new OfficialReadsClient(config, silentLogger());
  const res = (await client.searchMangaOfficial({ q: "naruto" })) as {
    results: Record<string, unknown>[];
    page: { has_next_page: boolean };
  };
  assert.equal(res.results[0]!["status"], "Finished");
  assert.deepEqual(res.results[0]!["authors"], ["Masashi Kishimoto"]);
  assert.equal(res.page.has_next_page, false); // no `paging.next`
});

test("topAnimeOfficial maps `filter` to the official ranking_type and hits anime/ranking", async (t) => {
  const config = loadConfig({ MAL_CLIENT_ID: "cid" });
  const mock = mockFetch(() => jsonResponse({ data: [{ node: { id: 1, title: "Top" } }] }));
  installFetch(t, mock);
  const client = new OfficialReadsClient(config, silentLogger());
  await client.topAnimeOfficial({ filter: "favorite" });
  const url = decodeURIComponent(mock.calls[0]!.url);
  assert.match(url, /\/anime\/ranking\?/);
  assert.match(url, /ranking_type=favorite/);
});

test("topAnimeOfficial falls back to ranking_type=all for a filter the official API doesn't support", async (t) => {
  const config = loadConfig({ MAL_CLIENT_ID: "cid" });
  const mock = mockFetch(() => jsonResponse({ data: [] }));
  installFetch(t, mock);
  const client = new OfficialReadsClient(config, silentLogger());
  await client.topAnimeOfficial({ type: "music" }); // not a valid official ranking_type
  const url = decodeURIComponent(mock.calls[0]!.url);
  assert.match(url, /ranking_type=all/);
});

test("topMangaOfficial maps Jikan's `lightnovel` type onto the official `novels` ranking_type", async (t) => {
  const config = loadConfig({ MAL_CLIENT_ID: "cid" });
  const mock = mockFetch(() => jsonResponse({ data: [] }));
  installFetch(t, mock);
  const client = new OfficialReadsClient(config, silentLogger());
  await client.topMangaOfficial({ type: "lightnovel" });
  const url = decodeURIComponent(mock.calls[0]!.url);
  assert.match(url, /\/manga\/ranking\?/);
  assert.match(url, /ranking_type=novels/);
});

test("seasonOfficial hits anime/season/{year}/{season}", async (t) => {
  const config = loadConfig({ MAL_CLIENT_ID: "cid" });
  const mock = mockFetch(() => jsonResponse({ data: [{ node: { id: 1, title: "Seasonal" } }] }));
  installFetch(t, mock);
  const client = new OfficialReadsClient(config, silentLogger());
  const res = (await client.seasonOfficial(2024, "fall", {})) as {
    results: Record<string, unknown>[];
  };
  assert.equal(res.results[0]!["title"], "Seasonal");
  assert.match(mock.calls[0]!.url, /\/anime\/season\/2024\/fall\?/);
});

test("searchAnimeOfficial requests the nsfw field so sfw filtering is possible", async (t) => {
  const config = loadConfig({ MAL_CLIENT_ID: "cid" });
  const mock = mockFetch(() => jsonResponse({ data: [] }));
  installFetch(t, mock);
  const client = new OfficialReadsClient(config, silentLogger());
  await client.searchAnimeOfficial({ q: "x" });
  const url = decodeURIComponent(mock.calls[0]!.url);
  assert.match(url, /fields=[^&]*\bnsfw\b/);
});

test("searchAnimeOfficial with sfw:true excludes anything not explicitly nsfw=white", async (t) => {
  const config = loadConfig({ MAL_CLIENT_ID: "cid" });
  const mock = mockFetch(() =>
    jsonResponse({
      data: [
        { node: { id: 1, title: "Safe", nsfw: "white" } },
        { node: { id: 2, title: "Suggestive", nsfw: "gray" } },
        { node: { id: 3, title: "Explicit", nsfw: "black" } },
        { node: { id: 4, title: "Unlabeled" } }, // no nsfw field at all — fail closed, excluded
      ],
    }),
  );
  installFetch(t, mock);
  const client = new OfficialReadsClient(config, silentLogger());
  const res = (await client.searchAnimeOfficial({ q: "x", sfw: true })) as {
    results: Record<string, unknown>[];
  };
  assert.deepEqual(
    res.results.map((r) => r["title"]),
    ["Safe"],
  );
});

test("searchAnimeOfficial without sfw returns every result regardless of nsfw rating", async (t) => {
  const config = loadConfig({ MAL_CLIENT_ID: "cid" });
  const mock = mockFetch(() =>
    jsonResponse({
      data: [
        { node: { id: 1, title: "Safe", nsfw: "white" } },
        { node: { id: 2, title: "Explicit", nsfw: "black" } },
      ],
    }),
  );
  installFetch(t, mock);
  const client = new OfficialReadsClient(config, silentLogger());
  const res = (await client.searchAnimeOfficial({ q: "x" })) as {
    results: Record<string, unknown>[];
  };
  assert.equal(res.results.length, 2);
});

test("seasonOfficial honors sfw the same way as search", async (t) => {
  const config = loadConfig({ MAL_CLIENT_ID: "cid" });
  const mock = mockFetch(() =>
    jsonResponse({
      data: [
        { node: { id: 1, title: "Safe", nsfw: "white" } },
        { node: { id: 2, title: "Explicit", nsfw: "black" } },
      ],
    }),
  );
  installFetch(t, mock);
  const client = new OfficialReadsClient(config, silentLogger());
  const res = (await client.seasonOfficial(2024, "fall", { sfw: true })) as {
    results: Record<string, unknown>[];
  };
  assert.deepEqual(
    res.results.map((r) => r["title"]),
    ["Safe"],
  );
});

test("official reads throw without a configured client id", async () => {
  const client = new OfficialReadsClient(loadConfig({}), silentLogger());
  await assert.rejects(() => client.searchAnimeOfficial({ q: "naruto" }), /MAL_CLIENT_ID/);
  assert.equal(client.hasClientId(), false);
});
