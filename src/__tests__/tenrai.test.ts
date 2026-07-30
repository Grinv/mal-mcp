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

test("getAnime/getManga forward sfw/sfw_strict to the /full endpoint", async (t) => {
  const mock = mockFetch(() => jsonResponse({ data: { mal_id: 1, title: "T" } }));
  installFetch(t, mock);
  await tenrai().getAnime(1, true, true);
  await tenrai().getManga(2, true, true);
  assert.match(mock.calls[0]!.url, /anime\/1\/full\?.*sfw=true/);
  assert.match(mock.calls[0]!.url, /sfw-strict=true/);
  assert.match(mock.calls[1]!.url, /manga\/2\/full\?.*sfw=true/);
  assert.match(mock.calls[1]!.url, /sfw-strict=true/);
});

test("getAnimeRecommendations/getMangaRecommendations forward sfw/sfw_strict", async (t) => {
  const mock = mockFetch(() => jsonResponse({ data: [] }));
  installFetch(t, mock);
  await tenrai().getAnimeRecommendations(1, true, true);
  await tenrai().getMangaRecommendations(2, true, true);
  assert.match(mock.calls[0]!.url, /anime\/1\/recommendations\?.*sfw=true/);
  assert.match(mock.calls[1]!.url, /manga\/2\/recommendations\?.*sfw=true/);
});

test("getAnimeNews forwards sfw/sfw_strict alongside page", async (t) => {
  const mock = mockFetch(() => jsonResponse({ data: [] }));
  installFetch(t, mock);
  await tenrai().getAnimeNews(1, 2, true, true);
  const url = mock.calls[0]!.url;
  assert.match(url, /page=2/);
  assert.match(url, /sfw=true/);
  assert.match(url, /sfw-strict=true/);
});

test("getMangaNews hits /manga/{id}/news, not the anime path", async (t) => {
  const mock = mockFetch(() => jsonResponse({ data: [] }));
  installFetch(t, mock);
  await tenrai().getMangaNews(3, 2, true, true);
  const url = mock.calls[0]!.url;
  assert.match(url, /\/manga\/3\/news\?/);
  assert.match(url, /page=2/);
  assert.match(url, /sfw=true/);
  assert.match(url, /sfw-strict=true/);
});

test("getCharacter/getPerson forward sfw/sfw_strict to the /full endpoint", async (t) => {
  const mock = mockFetch(() => jsonResponse({ data: { mal_id: 1, name: "N" } }));
  installFetch(t, mock);
  await tenrai().getCharacter(1, true, true);
  await tenrai().getPerson(2, true, true);
  assert.match(mock.calls[0]!.url, /characters\/1\/full\?.*sfw=true/);
  assert.match(mock.calls[1]!.url, /people\/2\/full\?.*sfw=true/);
});

test("searchAnime sends type/rating as comma-joined query params, not repeated keys", async (t) => {
  const mock = mockFetch(() => jsonResponse({ data: [] }));
  installFetch(t, mock);
  await tenrai().searchAnime({ q: "x", type: ["tv", "movie"], rating: ["pg13", "r17"] });
  const url = mock.calls[0]!.url;
  assert.match(url, /type=tv%2Cmovie/);
  assert.match(url, /rating=pg13%2Cr17/);
});

test("searchAnime forwards genres_exclude/producers/min_score/max_score/letter/start_date/end_date/unapproved", async (t) => {
  const mock = mockFetch(() => jsonResponse({ data: [] }));
  installFetch(t, mock);
  await tenrai().searchAnime({
    q: "x",
    genres_exclude: "9,49",
    producers: "1",
    min_score: 7,
    max_score: 9,
    letter: "a",
    start_date: "2020-01-01",
    end_date: "2020-12-31",
    unapproved: true,
  });
  const url = mock.calls[0]!.url;
  assert.match(url, /genres_exclude=9%2C49/);
  assert.match(url, /producers=1/);
  assert.match(url, /min_score=7/);
  assert.match(url, /max_score=9/);
  assert.match(url, /letter=a/);
  assert.match(url, /start_date=2020-01-01/);
  assert.match(url, /end_date=2020-12-31/);
  assert.match(url, /unapproved=true/);
});

test("getTopAnime sends type/rating as comma-joined query params", async (t) => {
  const mock = mockFetch(() => jsonResponse({ data: [] }));
  installFetch(t, mock);
  await tenrai().getTopAnime({ type: ["tv", "ova"], rating: ["g"] });
  const url = mock.calls[0]!.url;
  assert.match(url, /type=tv%2Cova/);
  assert.match(url, /rating=g/);
});

test("getSeason forwards filter/rating/unapproved/continuing/kids/order_by/sort", async (t) => {
  const mock = mockFetch(() => jsonResponse({ data: [] }));
  installFetch(t, mock);
  await tenrai().getSeason({
    year: 2024,
    season: "spring",
    filter: ["tv"],
    rating: ["pg13"],
    unapproved: true,
    continuing: true,
    kids: false,
    order_by: "score",
    sort: "asc",
  });
  const url = mock.calls[0]!.url;
  assert.match(url, /\/seasons\/2024\/spring/);
  assert.match(url, /filter=tv/);
  assert.match(url, /rating=pg13/);
  assert.match(url, /unapproved=true/);
  assert.match(url, /continuing=true/);
  assert.match(url, /kids=false/);
  assert.match(url, /order_by=score/);
  assert.match(url, /sort=asc/);
});

test("getSchedule forwards kids/unapproved/page", async (t) => {
  const mock = mockFetch(() => jsonResponse({ data: [] }));
  installFetch(t, mock);
  await tenrai().getSchedule({ day: "monday", limit: 5, kids: true, unapproved: false, page: 2 });
  const url = mock.calls[0]!.url;
  assert.match(url, /filter=monday/);
  assert.match(url, /kids=true/);
  assert.match(url, /unapproved=false/);
  assert.match(url, /page=2/);
});

test("getAnimeReviews forwards page/sort/preliminary/spoilers/sentiment as real query params", async (t) => {
  const mock = mockFetch(() => jsonResponse({ data: [] }));
  installFetch(t, mock);
  await tenrai().getAnimeReviews(1, 5, {
    page: 2,
    sort: "newest",
    preliminary: "false",
    spoilers: "only",
    sentiment: "recommended",
  });
  const url = mock.calls[0]!.url;
  assert.match(url, /\/anime\/1\/reviews\?/);
  assert.match(url, /page=2/);
  assert.match(url, /sort=newest/);
  assert.match(url, /preliminary=false/);
  assert.match(url, /spoilers=only/);
  assert.match(url, /sentiment=recommended/);
});

test("getAnimeReviews maps episodes_watched, is_spoiler, is_preliminary, reactions into the output", async (t) => {
  const mock = mockFetch(() =>
    jsonResponse({
      data: [
        {
          mal_id: 1,
          user: { username: "Someone" },
          score: 8,
          tags: ["Recommended"],
          date: "2024-01-01T00:00:00+00:00",
          review: "Great show.",
          url: "https://myanimelist.net/reviews.php?id=1",
          is_spoiler: false,
          is_preliminary: true,
          episodes_watched: 12,
          reactions: { nice: 3, funny: 1 },
        },
      ],
    }),
  );
  installFetch(t, mock);
  const res = (await tenrai().getAnimeReviews(1, 5)) as { reviews: Record<string, unknown>[] };
  const review = res.reviews[0]!;
  assert.equal(review["is_spoiler"], false);
  assert.equal(review["is_preliminary"], true);
  assert.equal(review["episodes_watched"], 12);
  assert.equal(review["chapters_read"], undefined);
  assert.deepEqual(review["reactions"], { nice: 3, funny: 1 });
});

test("getMangaReviews maps chapters_read (not episodes_watched) into the output", async (t) => {
  const mock = mockFetch(() =>
    jsonResponse({
      data: [
        {
          mal_id: 1,
          user: { username: "Someone" },
          score: 7,
          tags: [],
          review: "Good manga.",
          is_spoiler: true,
          is_preliminary: false,
          chapters_read: 30,
        },
      ],
    }),
  );
  installFetch(t, mock);
  const res = (await tenrai().getMangaReviews(1, 5)) as { reviews: Record<string, unknown>[] };
  const review = res.reviews[0]!;
  assert.equal(review["chapters_read"], 30);
  assert.equal(review["episodes_watched"], undefined);
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

test("getAnime caches sfw=true and sfw=false separately, since the response can differ", async (t) => {
  const mock = mockFetch(() => jsonResponse({ data: { mal_id: 1, title: "Bebop" } }));
  installFetch(t, mock);
  const client = tenrai();
  await client.getAnime(1);
  await client.getAnime(1, true);
  assert.equal(mock.calls.length, 2);
});

test("getProducer hits /producers/{id}/full and surfaces about/external", async (t) => {
  const mock = mockFetch(() =>
    jsonResponse({
      data: {
        mal_id: 14,
        titles: [{ type: "Default", title: "Sunrise" }],
        about: "A Japanese animation studio.",
        external: [{ name: "Official Site", url: "https://sunrise.example" }],
      },
    }),
  );
  installFetch(t, mock);
  const res = (await tenrai().getProducer(14)) as Record<string, unknown>;
  assert.equal(res["name"], "Sunrise");
  assert.equal(res["about"], "A Japanese animation studio.");
  assert.match(mock.calls[0]!.url, /\/producers\/14\/full$/);
});

test("getAnimeVideos hits /anime/{id}/videos and maps promo/episodes/music_videos", async (t) => {
  const mock = mockFetch(() =>
    jsonResponse({
      data: {
        promo: [{ title: "PV 1", trailer: { url: "https://youtube.com/watch?v=abc" } }],
        episodes: [{ mal_id: 1, title: "Ep 1", episode: "Episode 1", url: "u" }],
        music_videos: [],
      },
    }),
  );
  installFetch(t, mock);
  const res = (await tenrai().getAnimeVideos(1)) as { promo: Record<string, unknown>[] };
  assert.equal(res.promo[0]!["url"], "https://youtube.com/watch?v=abc");
  assert.match(mock.calls[0]!.url, /\/anime\/1\/videos$/);
});

test("getRecentAnimeRecommendations/getRecentMangaRecommendations hit the site-wide feed endpoints", async (t) => {
  const mock = mockFetch(() =>
    jsonResponse({
      data: [
        {
          entry: [
            { mal_id: 1, title: "A", url: "u1" },
            { mal_id: 2, title: "B", url: "u2" },
          ],
          content: "Great pair",
          user: { username: "bob" },
        },
      ],
      pagination: { last_visible_page: 5, has_next_page: true },
    }),
  );
  installFetch(t, mock);
  const anime = (await tenrai().getRecentAnimeRecommendations({ sfw: true, limit: 50 })) as {
    results: Record<string, unknown>[];
  };
  assert.equal(anime.results[0]!["content"], "Great pair");
  assert.match(mock.calls[0]!.url, /\/recommendations\/anime\?/);
  assert.match(mock.calls[0]!.url, /sfw=true/);
  assert.match(mock.calls[0]!.url, /limit=50/);

  const manga = (await tenrai().getRecentMangaRecommendations({})) as {
    results: Record<string, unknown>[];
  };
  assert.equal(manga.results[0]!["content"], "Great pair");
  assert.match(mock.calls[1]!.url, /\/recommendations\/manga/);
});

test("getNews hits the site-wide /news endpoint (not /anime/{id}/news)", async (t) => {
  const mock = mockFetch(() =>
    jsonResponse({
      data: [{ mal_id: 1, url: "u", title: "Big Announcement", date: "2024-01-01T00:00:00+00:00" }],
      pagination: {},
    }),
  );
  installFetch(t, mock);
  const res = (await tenrai().getNews({ q: "announcement" })) as {
    results: Record<string, unknown>[];
  };
  assert.equal(res.results[0]!["title"], "Big Announcement");
  assert.match(mock.calls[0]!.url, /\/news\?/);
  assert.match(mock.calls[0]!.url, /q=announcement/);
});
