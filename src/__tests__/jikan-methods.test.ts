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

test("every Jikan read method hits the expected endpoint and returns data", async () => {
  const mock = mockFetch((url) => routedResponse(url));
  const restore = installFetch(mock);
  try {
    const c = jikan();
    assert.ok((await c.getManga(1))["mal_id"]);
    assert.ok((await c.getAnimeCharacters(1))["characters"]);
    assert.ok((await c.getAnimeRecommendations(1))["recommendations"]);
    assert.ok((await c.getAnimeReviews(1, 3))["reviews"]);
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
    assert.ok(urls.some((u) => /\/seasons\/2024\/spring/.test(u)));
    assert.ok(urls.some((u) => /\/seasons\/now/.test(u)));
    assert.ok(urls.some((u) => /\/schedules\?/.test(u) && /filter=monday/.test(u)));
    assert.ok(urls.some((u) => /\/top\/anime/.test(u) && /filter=airing/.test(u)));
  } finally {
    restore();
  }
});

test("getAnimeCharacters keeps only Japanese voice actors", async () => {
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
  const restore = installFetch(mock);
  try {
    const res = (await jikan().getAnimeCharacters(1)) as {
      characters: { voice_actors: string[] }[];
    };
    assert.deepEqual(res.characters[0]!.voice_actors, ["JP"]);
  } finally {
    restore();
  }
});
