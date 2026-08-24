import { test } from "node:test";
import assert from "node:assert/strict";
import { jsonResponse, mockFetch, installFetch, connectServer, toolText } from "./helpers.js";

test("search_anime tool returns structured results end-to-end", async (t) => {
  const mock = mockFetch(() =>
    jsonResponse({
      data: [{ mal_id: 1, title: "Bebop", score: 8.7 }],
      pagination: { current_page: 1 },
    }),
  );
  installFetch(t, mock);
  const { client, close } = await connectServer({ TENRAI_MIN_INTERVAL_MS: "0" });
  t.after(close);
  const res = await client.callTool({ name: "search_anime", arguments: { q: "bebop" } });
  assert.notEqual(res.isError, true);
  const structured = res.structuredContent as { results: Record<string, unknown>[] };
  assert.equal(structured.results[0]!["title"], "Bebop");
});

test("new read tools are wired and return structured content end-to-end", async (t) => {
  // A generic list payload satisfies every list-shaped endpoint these tools hit — except
  // get_manga_characters/get_anime_staff/get_manga_recommendations/get_seasons_list, which read
  // a nested character/person/entry.mal_id or a year (see the dedicated test below) rather than
  // this shape's flat mal_id.
  const mock = mockFetch(() =>
    jsonResponse({ data: [{ mal_id: 1, name: "Action", title: "T" }], pagination: {} }),
  );
  installFetch(t, mock);
  const { client, close } = await connectServer({ TENRAI_MIN_INTERVAL_MS: "0", CACHE_TTL_MS: "0" });
  t.after(close);
  const cases: [string, Record<string, unknown>, string][] = [
    ["get_anime_genres", {}, "genres"],
    ["get_manga_genres", { filter: "themes" }, "genres"],
    ["get_anime_episodes", { id: 1 }, "episodes"],
    ["get_manga_reviews", { id: 1 }, "reviews"],
    ["search_characters", { q: "spike" }, "results"],
    ["search_people", { q: "ito" }, "results"],
    ["get_producers", {}, "results"],
    ["get_magazines", {}, "results"],
    ["get_top_characters", {}, "results"],
    ["get_upcoming_season", {}, "results"],
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
});

test("get_manga_characters/get_anime_staff/get_manga_recommendations/get_seasons_list return structured content with their real nested shape", async (t) => {
  const mock = mockFetch((url) => {
    if (url.includes("/characters")) {
      return jsonResponse({
        data: [{ character: { mal_id: 1, name: "Spike", url: "u" }, role: "Main" }],
      });
    }
    if (url.includes("/recommendations")) {
      return jsonResponse({
        data: [{ entry: { mal_id: 3, title: "Berserk", url: "u" }, votes: 5 }],
      });
    }
    if (/\/seasons(\?|$)/.test(url)) {
      return jsonResponse({ data: [{ year: 2024, seasons: ["winter", "spring"] }] });
    }
    return jsonResponse({
      data: [{ person: { mal_id: 2, name: "Watanabe", url: "u" }, positions: ["Director"] }],
    });
  });
  installFetch(t, mock);
  const { client, close } = await connectServer({ TENRAI_MIN_INTERVAL_MS: "0", CACHE_TTL_MS: "0" });
  t.after(close);

  const characters = await client.callTool({ name: "get_manga_characters", arguments: { id: 1 } });
  assert.notEqual(characters.isError, true);
  const characterList = (characters.structuredContent as { characters: { mal_id: number }[] })
    .characters;
  assert.equal(characterList[0]!.mal_id, 1);

  const staff = await client.callTool({ name: "get_anime_staff", arguments: { id: 1 } });
  assert.notEqual(staff.isError, true);
  const staffList = (staff.structuredContent as { staff: { mal_id: number }[] }).staff;
  assert.equal(staffList[0]!.mal_id, 2);

  const seasons = await client.callTool({ name: "get_seasons_list", arguments: {} });
  assert.notEqual(seasons.isError, true);
  const seasonsList = (seasons.structuredContent as { seasons: { year: number }[] }).seasons;
  assert.equal(seasonsList[0]!.year, 2024);

  const recs = await client.callTool({ name: "get_manga_recommendations", arguments: { id: 1 } });
  assert.notEqual(recs.isError, true);
  const recsList = (recs.structuredContent as { recommendations: { mal_id: number }[] })
    .recommendations;
  assert.equal(recsList[0]!.mal_id, 3);
});

test("personal-list tool without a token returns an actionable error", async (t) => {
  const { client, close } = await connectServer({});
  t.after(close);
  const res = await client.callTool({ name: "get_my_user_info", arguments: {} });
  assert.equal(res.isError, true);
  const text = toolText(res);
  assert.match(text, /token/i);
  assert.match(text, /docs\/auth\.md/);
});

test("personal-list tools work end-to-end with a token (exercises the MAL client)", async (t) => {
  const mock = mockFetch((url, init) => {
    if (init?.method === "PATCH") return jsonResponse({ status: "watching", score: 8 });
    if (init?.method === "DELETE") return jsonResponse({}, { status: 200 });
    // GET list endpoints (anime + manga share the shape).
    return jsonResponse({
      data: [{ node: { id: 1, title: "Bebop" }, list_status: { status: "completed" } }],
      paging: {},
    });
  });
  installFetch(t, mock);
  const { client, close } = await connectServer({ MAL_ACCESS_TOKEN: "tok" });
  t.after(close);
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
});

test("update_my_anime_status/update_my_manga_status reject a bare id with no other fields", async (t) => {
  const mock = mockFetch(() => jsonResponse({ status: "watching" }));
  installFetch(t, mock);
  const { client, close } = await connectServer({ MAL_ACCESS_TOKEN: "tok" });
  t.after(close);

  const anime = await client.callTool({
    name: "update_my_anime_status",
    arguments: { anime_id: 1 },
  });
  assert.equal(anime.isError, true);
  assert.match(toolText(anime), /at least one field besides anime_id/);

  const manga = await client.callTool({
    name: "update_my_manga_status",
    arguments: { manga_id: 1 },
  });
  assert.equal(manga.isError, true);
  assert.match(toolText(manga), /at least one field besides manga_id/);

  // Neither call should have reached the upstream API.
  assert.equal(mock.calls.length, 0);
});

test("unknown/misspelled parameters are rejected, not silently dropped", async (t) => {
  const mock = mockFetch(() =>
    jsonResponse({ data: [{ mal_id: 1, title: "Bebop", score: 8.7 }], pagination: {} }),
  );
  installFetch(t, mock);
  const { client, close } = await connectServer({ MAL_ACCESS_TOKEN: "tok" });
  t.after(close);

  // A typo'd param on a read tool must error, not be silently ignored.
  const read = await client.callTool({
    name: "search_anime",
    arguments: { q: "bebop", paeg: 2 },
  });
  assert.equal(read.isError, true);
  assert.equal(mock.calls.length, 0);

  // The exact shape that caused a live incident during this audit: a bogus
  // field alongside a real one on a mutation tool must reject the whole call
  // rather than silently drop the bogus field and apply the real one.
  const mutate = await client.callTool({
    name: "update_my_anime_status",
    arguments: { anime_id: 1, status: "watching", bogus_field: "x" },
  });
  assert.equal(mutate.isError, true);
  assert.equal(mock.calls.length, 0);
});

test("search_anime/search_manga reject a malformed genres parameter", async (t) => {
  const mock = mockFetch(() =>
    jsonResponse({ data: [{ mal_id: 1, title: "Bebop", score: 8.7 }], pagination: {} }),
  );
  installFetch(t, mock);
  const { client, close } = await connectServer({});
  t.after(close);

  const anime = await client.callTool({
    name: "search_anime",
    arguments: { q: "bebop", genres: "1, 4" },
  });
  assert.equal(anime.isError, true);
  assert.equal(mock.calls.length, 0);

  const manga = await client.callTool({
    name: "search_manga",
    arguments: { q: "bebop", genres: "abc" },
  });
  assert.equal(manga.isError, true);
  assert.equal(mock.calls.length, 0);

  // The documented format (digits, comma-separated, no spaces) still works.
  const ok = await client.callTool({
    name: "search_anime",
    arguments: { q: "bebop", genres: "1,4" },
  });
  assert.notEqual(ok.isError, true);
});

test("the server advertises all expected tools", async (t) => {
  const { client, close } = await connectServer({});
  t.after(close);
  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name);
  assert.ok(names.includes("search_anime"));
  assert.ok(names.includes("update_my_anime_status"));
  assert.ok(names.includes("get_anime_genres"));
  assert.ok(names.includes("get_manga_characters"));
  assert.ok(names.includes("get_anime_episodes"));
  assert.ok(names.includes("get_character"));
  assert.ok(names.includes("search_people"));
  assert.ok(names.includes("get_random_anime"));
  assert.ok(names.includes("get_producers"));
  assert.ok(names.includes("get_producer"));
  assert.ok(names.includes("get_magazines"));
  assert.ok(names.includes("get_anime_videos"));
  assert.ok(names.includes("get_recent_anime_recommendations"));
  assert.ok(names.includes("get_recent_manga_recommendations"));
  assert.ok(names.includes("get_news"));
  assert.ok(names.includes("get_seasons_list"));
  assert.ok(names.includes("get_anime_news"));
  assert.ok(names.includes("get_manga_news"));
  assert.ok(names.includes("login_mal"));
  assert.ok(names.includes("submit_mal_redirect"));
  assert.ok(names.includes("get_interest_stacks"));
  assert.ok(names.includes("get_interest_stack"));
  assert.ok(names.includes("get_anime_interest_stacks"));
  assert.ok(names.includes("get_manga_interest_stacks"));
  assert.equal(names.length, 54);
  // Destructive hint is set on deletions.
  const del = tools.find((tool) => tool.name === "delete_my_anime_list_item");
  assert.equal(del?.annotations?.destructiveHint, true);
});

test("search queries are trimmed, so a whitespace-only q is rejected", async (t) => {
  const mock = mockFetch(() =>
    jsonResponse({ data: [{ mal_id: 1, title: "Bebop" }], pagination: {} }),
  );
  installFetch(t, mock);
  const { client, close } = await connectServer({});
  t.after(close);

  const res = await client.callTool({ name: "search_anime", arguments: { q: "   " } });
  assert.equal(res.isError, true);
  assert.equal(mock.calls.length, 0);
});

test("get_anime_schedule defaults its limit when omitted", async (t) => {
  const mock = mockFetch(() => jsonResponse({ data: [], pagination: {} }));
  installFetch(t, mock);
  const { client, close } = await connectServer({});
  t.after(close);

  const schedule = await client.callTool({ name: "get_anime_schedule", arguments: {} });
  assert.notEqual(schedule.isError, true);
  assert.match(mock.calls.at(-1)!.url, /limit=25(&|$)/);
});

test("search_anime's limit cap is 50, matching Tenrai's real per-page ceiling", async (t) => {
  const mock = mockFetch(() => jsonResponse({ data: [], pagination: {} }));
  installFetch(t, mock);
  const { client, close } = await connectServer({});
  t.after(close);

  const atCap = await client.callTool({ name: "search_anime", arguments: { q: "x", limit: 50 } });
  assert.notEqual(atCap.isError, true);

  const overCap = await client.callTool({
    name: "search_anime",
    arguments: { q: "x", limit: 51 },
  });
  assert.equal(overCap.isError, true);
});

test("get_anime_schedule accepts Tenrai's unknown/other day buckets", async (t) => {
  const mock = mockFetch(() => jsonResponse({ data: [], pagination: {} }));
  installFetch(t, mock);
  const { client, close } = await connectServer({});
  t.after(close);

  for (const day of ["unknown", "other"]) {
    const res = await client.callTool({ name: "get_anime_schedule", arguments: { day } });
    assert.notEqual(res.isError, true, `day=${day} should be accepted`);
    assert.match(mock.calls.at(-1)!.url, new RegExp(`filter=${day}(&|$)`));
  }
});

test("search_anime/search_manga accept Tenrai's full order_by enum (mal_id, end_date, scored_by)", async (t) => {
  const mock = mockFetch(() => jsonResponse({ data: [], pagination: {} }));
  installFetch(t, mock);
  const { client, close } = await connectServer({});
  t.after(close);

  for (const order_by of ["mal_id", "end_date", "scored_by"]) {
    const anime = await client.callTool({
      name: "search_anime",
      arguments: { q: "x", order_by },
    });
    assert.notEqual(anime.isError, true, `search_anime order_by=${order_by} should be accepted`);

    const manga = await client.callTool({
      name: "search_manga",
      arguments: { q: "x", order_by },
    });
    assert.notEqual(manga.isError, true, `search_manga order_by=${order_by} should be accepted`);
  }
});

test("get_anime_reviews applies limit client-side (Tenrai's /reviews has no limit param)", async (t) => {
  const eightReviews = Array.from({ length: 8 }, (_, i) => ({ mal_id: i, score: 8 }));
  const mock = mockFetch(() => jsonResponse({ data: eightReviews, pagination: {} }));
  installFetch(t, mock);
  const { client, close } = await connectServer({});
  t.after(close);

  const defaulted = await client.callTool({ name: "get_anime_reviews", arguments: { id: 1 } });
  assert.notEqual(defaulted.isError, true);
  assert.equal((defaulted.structuredContent as { reviews: unknown[] }).reviews.length, 5);
  // Tenrai has no `limit` query param for this route — confirm we don't send one.
  assert.doesNotMatch(mock.calls.at(-1)!.url, /limit=/);

  const explicit = await client.callTool({
    name: "get_anime_reviews",
    arguments: { id: 1, limit: 10 },
  });
  assert.notEqual(explicit.isError, true);
  // Only 8 reviews exist upstream; asking for 10 doesn't fabricate more.
  assert.equal((explicit.structuredContent as { reviews: unknown[] }).reviews.length, 8);
});

test("get_anime_reviews/get_manga_reviews accept sort/preliminary/spoilers/sentiment and reject bad values", async (t) => {
  const mock = mockFetch(() => jsonResponse({ data: [], pagination: {} }));
  installFetch(t, mock);
  const { client, close } = await connectServer({});
  t.after(close);

  const ok = await client.callTool({
    name: "get_anime_reviews",
    arguments: {
      id: 1,
      page: 2,
      sort: "newest",
      preliminary: "only",
      spoilers: "false",
      sentiment: "mixed_feelings",
    },
  });
  assert.notEqual(ok.isError, true);
  assert.match(mock.calls.at(-1)!.url, /sort=newest/);
  assert.match(mock.calls.at(-1)!.url, /preliminary=only/);
  assert.match(mock.calls.at(-1)!.url, /spoilers=false/);
  assert.match(mock.calls.at(-1)!.url, /sentiment=mixed_feelings/);

  const badPreliminary = await client.callTool({
    name: "get_manga_reviews",
    arguments: { id: 1, preliminary: "maybe" },
  });
  assert.equal(badPreliminary.isError, true);

  const badSentiment = await client.callTool({
    name: "get_manga_reviews",
    arguments: { id: 1, sentiment: "great" },
  });
  assert.equal(badSentiment.isError, true);
});

test("search_anime/search_manga accept multiple types (comma-joined) and reject an invalid rating", async (t) => {
  const mock = mockFetch(() => jsonResponse({ data: [], pagination: {} }));
  installFetch(t, mock);
  const { client, close } = await connectServer({});
  t.after(close);

  const multiType = await client.callTool({
    name: "search_anime",
    arguments: { q: "x", type: ["tv", "movie"], rating: ["pg13", "r"] },
  });
  assert.notEqual(multiType.isError, true);
  assert.match(mock.calls.at(-1)!.url, /type=tv%2Cmovie/);
  assert.match(mock.calls.at(-1)!.url, /rating=pg13%2Cr/);

  const mangaMultiType = await client.callTool({
    name: "search_manga",
    arguments: { q: "x", type: ["manga"] },
  });
  assert.notEqual(mangaMultiType.isError, true);

  const invalidRating = await client.callTool({
    name: "search_anime",
    arguments: { q: "x", rating: ["nc17"] },
  });
  assert.equal(invalidRating.isError, true);
});

test("search_anime rejects more than 25 comma-separated genre IDs", async (t) => {
  const mock = mockFetch(() => jsonResponse({ data: [], pagination: {} }));
  installFetch(t, mock);
  const { client, close } = await connectServer({});
  t.after(close);

  const tooMany = Array.from({ length: 26 }, (_, i) => i + 1).join(",");
  const res = await client.callTool({
    name: "search_anime",
    arguments: { q: "x", genres: tooMany },
  });
  assert.equal(res.isError, true);
  assert.equal(mock.calls.length, 0);
});

test("search_anime/search_manga reject a letter filter longer than one character", async (t) => {
  const mock = mockFetch(() => jsonResponse({ data: [], pagination: {} }));
  installFetch(t, mock);
  const { client, close } = await connectServer({});
  t.after(close);

  const res = await client.callTool({
    name: "search_anime",
    arguments: { q: "x", letter: "ab" },
  });
  assert.equal(res.isError, true);
  assert.equal(mock.calls.length, 0);
});

test("search_anime rejects a page past Tenrai's own 1000-page ceiling", async (t) => {
  const mock = mockFetch(() => jsonResponse({ data: [], pagination: {} }));
  installFetch(t, mock);
  const { client, close } = await connectServer({});
  t.after(close);

  const res = await client.callTool({
    name: "search_anime",
    arguments: { q: "x", page: 1001 },
  });
  assert.equal(res.isError, true);
  assert.equal(mock.calls.length, 0);
});

test("get_anime_episodes also rejects a page past 1000 — Tenrai enforces this ceiling almost everywhere, verified live", async (t) => {
  const mock = mockFetch(() => jsonResponse({ data: [] }));
  installFetch(t, mock);
  const { client, close } = await connectServer({});
  t.after(close);

  const res = await client.callTool({
    name: "get_anime_episodes",
    arguments: { id: 1, page: 1001 },
  });
  assert.equal(res.isError, true);
  assert.equal(mock.calls.length, 0);
});

test("get_top_anime/get_top_characters accept a page past 1000 — verified live that these two (unlike everything else) serve real data well beyond it", async (t) => {
  const mock = mockFetch(() => jsonResponse({ data: [], pagination: {} }));
  installFetch(t, mock);
  const { client, close } = await connectServer({});
  t.after(close);

  const anime = await client.callTool({ name: "get_top_anime", arguments: { page: 1001 } });
  assert.notEqual(anime.isError, true);
  const characters = await client.callTool({
    name: "get_top_characters",
    arguments: { page: 1001 },
  });
  assert.notEqual(characters.isError, true);
  assert.equal(mock.calls.length, 2);
});

test("get_seasonal_anime/get_upcoming_season accept kids/continuing/unapproved/order_by", async (t) => {
  const mock = mockFetch(() => jsonResponse({ data: [], pagination: {} }));
  installFetch(t, mock);
  const { client, close } = await connectServer({});
  t.after(close);

  const seasonal = await client.callTool({
    name: "get_seasonal_anime",
    arguments: {
      year: 2024,
      season: "fall",
      kids: true,
      continuing: false,
      unapproved: false,
      order_by: "start_date",
      sort: "asc",
    },
  });
  assert.notEqual(seasonal.isError, true);
  assert.match(mock.calls.at(-1)!.url, /kids=true/);
  assert.match(mock.calls.at(-1)!.url, /continuing=false/);
  assert.match(mock.calls.at(-1)!.url, /order_by=start_date/);

  const upcoming = await client.callTool({
    name: "get_upcoming_season",
    arguments: { kids: true, filter: ["tv"] },
  });
  assert.notEqual(upcoming.isError, true);
  assert.match(mock.calls.at(-1)!.url, /kids=true/);
  assert.match(mock.calls.at(-1)!.url, /filter=tv/);
});

test("get_top_anime accepts multi-type and rating filters", async (t) => {
  const mock = mockFetch(() => jsonResponse({ data: [], pagination: {} }));
  installFetch(t, mock);
  const { client, close } = await connectServer({});
  t.after(close);

  const res = await client.callTool({
    name: "get_top_anime",
    arguments: { type: ["tv", "ova"], rating: ["g", "pg"] },
  });
  assert.notEqual(res.isError, true);
  assert.match(mock.calls.at(-1)!.url, /type=tv%2Cova/);
  assert.match(mock.calls.at(-1)!.url, /rating=g%2Cpg/);
});

test("get_anime_schedule accepts kids/unapproved/page", async (t) => {
  const mock = mockFetch(() => jsonResponse({ data: [], pagination: {} }));
  installFetch(t, mock);
  const { client, close } = await connectServer({});
  t.after(close);

  const res = await client.callTool({
    name: "get_anime_schedule",
    arguments: { kids: true, unapproved: false, page: 2 },
  });
  assert.notEqual(res.isError, true);
  assert.match(mock.calls.at(-1)!.url, /kids=true/);
  assert.match(mock.calls.at(-1)!.url, /unapproved=false/);
  assert.match(mock.calls.at(-1)!.url, /page=2/);
});

test("search_characters/search_people/get_producers/get_magazines accept a letter filter", async (t) => {
  const mock = mockFetch(() => jsonResponse({ data: [], pagination: {} }));
  installFetch(t, mock);
  const { client, close } = await connectServer({});
  t.after(close);

  for (const name of ["search_characters", "search_people"]) {
    const res = await client.callTool({ name, arguments: { q: "x", letter: "a" } });
    assert.notEqual(res.isError, true, `${name} should accept letter`);
    assert.match(mock.calls.at(-1)!.url, /letter=a/);
  }

  const producers = await client.callTool({ name: "get_producers", arguments: { letter: "b" } });
  assert.notEqual(producers.isError, true);
  assert.match(mock.calls.at(-1)!.url, /letter=b/);

  const magazines = await client.callTool({ name: "get_magazines", arguments: { letter: "c" } });
  assert.notEqual(magazines.isError, true);
  assert.match(mock.calls.at(-1)!.url, /letter=c/);
});

test("get_magazines' limit cap is 100, not 50 (Tenrai's own per-page ceiling for this endpoint)", async (t) => {
  const mock = mockFetch(() => jsonResponse({ data: [], pagination: {} }));
  installFetch(t, mock);
  const { client, close } = await connectServer({});
  t.after(close);

  const atCap = await client.callTool({ name: "get_magazines", arguments: { limit: 100 } });
  assert.notEqual(atCap.isError, true);

  const overCap = await client.callTool({ name: "get_magazines", arguments: { limit: 101 } });
  assert.equal(overCap.isError, true);

  const orderBy = await client.callTool({
    name: "get_magazines",
    arguments: { order_by: "count", sort: "desc" },
  });
  assert.notEqual(orderBy.isError, true);
  assert.match(mock.calls.at(-1)!.url, /order_by=count/);
});

test("get_producer returns full details including about/external", async (t) => {
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
  const { client, close } = await connectServer({});
  t.after(close);

  const res = await client.callTool({ name: "get_producer", arguments: { id: 14 } });
  assert.notEqual(res.isError, true);
  const s = res.structuredContent as Record<string, unknown>;
  assert.equal(s["name"], "Sunrise");
  assert.equal(s["about"], "A Japanese animation studio.");
  assert.match(mock.calls[0]!.url, /\/producers\/14\/full$/);
});

test("get_anime_videos returns promo/episodes/music_videos", async (t) => {
  const mock = mockFetch(() =>
    jsonResponse({
      data: {
        promo: [{ title: "PV 1", trailer: { url: "https://youtube.com/watch?v=abc" } }],
        episodes: [],
        music_videos: [],
      },
    }),
  );
  installFetch(t, mock);
  const { client, close } = await connectServer({});
  t.after(close);

  const res = await client.callTool({ name: "get_anime_videos", arguments: { id: 1 } });
  assert.notEqual(res.isError, true);
  const s = res.structuredContent as { promo: Record<string, unknown>[] };
  assert.equal(s.promo[0]!["url"], "https://youtube.com/watch?v=abc");
  assert.match(mock.calls[0]!.url, /\/anime\/1\/videos$/);
});

test("get_recent_anime_recommendations/get_recent_manga_recommendations return the site-wide feed", async (t) => {
  const mock = mockFetch(() =>
    jsonResponse({
      data: [
        {
          entry: [
            { mal_id: 1, title: "A" },
            { mal_id: 2, title: "B" },
          ],
          content: "Great pair",
          user: { username: "bob" },
        },
      ],
      pagination: {},
    }),
  );
  installFetch(t, mock);
  const { client, close } = await connectServer({});
  t.after(close);

  const anime = await client.callTool({ name: "get_recent_anime_recommendations", arguments: {} });
  assert.notEqual(anime.isError, true);
  assert.match(mock.calls[0]!.url, /\/recommendations\/anime/);

  const manga = await client.callTool({ name: "get_recent_manga_recommendations", arguments: {} });
  assert.notEqual(manga.isError, true);
  assert.match(mock.calls[1]!.url, /\/recommendations\/manga/);

  const overCap = await client.callTool({
    name: "get_recent_anime_recommendations",
    arguments: { limit: 101 },
  });
  assert.equal(overCap.isError, true);
});

test("get_news hits the site-wide feed, not one anime's news", async (t) => {
  const mock = mockFetch(() =>
    jsonResponse({
      data: [{ mal_id: 1, url: "u", title: "Big Announcement" }],
      pagination: {},
    }),
  );
  installFetch(t, mock);
  const { client, close } = await connectServer({});
  t.after(close);

  const res = await client.callTool({ name: "get_news", arguments: { q: "announcement" } });
  assert.notEqual(res.isError, true);
  const s = res.structuredContent as { results: Record<string, unknown>[] };
  assert.equal(s.results[0]!["title"], "Big Announcement");
  assert.match(mock.calls[0]!.url, /\/news\?/);
  assert.doesNotMatch(mock.calls[0]!.url, /\/anime\//);
});

test("update_my_anime_status rejects a calendar-invalid start_date", async (t) => {
  const mock = mockFetch(() => jsonResponse({ status: "watching" }));
  installFetch(t, mock);
  const { client, close } = await connectServer({ MAL_ACCESS_TOKEN: "tok" });
  t.after(close);

  // Right shape (YYYY-MM-DD), but no such day exists.
  const bad = await client.callTool({
    name: "update_my_anime_status",
    arguments: { anime_id: 1, status: "watching", start_date: "2024-02-30" },
  });
  assert.equal(bad.isError, true);
  assert.equal(mock.calls.length, 0);

  const ok = await client.callTool({
    name: "update_my_anime_status",
    arguments: { anime_id: 1, status: "watching", start_date: "2024-02-29" },
  });
  assert.notEqual(ok.isError, true);
});

test("update_my_manga_status sends start_date/finish_date in the form body", async (t) => {
  // MAL's manga endpoint does accept these — confirmed with a live PATCH against a real account
  // (reverted afterwards). The tool simply never offered them, unlike its anime sibling.
  const mock = mockFetch(() => jsonResponse({ status: "reading" }));
  installFetch(t, mock);
  const { client, close } = await connectServer({ MAL_ACCESS_TOKEN: "tok" });
  t.after(close);

  const res = await client.callTool({
    name: "update_my_manga_status",
    arguments: { manga_id: 2, start_date: "2026-08-01", finish_date: "2026-08-20" },
  });
  assert.notEqual(res.isError, true);
  const body = String(mock.calls.at(-1)!.init?.body);
  assert.match(body, /start_date=2026-08-01/);
  assert.match(body, /finish_date=2026-08-20/);
});

test("update_my_manga_status rejects a calendar-invalid finish_date", async (t) => {
  const mock = mockFetch(() => jsonResponse({ status: "reading" }));
  installFetch(t, mock);
  const { client, close } = await connectServer({ MAL_ACCESS_TOKEN: "tok" });
  t.after(close);

  const bad = await client.callTool({
    name: "update_my_manga_status",
    arguments: { manga_id: 2, finish_date: "2024-02-30" },
  });
  assert.equal(bad.isError, true);
  assert.equal(mock.calls.length, 0);
});
