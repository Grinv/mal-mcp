import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeAnime, summarizeManga, pageInfo, type JikanMedia } from "../lib/format.js";

const longSynopsis = "x".repeat(500);

const anime: JikanMedia = {
  mal_id: 1,
  title: "Cowboy Bebop",
  title_english: "Cowboy Bebop",
  type: "tv",
  episodes: 26,
  status: "Finished Airing",
  score: 8.75,
  synopsis: longSynopsis,
  genres: [{ name: "Action" }, { name: "Sci-Fi" }],
  studios: [{ name: "Sunrise" }],
  producers: [],
  url: "https://myanimelist.net/anime/1",
};

test("summarizeAnime trims the synopsis and extracts names in list mode", () => {
  const s = summarizeAnime(anime);
  assert.equal(s["mal_id"], 1);
  assert.deepEqual(s["genres"], ["Action", "Sci-Fi"]);
  assert.deepEqual(s["studios"], ["Sunrise"]);
  const synopsis = s["synopsis"] as string;
  assert.ok(synopsis.length < longSynopsis.length);
  assert.ok(synopsis.endsWith("…"));
  // Empty arrays are dropped to keep output compact.
  assert.ok(!("producers" in s));
});

test("summarizeAnime keeps the full synopsis in detailed mode", () => {
  const s = summarizeAnime(anime, true);
  assert.equal(s["synopsis"], longSynopsis);
});

test("summarizeManga maps manga-specific fields", () => {
  const manga: JikanMedia = {
    mal_id: 2,
    title: "Berserk",
    type: "manga",
    chapters: null,
    volumes: 41,
    authors: [{ name: "Miura, Kentarou" }],
  };
  const s = summarizeManga(manga);
  assert.equal(s["volumes"], 41);
  assert.deepEqual(s["authors"], ["Miura, Kentarou"]);
  assert.ok(!("chapters" in s)); // null dropped
});

test("pageInfo extracts pagination fields", () => {
  const p = pageInfo({
    current_page: 2,
    has_next_page: true,
    last_visible_page: 9,
    items: { total: 200 },
  });
  assert.deepEqual(p, { current_page: 2, has_next_page: true, last_visible_page: 9, total: 200 });
});
