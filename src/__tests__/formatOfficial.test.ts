import { test } from "node:test";
import assert from "node:assert/strict";
import {
  summarizeOfficialAnime,
  summarizeOfficialAnimeDetailed,
  summarizeOfficialAnimeStatistics,
  summarizeOfficialManga,
  summarizeOfficialMangaDetailed,
  summarizeOfficialRecommendations,
  ANIME_LIST_FALLBACK_GAPS,
  ANIME_DETAIL_FALLBACK_GAPS,
  ANIME_STATISTICS_FALLBACK_GAPS,
  MANGA_LIST_FALLBACK_GAPS,
  MANGA_DETAIL_FALLBACK_GAPS,
  type OfficialAnimeNode,
  type OfficialMangaNode,
  type OfficialAnimeStatistics,
} from "../lib/formatOfficial.js";
import {
  animeSummarySchema,
  animeDetailSchema,
  mangaSummarySchema,
  mangaDetailSchema,
} from "../lib/format.schemas.js";

test("summarizeOfficialAnime passes an unmapped status string through unchanged", () => {
  const s = summarizeOfficialAnime({ id: 1, status: "some_new_status" } as OfficialAnimeNode);
  assert.equal(s["status"], "some_new_status");
});

test("summarizeOfficialManga passes an unmapped status string through unchanged", () => {
  const s = summarizeOfficialManga({ id: 1, status: "some_new_status" } as OfficialMangaNode);
  assert.equal(s["status"], "some_new_status");
});

test("summarizeOfficialAnime treats num_episodes: 0 as unknown, not a literal 0", () => {
  const s = summarizeOfficialAnime({ id: 1, num_episodes: 0 } as OfficialAnimeNode);
  assert.ok(!("episodes" in s));
});

test("summarizeOfficialManga treats num_chapters/num_volumes: 0 as unknown", () => {
  const s = summarizeOfficialManga({
    id: 1,
    num_chapters: 0,
    num_volumes: 0,
  } as OfficialMangaNode);
  assert.ok(!("chapters" in s));
  assert.ok(!("volumes" in s));
});

test("summarizeOfficialManga drops author entries with neither a first nor last name", () => {
  const s = summarizeOfficialManga({
    id: 1,
    authors: [{ node: { first_name: "Masashi", last_name: "Kishimoto" } }, { node: {} }],
  } as OfficialMangaNode);
  assert.deepEqual(s["authors"], ["Masashi Kishimoto"]);
});

// ---- fallback field-gap contract --------------------------------------------------
//
// The *_FALLBACK_GAPS constants exported from formatOfficial.ts are the single source of
// truth read.ts's tool descriptions render (via gapList()) instead of hardcoding field names
// in prose. These tests feed a fully-populated node through each summarizer and assert: every
// field the gap constant claims is missing really is missing, and every field it doesn't
// claim is missing really is present — so prose and behavior can't silently drift apart the
// way get_anime_schedule's `broadcast` promise once did (see AGENTS.md, 2026-07-29).

const fullAnimeNode: OfficialAnimeNode = {
  id: 1,
  title: "T",
  alternative_titles: { en: "TE", ja: "TJ", synonyms: ["Alt Title"] },
  main_picture: { large: "pic" },
  start_date: "2024-01-01",
  start_season: { year: 2024, season: "winter" },
  synopsis: "s".repeat(10),
  mean: 8,
  rank: 1,
  popularity: 1,
  num_list_users: 100,
  num_scoring_users: 50,
  media_type: "tv",
  status: "currently_airing",
  genres: [{ name: "Action" }],
  num_episodes: 12,
  rating: "pg_13",
  studios: [{ name: "Studio" }],
  source: "manga",
  average_episode_duration: 1440,
  background: "bg",
  broadcast: { day_of_the_week: "friday", start_time: "23:00" },
  related_anime: [{ node: { title: "Rel" }, relation_type_formatted: "Sequel" }],
  related_manga: [],
  nsfw: "white",
};

test("summarizeOfficialAnime (list mode) populates every field except ANIME_LIST_FALLBACK_GAPS", () => {
  const s = summarizeOfficialAnime(fullAnimeNode);
  for (const key of Object.keys(animeSummarySchema.shape)) {
    if ((ANIME_LIST_FALLBACK_GAPS as readonly string[]).includes(key)) {
      assert.ok(!(key in s), `${key} should be absent (declared as a list-fallback gap)`);
    } else {
      assert.ok(key in s, `${key} should be present (not declared as a list-fallback gap)`);
    }
  }
});

test("summarizeOfficialAnimeDetailed populates every field except ANIME_DETAIL_FALLBACK_GAPS (themes/demographics still gap, broadcast is not)", () => {
  const s = summarizeOfficialAnimeDetailed(fullAnimeNode);
  const detailGaps: readonly string[] = ["themes", "demographics", ...ANIME_DETAIL_FALLBACK_GAPS];
  for (const key of Object.keys(animeDetailSchema.shape)) {
    if (detailGaps.includes(key)) {
      assert.ok(!(key in s), `${key} should be absent (declared as a detail-fallback gap)`);
    } else {
      assert.ok(key in s, `${key} should be present (not declared as a detail-fallback gap)`);
    }
  }
  // Pin the one field that behaves differently between modes: absent in list mode (asserted
  // above), but explicitly recomputed and present in detail mode.
  assert.equal(s["broadcast"], "Fridays at 23:00 (JST)");
});

const fullMangaNode: OfficialMangaNode = {
  id: 1,
  title: "T",
  alternative_titles: { en: "TE", ja: "TJ", synonyms: ["Alt Title"] },
  main_picture: { large: "pic" },
  start_date: "2024-01-01",
  synopsis: "s".repeat(10),
  mean: 8,
  rank: 1,
  popularity: 1,
  num_list_users: 100,
  num_scoring_users: 50,
  media_type: "manga",
  status: "currently_publishing",
  genres: [{ name: "Action" }],
  num_chapters: 12,
  num_volumes: 2,
  authors: [{ node: { first_name: "A", last_name: "B" } }],
  background: "bg",
  related_anime: [],
  related_manga: [{ node: { title: "Rel" }, relation_type_formatted: "Sequel" }],
  serialization: [{ node: { name: "Mag" } }],
  nsfw: "white",
};

test("summarizeOfficialManga (list mode) populates every field except MANGA_LIST_FALLBACK_GAPS", () => {
  const s = summarizeOfficialManga(fullMangaNode);
  for (const key of Object.keys(mangaSummarySchema.shape)) {
    if ((MANGA_LIST_FALLBACK_GAPS as readonly string[]).includes(key)) {
      assert.ok(!(key in s), `${key} should be absent (declared as a list-fallback gap)`);
    } else {
      assert.ok(key in s, `${key} should be present (not declared as a list-fallback gap)`);
    }
  }
});

test("summarizeOfficialMangaDetailed populates every field except themes/demographics/MANGA_DETAIL_FALLBACK_GAPS", () => {
  const s = summarizeOfficialMangaDetailed(fullMangaNode);
  const detailGaps: readonly string[] = ["themes", "demographics", ...MANGA_DETAIL_FALLBACK_GAPS];
  for (const key of Object.keys(mangaDetailSchema.shape)) {
    if (detailGaps.includes(key)) {
      assert.ok(!(key in s), `${key} should be absent (declared as a detail-fallback gap)`);
    } else {
      assert.ok(key in s, `${key} should be present (not declared as a detail-fallback gap)`);
    }
  }
});

test("summarizeOfficialAnimeStatistics populates every anime-relevant field except ANIME_STATISTICS_FALLBACK_GAPS", () => {
  const fullStats: OfficialAnimeStatistics = {
    num_list_users: 100,
    status: {
      watching: "10",
      completed: "20",
      on_hold: "3",
      dropped: "1",
      plan_to_watch: "5",
    },
  };
  const s = summarizeOfficialAnimeStatistics(fullStats);
  // reading/plan_to_read are manga-only keys of the shared statisticsSchema — structurally
  // never populated by this anime-only function, not a fallback gap to track here.
  const animeRelevantKeys = [
    "watching",
    "completed",
    "on_hold",
    "dropped",
    "plan_to_watch",
    "total",
    "scores",
  ];
  for (const key of animeRelevantKeys) {
    if ((ANIME_STATISTICS_FALLBACK_GAPS as readonly string[]).includes(key)) {
      assert.ok(!(key in s), `${key} should be absent (declared as a statistics-fallback gap)`);
    } else {
      assert.ok(key in s, `${key} should be present (not declared as a statistics-fallback gap)`);
    }
  }
});

test("summarizeOfficialRecommendations drops an edge with no resolvable node id", () => {
  const r = summarizeOfficialRecommendations("anime", [
    { node: { id: 1, title: "Real" }, num_recommendations: 5 },
    { num_recommendations: 1 }, // no `node` at all
  ]) as { recommendations: { mal_id: number }[] };
  assert.equal(r.recommendations.length, 1);
  assert.equal(r.recommendations[0]!.mal_id, 1);
});
