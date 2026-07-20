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

test("topMangaOfficial falls back to ranking_type=all for a type with no ranking mapping", async (t) => {
  const config = loadConfig({ MAL_CLIENT_ID: "cid" });
  const mock = mockFetch(() => jsonResponse({ data: [] }));
  installFetch(t, mock);
  const client = new OfficialReadsClient(config, silentLogger());
  await client.topMangaOfficial({ type: "doujinshi" }); // neither a filter nor a mappable type
  const url = decodeURIComponent(mock.calls[0]!.url);
  assert.match(url, /ranking_type=all/);
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

test("animeRecommendationsOfficial requests the recommendations field and maps its shape", async (t) => {
  const config = loadConfig({ MAL_CLIENT_ID: "cid" });
  const mock = mockFetch(() =>
    jsonResponse({
      id: 1735,
      recommendations: [
        { node: { id: 20, title: "Naruto" }, num_recommendations: 12 },
        { node: { id: 21, title: "Bleach" }, num_recommendations: 3 },
      ],
    }),
  );
  installFetch(t, mock);
  const client = new OfficialReadsClient(config, silentLogger());
  const res = (await client.animeRecommendationsOfficial(1735)) as {
    recommendations: Record<string, unknown>[];
  };
  assert.deepEqual(res.recommendations[0], {
    mal_id: 20,
    title: "Naruto",
    votes: 12,
    url: "https://myanimelist.net/anime/20",
  });

  const call = mock.calls[0]!;
  const headers = call.init?.headers as Record<string, string>;
  assert.equal(headers["X-MAL-CLIENT-ID"], "cid");
  const url = decodeURIComponent(call.url);
  assert.match(url, /\/anime\/1735\?/);
  assert.match(url, /fields=recommendations/);
});

test("mangaRecommendationsOfficial hits manga/{id} and points url at /manga/", async (t) => {
  const config = loadConfig({ MAL_CLIENT_ID: "cid" });
  const mock = mockFetch(() =>
    jsonResponse({
      id: 2,
      recommendations: [{ node: { id: 583, title: "Claymore" }, num_recommendations: 15 }],
    }),
  );
  installFetch(t, mock);
  const client = new OfficialReadsClient(config, silentLogger());
  const res = (await client.mangaRecommendationsOfficial(2)) as {
    recommendations: Record<string, unknown>[];
  };
  assert.equal(res.recommendations[0]!["url"], "https://myanimelist.net/manga/583");
  assert.match(decodeURIComponent(mock.calls[0]!.url), /\/manga\/2\?/);
});

test("animeRecommendationsOfficial caps results at 25", async (t) => {
  const config = loadConfig({ MAL_CLIENT_ID: "cid" });
  const many = Array.from({ length: 30 }, (_, i) => ({
    node: { id: i, title: `Anime ${i}` },
    num_recommendations: 1,
  }));
  const mock = mockFetch(() => jsonResponse({ id: 1, recommendations: many }));
  installFetch(t, mock);
  const client = new OfficialReadsClient(config, silentLogger());
  const res = (await client.animeRecommendationsOfficial(1)) as {
    recommendations: Record<string, unknown>[];
  };
  assert.equal(res.recommendations.length, 25);
});

test("animeDetailsOfficial maps the detail-mode fields onto Jikan's `detailed: true` shape", async (t) => {
  const config = loadConfig({ MAL_CLIENT_ID: "cid" });
  const mock = mockFetch(() =>
    jsonResponse({
      id: 31646,
      title: "3-gatsu no Lion",
      alternative_titles: { en: "March Comes In Like a Lion", ja: "3月のライオン" },
      media_type: "tv",
      status: "finished_airing",
      mean: 8.37,
      genres: [{ name: "Drama" }],
      num_episodes: 22,
      source: "manga",
      average_episode_duration: 1440,
      broadcast: { day_of_the_week: "wednesday", start_time: "22:56" },
      background: "Some background text.",
      num_scoring_users: 12345,
      related_anime: [
        {
          node: { id: 35180, title: "3-gatsu no Lion 2nd Season" },
          relation_type_formatted: "Sequel",
        },
      ],
      studios: [{ name: "Shaft" }],
    }),
  );
  installFetch(t, mock);
  const client = new OfficialReadsClient(config, silentLogger());
  const res = await client.animeDetailsOfficial(31646);
  assert.equal(res["title_japanese"], "3月のライオン");
  assert.equal(res["source"], "Manga");
  assert.equal(res["duration"], "24 min per ep");
  assert.equal(res["broadcast"], "Wednesdays at 22:56 (JST)");
  assert.equal(res["scored_by"], 12345);
  assert.equal(res["background"], "Some background text.");
  assert.deepEqual(res["relations"], [
    { relation: "Sequel", entries: ["3-gatsu no Lion 2nd Season"] },
  ]);
  // Fields with no official-API equivalent are simply absent, not present-but-empty.
  assert.equal("producers" in res, false);
  assert.equal("streaming" in res, false);
  assert.equal("trailer" in res, false);
  assert.equal("favorites" in res, false);

  const call = mock.calls[0]!;
  const headers = call.init?.headers as Record<string, string>;
  assert.equal(headers["X-MAL-CLIENT-ID"], "cid");
  const url = decodeURIComponent(call.url);
  assert.match(url, /\/anime\/31646\?/);
  assert.match(url, /fields=[^&]*\bsource\b/);
});

test("mangaDetailsOfficial maps serialization and related entries", async (t) => {
  const config = loadConfig({ MAL_CLIENT_ID: "cid" });
  const mock = mockFetch(() =>
    jsonResponse({
      id: 2,
      title: "Berserk",
      status: "currently_publishing",
      num_scoring_users: 999,
      background: "Manga background.",
      serialization: [{ node: { name: "Young Animal" } }],
      related_manga: [
        { node: { id: 3, title: "Berserk: Prototype" }, relation_type_formatted: "Prequel" },
      ],
    }),
  );
  installFetch(t, mock);
  const client = new OfficialReadsClient(config, silentLogger());
  const res = await client.mangaDetailsOfficial(2);
  assert.equal(res["publishing"], true);
  assert.equal(res["scored_by"], 999);
  assert.deepEqual(res["serializations"], ["Young Animal"]);
  assert.deepEqual(res["relations"], [{ relation: "Prequel", entries: ["Berserk: Prototype"] }]);
});

test("animeStatisticsOfficial maps watch-status counts and never fabricates a score histogram", async (t) => {
  const config = loadConfig({ MAL_CLIENT_ID: "cid" });
  const mock = mockFetch(() =>
    jsonResponse({
      id: 1,
      statistics: {
        num_list_users: 57150,
        status: { watching: 100, completed: 56000, on_hold: 200, dropped: 300, plan_to_watch: 550 },
      },
    }),
  );
  installFetch(t, mock);
  const client = new OfficialReadsClient(config, silentLogger());
  const res = await client.animeStatisticsOfficial(1);
  assert.deepEqual(res, {
    watching: 100,
    completed: 56000,
    on_hold: 200,
    dropped: 300,
    plan_to_watch: 550,
    total: 57150,
  });
  assert.equal("scores" in res, false);

  const call = mock.calls[0]!;
  const headers = call.init?.headers as Record<string, string>;
  assert.equal(headers["X-MAL-CLIENT-ID"], "cid");
  const url = decodeURIComponent(call.url);
  assert.match(url, /\/anime\/1\?/);
  assert.match(url, /fields=statistics/);
});

test("official reads throw without a configured client id", async () => {
  const client = new OfficialReadsClient(loadConfig({}), silentLogger());
  await assert.rejects(() => client.searchAnimeOfficial({ q: "naruto" }), /MAL_CLIENT_ID/);
  await assert.rejects(() => client.animeRecommendationsOfficial(1), /MAL_CLIENT_ID/);
  await assert.rejects(() => client.animeDetailsOfficial(1), /MAL_CLIENT_ID/);
  await assert.rejects(() => client.animeStatisticsOfficial(1), /MAL_CLIENT_ID/);
  assert.equal(client.hasClientId(), false);
});
