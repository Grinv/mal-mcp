import { test } from "node:test";
import assert from "node:assert/strict";
import { JikanClient } from "../clients/jikan.js";
import { loadConfig } from "../config.js";
import { silentLogger, mockFetch, installFetch } from "./helpers.js";

function jikan() {
  return new JikanClient(
    loadConfig({ JIKAN_MIN_INTERVAL_MS: "0", CACHE_TTL_MS: "0" }),
    silentLogger(),
  );
}

// Returns a payload shaped for whichever endpoint the URL targets.
function routedResponse(url: string): Response {
  let body: unknown;
  if (url.includes("/characters")) {
    body = {
      data: [
        {
          character: { mal_id: 5, name: "Spike", url: "u" },
          role: "Main",
          voice_actors: [{ language: "Japanese", person: { name: "Yamadera" } }],
        },
      ],
    };
  } else if (url.includes("/recommendations")) {
    body = { data: [{ entry: { mal_id: 9, title: "Similar", url: "u" }, votes: 12 }] };
  } else if (url.includes("/reviews")) {
    body = {
      data: [
        {
          user: { username: "bob" },
          score: 8,
          tags: ["Recommended"],
          date: "2024",
          review: "good",
          url: "u",
        },
      ],
    };
  } else if (url.includes("/favorites")) {
    body = {
      data: { anime: [{ mal_id: 1, title: "Fav" }], manga: [], characters: [], people: [] },
    };
  } else if (url.includes("/users/")) {
    // Note: profile URL is `users/<name>/full`, so check /users/ before /full.
    body = { data: { username: "bob", url: "u", joined: "2010", statistics: {} } };
  } else if (url.includes("/full")) {
    body = { data: { mal_id: 1, title: "Detail" } };
  } else {
    body = { data: [{ mal_id: 1, title: "Item" }], pagination: { current_page: 1 } };
  }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("every Jikan read method hits the expected endpoint and returns data", async (t) => {
  const mock = mockFetch((url) => routedResponse(url));
  installFetch(t, mock);
  const c = jikan();
  assert.ok((await c.getManga(1))["mal_id"]);
  assert.ok((await c.getAnimeCharacters(1))["characters"]);
  assert.ok((await c.getMangaCharacters(1))["characters"]);
  assert.ok((await c.getAnimeRecommendations(1))["recommendations"]);
  assert.ok((await c.getMangaRecommendations(1))["recommendations"]);
  assert.ok((await c.getAnimeReviews(1, 3))["reviews"]);
  assert.ok((await c.getMangaReviews(1, 3))["reviews"]);
  assert.ok((await c.getAnimeEpisodes(1))["episodes"]);
  assert.ok((await c.getAnimeGenres())["genres"]);
  assert.ok((await c.getMangaGenres("themes"))["genres"]);
  assert.ok((await c.getTopAnime({ filter: "airing" }))["results"]);
  assert.ok((await c.getTopManga({}))["results"]);
  assert.ok((await c.getSeason({ year: 2024, season: "spring" }))["results"]);
  assert.ok((await c.getSeason({}))["results"]); // current season path
  assert.ok((await c.getSchedule("monday", 5))["results"]);
  assert.ok((await c.getUserProfile("bob"))["username"]);

  const fav = (await c.getUserFavorites("bob")) as { anime: unknown[] };
  assert.equal(fav.anime.length, 1);

  const urls = mock.calls.map((x) => x.url);
  assert.ok(urls.some((u) => /\/manga\/1\/full$/.test(u)));
  assert.ok(urls.some((u) => /\/manga\/1\/characters$/.test(u)));
  assert.ok(urls.some((u) => /\/anime\/1\/episodes/.test(u)));
  assert.ok(urls.some((u) => /\/genres\/anime/.test(u)));
  assert.ok(urls.some((u) => /\/genres\/manga\?/.test(u) && /filter=themes/.test(u)));
  assert.ok(urls.some((u) => /\/seasons\/2024\/spring/.test(u)));
  assert.ok(urls.some((u) => /\/seasons\/now/.test(u)));
  assert.ok(urls.some((u) => /\/schedules\?/.test(u) && /filter=monday/.test(u)));
  assert.ok(urls.some((u) => /\/top\/anime/.test(u) && /filter=airing/.test(u)));
});

test("Tier 1-3 methods hit their endpoints and shape the response", async (t) => {
  // Return a payload shaped for the specific endpoint kind the URL targets.
  const obj = (data: unknown): Response =>
    new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const mock = mockFetch((url) => {
    if (/\/users\/[^/]+\/statistics$/.test(url))
      return obj({ anime: { days_watched: 1 }, manga: {} });
    if (/\/users\/[^/]+\/userupdates$/.test(url))
      return obj({ anime: [{ entry: { mal_id: 1, title: "T" }, status: "watching" }], manga: [] });
    if (/\/statistics$/.test(url)) return obj({ watching: 5, completed: 10, total: 15 });
    if (/\/full$/.test(url)) return obj({ mal_id: 1, name: "X", anime: [], manga: [], voices: [] });
    if (/\/random\//.test(url)) return obj({ mal_id: 1, title: "T" });
    return new Response(
      JSON.stringify({
        data: [{ mal_id: 1, name: "X", title: "T", person: { mal_id: 2, name: "P" } }],
        pagination: {},
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  installFetch(t, mock);
  const c = jikan();
  assert.equal((await c.getCharacter(1))["mal_id"], 1);
  assert.equal((await c.getPerson(1))["mal_id"], 1);
  assert.equal((await c.getAnimeStatistics(1))["watching"], 5);
  assert.equal((await c.getMangaStatistics(1))["watching"], 5);
  assert.equal((await c.getRandomAnime())["mal_id"], 1);
  assert.equal((await c.getRandomManga())["mal_id"], 1);
  assert.ok((await c.searchCharacters({ q: "x" }))["results"]);
  assert.ok((await c.searchPeople({ q: "x" }))["results"]);
  assert.ok((await c.getAnimeStaff(1))["staff"]);
  assert.ok((await c.getProducers({}))["results"]);
  assert.ok((await c.getTopPeople({}))["results"]);
  assert.ok((await c.getTopCharacters({}))["results"]);
  assert.ok((await c.getUpcomingSeason({}))["results"]);
  assert.equal((await c.getRandomCharacter())["mal_id"], 1);
  assert.equal((await c.getRandomPerson())["mal_id"], 1);
  assert.ok((await c.getSeasonsList())["seasons"]);
  assert.ok((await c.getAnimeNews(1))["results"]);

  const urls = mock.calls.map((x) => x.url);
  assert.ok(urls.some((u) => /\/random\/characters$/.test(u)));
  assert.ok(urls.some((u) => /\/anime\/1\/news/.test(u)));
  assert.ok(urls.some((u) => /\/characters\/1\/full$/.test(u)));
  assert.ok(urls.some((u) => /\/random\/anime$/.test(u)));
  assert.ok(urls.some((u) => /\/anime\/1\/statistics$/.test(u)));
  assert.ok(urls.some((u) => /\/seasons\/upcoming/.test(u)));
});

test("getAnimeCharacters keeps only Japanese voice actors", async (t) => {
  const mock = mockFetch(
    () =>
      new Response(
        JSON.stringify({
          data: [
            {
              character: { mal_id: 1, name: "C", url: "u" },
              role: "Main",
              voice_actors: [
                { language: "Japanese", person: { name: "JP" } },
                { language: "English", person: { name: "EN" } },
              ],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );
  installFetch(t, mock);
  const res = (await jikan().getAnimeCharacters(1)) as {
    characters: { voice_actors: string[] }[];
  };
  assert.deepEqual(res.characters[0]!.voice_actors, ["JP"]);
});
