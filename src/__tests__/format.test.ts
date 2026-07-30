import { test } from "node:test";
import assert from "node:assert/strict";
import {
  summarizeAnime,
  summarizeManga,
  summarizeCharacters,
  summarizeRecommendations,
  summarizeReviews,
  summarizeEpisodes,
  summarizeGenres,
  summarizeCharacter,
  summarizePerson,
  summarizeStaff,
  summarizeStatistics,
  summarizeProducer,
  summarizeSeasonsList,
  summarizeNewsItem,
  pageInfo,
  type RawAnime,
  type RawManga,
} from "../lib/format.js";

const longSynopsis = "x".repeat(500);

const anime: RawAnime = {
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

test("summarizeAnime surfaces detailed /full fields (duration, broadcast, trailer, themes, licensors)", () => {
  const full: RawAnime = {
    ...anime,
    duration: "24 min per ep",
    broadcast: {
      day: "Fridays",
      time: "23:00",
      timezone: "Asia/Tokyo",
      string: "Fridays at 23:00 (JST)",
    },
    trailer: {
      youtube_id: null,
      url: null,
      embed_url: "https://youtube-nocookie.com/embed/ZEkwCGJ3o7M",
    },
    theme: { openings: ['1: "Tank!" by Seatbelts'], endings: [] },
    licensors: [{ name: "Crunchyroll" }],
  };
  const s = summarizeAnime(full, true);
  assert.equal(s["duration"], "24 min per ep");
  assert.equal(s["broadcast"], "Fridays at 23:00 (JST)");
  assert.equal(s["trailer"], "https://youtube-nocookie.com/embed/ZEkwCGJ3o7M"); // falls back to embed_url
  assert.deepEqual(s["opening_themes"], ['1: "Tank!" by Seatbelts']);
  assert.ok(!("ending_themes" in s)); // empty array dropped
  assert.deepEqual(s["licensors"], ["Crunchyroll"]);
});

test("summarizeAnime omits the detailed /full fields in list mode", () => {
  const s = summarizeAnime({ ...anime, duration: "24 min per ep" });
  for (const k of ["duration", "trailer", "opening_themes", "licensors"])
    assert.ok(!(k in s), `${k} should not appear in list mode`);
});

test("summarizeAnime includes broadcast in list mode too, not just detailed", () => {
  const s = summarizeAnime({
    ...anime,
    broadcast: {
      day: "Fridays",
      time: "23:00",
      timezone: "Asia/Tokyo",
      string: "Fridays at 23:00 (JST)",
    },
  });
  assert.equal(s["broadcast"], "Fridays at 23:00 (JST)");
});

test("summarizeAnime treats a score of 0 as absent", () => {
  const s = summarizeAnime({ ...anime, score: 0 });
  assert.ok(!("score" in s));
  // A real score is preserved.
  assert.equal(summarizeAnime({ ...anime, score: 8.75 })["score"], 8.75);
});

test("summarizeManga maps manga-specific fields", () => {
  const manga: RawManga = {
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

test("summarizeManga surfaces the publishing flag only in detailed mode", () => {
  const manga: RawManga = { mal_id: 2, title: "Berserk", publishing: true };
  assert.ok(!("publishing" in summarizeManga(manga))); // list mode omits it
  assert.equal(summarizeManga(manga, true)["publishing"], true);
  // A finished manga keeps the explicit false (not dropped as nullish).
  assert.equal(summarizeManga({ ...manga, publishing: false }, true)["publishing"], false);
});

test("summarizeCharacters keeps Japanese VAs for anime and omits them for manga", () => {
  const raw = [
    {
      character: { mal_id: 5, name: "Spike", url: "u" },
      role: "Main",
      voice_actors: [
        { language: "Japanese", person: { name: "Yamadera" } },
        { language: "English", person: { name: "Blum" } },
      ],
    },
  ];
  const anime = summarizeCharacters(raw, true) as { characters: { voice_actors: string[] }[] };
  assert.deepEqual(anime.characters[0]!.voice_actors, ["Yamadera"]);

  const manga = summarizeCharacters(raw, false) as { characters: Record<string, unknown>[] };
  assert.ok(!("voice_actors" in manga.characters[0]!));
  assert.equal(manga.characters[0]!["name"], "Spike");
});

test("summarizeRecommendations caps at 25 and maps the entry", () => {
  const raw = Array.from({ length: 30 }, (_v, i) => ({
    entry: { mal_id: i, title: `T${i}`, url: "u" },
    votes: i,
  }));
  const r = summarizeRecommendations(raw) as { recommendations: unknown[] };
  assert.equal(r.recommendations.length, 25);
});

test("summarizeCharacters drops a malformed entry instead of failing the whole list", () => {
  const raw = [
    { character: { mal_id: 5, name: "Spike", url: "u" }, role: "Main" },
    // No nested `character` object at all — a malformed/edge-case upstream entry.
    { role: "Support" },
  ];
  const r = summarizeCharacters(raw, false) as { characters: { mal_id: number }[] };
  assert.equal(r.characters.length, 1);
  assert.equal(r.characters[0]!.mal_id, 5);
});

test("summarizeRecommendations drops a malformed entry instead of failing the whole list", () => {
  const raw = [
    { entry: { mal_id: 1, title: "Real", url: "u" }, votes: 5 },
    { votes: 1 }, // no `entry` at all
  ];
  const r = summarizeRecommendations(raw) as { recommendations: { mal_id: number }[] };
  assert.equal(r.recommendations.length, 1);
  assert.equal(r.recommendations[0]!.mal_id, 1);
});

test("summarizeReviews truncates long review text", () => {
  const r = summarizeReviews([
    { user: { username: "bob" }, score: 8, review: "x".repeat(2000), date: "2024" },
  ]) as { reviews: { review: string; tags: string[] }[] };
  assert.equal(r.reviews[0]!.review.length, 1200);
  assert.deepEqual(r.reviews[0]!.tags, []); // missing tags default to []
});

test("summarizeEpisodes maps fields and attaches pagination", () => {
  const r = summarizeEpisodes(
    [{ mal_id: 1, title: "Asteroid Blues", aired: "1998", filler: false, recap: false }],
    { has_next_page: true },
  ) as { episodes: Record<string, unknown>[]; page: Record<string, unknown> };
  assert.equal(r.episodes[0]!["title"], "Asteroid Blues");
  assert.equal(r.page["has_next_page"], true);
});

test("summarizeGenres maps id/name/count", () => {
  const r = summarizeGenres([{ mal_id: 1, name: "Action", count: 100, url: "u" }]) as {
    genres: Record<string, unknown>[];
  };
  assert.deepEqual(r.genres[0], { mal_id: 1, name: "Action", count: 100, url: "u" });
});

test("summarizeCharacter is compact in list mode and expands when detailed", () => {
  const raw = {
    mal_id: 1,
    name: "Spike",
    about: "x".repeat(500),
    anime: [{ role: "Main", anime: { mal_id: 1, title: "Bebop" } }],
    voices: [{ language: "Japanese", person: { mal_id: 9, name: "Yamadera" } }],
  };
  const list = summarizeCharacter(raw);
  assert.ok(!("anime" in list)); // relations only in detailed mode
  assert.ok((list["about"] as string).length < 500);

  const full = summarizeCharacter(raw, true) as { anime: unknown[]; voice_actors: unknown[] };
  assert.equal(full.anime.length, 1);
  assert.equal(full.voice_actors.length, 1);
});

test("summarizeCharacter drops a malformed nested credit/voice-actor instead of failing the whole lookup", () => {
  const raw = {
    mal_id: 1,
    name: "Spike",
    anime: [
      { role: "Main", anime: { mal_id: 1, title: "Bebop" } },
      { role: "Support" }, // no nested `anime` ref at all
    ],
    voices: [
      { language: "Japanese", person: { mal_id: 9, name: "Yamadera" } },
      { language: "English" }, // no nested `person` ref at all
    ],
  };
  const full = summarizeCharacter(raw, true) as {
    anime: { mal_id: number }[];
    voice_actors: { mal_id: number }[];
  };
  assert.equal(full.anime.length, 1);
  assert.equal(full.anime[0]!.mal_id, 1);
  assert.equal(full.voice_actors.length, 1);
  assert.equal(full.voice_actors[0]!.mal_id, 9);
});

test("summarizePerson maps names and caps voiced roles", () => {
  const voices = Array.from({ length: 80 }, (_v, i) => ({
    role: "Main",
    character: { name: `C${i}` },
    anime: { title: `A${i}` },
  }));
  const full = summarizePerson({ mal_id: 1, name: "Ito", voices }, true) as {
    voice_roles: unknown[];
  };
  assert.equal(full.voice_roles.length, 50);
});

test("summarizePerson drops a malformed nested credit instead of failing the whole lookup", () => {
  const raw = {
    mal_id: 1,
    name: "Ito",
    anime: [
      { position: "Main", anime: { mal_id: 1, title: "Bebop" } },
      { position: "Support" }, // no nested `anime` ref at all
    ],
  };
  const full = summarizePerson(raw, true) as { anime: { mal_id: number }[] };
  assert.equal(full.anime.length, 1);
  assert.equal(full.anime[0]!.mal_id, 1);
});

test("summarizeStaff and summarizeProducer extract the key fields", () => {
  const staff = summarizeStaff([
    { person: { mal_id: 1, name: "Watanabe" }, positions: ["Director"] },
  ]) as {
    staff: Record<string, unknown>[];
  };
  assert.equal(staff.staff[0]!["name"], "Watanabe");
  const prod = summarizeProducer({
    mal_id: 14,
    titles: [{ type: "Default", title: "Sunrise" }],
    count: 100,
  });
  assert.equal(prod["name"], "Sunrise");
});

test("summarizeStaff drops a malformed entry instead of failing the whole list", () => {
  const staff = summarizeStaff([
    { person: { mal_id: 1, name: "Watanabe" }, positions: ["Director"] },
    { positions: ["Producer"] }, // no nested `person` at all
  ]) as { staff: { mal_id: number }[] };
  assert.equal(staff.staff.length, 1);
  assert.equal(staff.staff[0]!.mal_id, 1);
});

test("summarizeStatistics keeps only the relevant status keys", () => {
  const anime = summarizeStatistics({ watching: 5, completed: 10, total: 15 });
  assert.equal(anime["watching"], 5);
  assert.ok(!("reading" in anime)); // undefined manga key dropped
});

test("summarizeSeasonsList and summarizeNewsItem map their fields", () => {
  const seasons = summarizeSeasonsList([{ year: 2024, seasons: ["winter", "spring"] }]) as {
    seasons: Record<string, unknown>[];
  };
  assert.deepEqual(seasons.seasons[0], { year: 2024, seasons: ["winter", "spring"] });

  const news = summarizeNewsItem({
    mal_id: 1,
    title: "New season announced",
    author_username: "mod",
    excerpt: "z".repeat(500),
    date: "2024",
  });
  assert.equal(news["author"], "mod");
  assert.ok((news["excerpt"] as string).length < 500);
});

test("summarizeSeasonsList drops a malformed entry instead of failing the whole list", () => {
  const seasons = summarizeSeasonsList([
    { year: 2024, seasons: ["winter", "spring"] },
    { seasons: ["fall"] }, // no `year` at all
  ]) as { seasons: { year: number }[] };
  assert.equal(seasons.seasons.length, 1);
  assert.equal(seasons.seasons[0]!.year, 2024);
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
