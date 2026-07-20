// Integration: does JikanClient call the fallback at the right time, with the right args?
// Direct unit tests of withFallback/currentSeason/nextSeason themselves live in
// jikanFallback.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JikanClient } from "../clients/jikan.js";
import { currentSeason, nextSeason, type JikanFallback } from "../clients/jikanFallback.js";
import { loadConfig } from "../config.js";
import { silentLogger, jsonResponse, mockFetch, installFetch } from "./helpers.js";

function jikan(fallback?: JikanFallback) {
  // No rate-limit delay, no HTTP retries, small cache TTL — keeps fallback tests fast/deterministic.
  const config = loadConfig({
    JIKAN_MIN_INTERVAL_MS: "0",
    HTTP_RETRIES: "0",
    CACHE_TTL_MS: "60000",
  });
  return new JikanClient(config, silentLogger(), fallback);
}

function fakeFallback(hasClientId = true): JikanFallback & {
  calls: { kind: string; args: unknown }[];
} {
  const calls: { kind: string; args: unknown }[] = [];
  return {
    hasClientId: () => hasClientId,
    calls,
    searchAnimeOfficial: async (p) => {
      calls.push({ kind: "searchAnime", args: p });
      return { results: [{ mal_id: 1, title: "Fallback Anime" }], page: {} };
    },
    searchMangaOfficial: async (p) => {
      calls.push({ kind: "searchManga", args: p });
      return { results: [{ mal_id: 2, title: "Fallback Manga" }], page: {} };
    },
    topAnimeOfficial: async (p) => {
      calls.push({ kind: "topAnime", args: p });
      return { results: [{ mal_id: 3, title: "Fallback Top Anime" }], page: {} };
    },
    topMangaOfficial: async (p) => {
      calls.push({ kind: "topManga", args: p });
      return { results: [{ mal_id: 4, title: "Fallback Top Manga" }], page: {} };
    },
    seasonOfficial: async (year, season, p) => {
      calls.push({ kind: "season", args: { year, season, ...p } });
      return { results: [{ mal_id: 5, title: "Fallback Season" }], page: {} };
    },
    animeRecommendationsOfficial: async (id) => {
      calls.push({ kind: "animeRecommendations", args: { id } });
      return { recommendations: [{ mal_id: 6, title: "Fallback Anime Rec" }] };
    },
    mangaRecommendationsOfficial: async (id) => {
      calls.push({ kind: "mangaRecommendations", args: { id } });
      return { recommendations: [{ mal_id: 7, title: "Fallback Manga Rec" }] };
    },
    animeDetailsOfficial: async (id) => {
      calls.push({ kind: "animeDetails", args: { id } });
      return { mal_id: id, title: "Fallback Anime Details" };
    },
    mangaDetailsOfficial: async (id) => {
      calls.push({ kind: "mangaDetails", args: { id } });
      return { mal_id: id, title: "Fallback Manga Details" };
    },
    animeStatisticsOfficial: async (id) => {
      calls.push({ kind: "animeStatistics", args: { id } });
      return { watching: 42 };
    },
  };
}

test("searchAnime falls back to the official MAL API on a retryable upstream failure", async (t) => {
  const mock = mockFetch(() => jsonResponse({ message: "boom" }, { status: 500 }));
  installFetch(t, mock);
  const fallback = fakeFallback();
  const res = (await jikan(fallback).searchAnime({ q: "frieren" })) as {
    results: Record<string, unknown>[];
  };
  assert.equal(res.results[0]!["title"], "Fallback Anime");
  assert.deepEqual(fallback.calls, [
    {
      kind: "searchAnime",
      args: { q: "frieren", limit: undefined, page: undefined, sfw: undefined },
    },
  ]);
});

test("searchManga falls back to the official MAL API on a retryable upstream failure", async (t) => {
  const mock = mockFetch(() => jsonResponse({ message: "boom" }, { status: 500 }));
  installFetch(t, mock);
  const fallback = fakeFallback();
  const res = (await jikan(fallback).searchManga({ q: "naruto" })) as {
    results: Record<string, unknown>[];
  };
  assert.equal(res.results[0]!["title"], "Fallback Manga");
  assert.deepEqual(fallback.calls, [
    {
      kind: "searchManga",
      args: { q: "naruto", limit: undefined, page: undefined, sfw: undefined },
    },
  ]);
});

test("getTopAnime falls back and maps filter to the official ranking_type", async (t) => {
  const mock = mockFetch(() => jsonResponse({ message: "boom" }, { status: 500 }));
  installFetch(t, mock);
  const fallback = fakeFallback();
  const res = (await jikan(fallback).getTopAnime({ filter: "favorite" })) as {
    results: Record<string, unknown>[];
  };
  assert.equal(res.results[0]!["title"], "Fallback Top Anime");
  assert.deepEqual(fallback.calls, [
    {
      kind: "topAnime",
      args: { type: undefined, filter: "favorite", limit: undefined, page: undefined },
    },
  ]);
});

test("getTopManga falls back to the official MAL API on a retryable upstream failure", async (t) => {
  const mock = mockFetch(() => jsonResponse({ message: "boom" }, { status: 500 }));
  installFetch(t, mock);
  const fallback = fakeFallback();
  const res = (await jikan(fallback).getTopManga({})) as {
    results: Record<string, unknown>[];
  };
  assert.equal(res.results[0]!["title"], "Fallback Top Manga");
});

test("getSeason uses the caller's explicit year/season for the fallback", async (t) => {
  const mock = mockFetch(() => jsonResponse({ message: "boom" }, { status: 500 }));
  installFetch(t, mock);
  const fallback = fakeFallback();
  const res = (await jikan(fallback).getSeason({ year: 2024, season: "fall" })) as {
    results: Record<string, unknown>[];
  };
  assert.equal(res.results[0]!["title"], "Fallback Season");
  const call = fallback.calls[0] as { kind: string; args: { year: number; season: string } };
  assert.equal(call.args.year, 2024);
  assert.equal(call.args.season, "fall");
});

test("getSeason with no year/season computes the current season for the fallback", async (t) => {
  const mock = mockFetch(() => jsonResponse({ message: "boom" }, { status: 500 }));
  installFetch(t, mock);
  const fallback = fakeFallback();
  await jikan(fallback).getSeason({});
  const expected = currentSeason(new Date());
  const call = fallback.calls[0] as { kind: string; args: { year: number; season: string } };
  assert.equal(call.args.year, expected.year);
  assert.equal(call.args.season, expected.season);
});

test("getUpcomingSeason computes the season after the current one for the fallback", async (t) => {
  const mock = mockFetch(() => jsonResponse({ message: "boom" }, { status: 500 }));
  installFetch(t, mock);
  const fallback = fakeFallback();
  await jikan(fallback).getUpcomingSeason({});
  const expected = nextSeason(new Date());
  const call = fallback.calls[0] as { kind: string; args: { year: number; season: string } };
  assert.equal(call.args.year, expected.year);
  assert.equal(call.args.season, expected.season);
});

test("getAnimeRecommendations falls back to the official MAL API on a retryable upstream failure", async (t) => {
  const mock = mockFetch(() => jsonResponse({ message: "boom" }, { status: 500 }));
  installFetch(t, mock);
  const fallback = fakeFallback();
  const res = (await jikan(fallback).getAnimeRecommendations(1)) as {
    recommendations: Record<string, unknown>[];
  };
  assert.equal(res.recommendations[0]!["title"], "Fallback Anime Rec");
  assert.deepEqual(fallback.calls, [{ kind: "animeRecommendations", args: { id: 1 } }]);
});

test("getMangaRecommendations falls back to the official MAL API on a retryable upstream failure", async (t) => {
  const mock = mockFetch(() => jsonResponse({ message: "boom" }, { status: 500 }));
  installFetch(t, mock);
  const fallback = fakeFallback();
  const res = (await jikan(fallback).getMangaRecommendations(1)) as {
    recommendations: Record<string, unknown>[];
  };
  assert.equal(res.recommendations[0]!["title"], "Fallback Manga Rec");
  assert.deepEqual(fallback.calls, [{ kind: "mangaRecommendations", args: { id: 1 } }]);
});

test("getAnime falls back to the official MAL API on a retryable upstream failure", async (t) => {
  const mock = mockFetch(() => jsonResponse({ message: "boom" }, { status: 500 }));
  installFetch(t, mock);
  const fallback = fakeFallback();
  const res = (await jikan(fallback).getAnime(1)) as Record<string, unknown>;
  assert.equal(res["title"], "Fallback Anime Details");
  assert.deepEqual(fallback.calls, [{ kind: "animeDetails", args: { id: 1 } }]);
});

test("getManga falls back to the official MAL API on a retryable upstream failure", async (t) => {
  const mock = mockFetch(() => jsonResponse({ message: "boom" }, { status: 500 }));
  installFetch(t, mock);
  const fallback = fakeFallback();
  const res = (await jikan(fallback).getManga(1)) as Record<string, unknown>;
  assert.equal(res["title"], "Fallback Manga Details");
  assert.deepEqual(fallback.calls, [{ kind: "mangaDetails", args: { id: 1 } }]);
});

test("getAnimeStatistics falls back to the official MAL API on a retryable upstream failure", async (t) => {
  const mock = mockFetch(() => jsonResponse({ message: "boom" }, { status: 500 }));
  installFetch(t, mock);
  const fallback = fakeFallback();
  const res = (await jikan(fallback).getAnimeStatistics(1)) as Record<string, unknown>;
  assert.equal(res["watching"], 42);
  assert.deepEqual(fallback.calls, [{ kind: "animeStatistics", args: { id: 1 } }]);
});

test("getMangaStatistics has no fallback and still propagates the upstream ApiError", async (t) => {
  const mock = mockFetch(() => jsonResponse({ message: "boom" }, { status: 500 }));
  installFetch(t, mock);
  const fallback = fakeFallback();
  await assert.rejects(() => jikan(fallback).getMangaStatistics(1));
  assert.equal(fallback.calls.length, 0);
});

test("without a fallback configured, the upstream ApiError still propagates unchanged", async (t) => {
  const mock = mockFetch(() => jsonResponse({ message: "boom" }, { status: 500 }));
  installFetch(t, mock);
  await assert.rejects(
    () => jikan().searchAnime({ q: "frieren" }),
    (err: unknown) => err instanceof Error && /500/.test(err.message),
  );
});

test("does not fall back when the configured fallback has no client id", async (t) => {
  const mock = mockFetch(() => jsonResponse({ message: "boom" }, { status: 500 }));
  installFetch(t, mock);
  const fallback = fakeFallback(false);
  await assert.rejects(() => jikan(fallback).searchAnime({ q: "frieren" }));
  assert.equal(fallback.calls.length, 0);
});

test("does not fall back for a non-retryable error (404) even with a fallback configured", async (t) => {
  const mock = mockFetch(() => jsonResponse({ message: "nope" }, { status: 404 }));
  installFetch(t, mock);
  const fallback = fakeFallback();
  await assert.rejects(() => jikan(fallback).searchAnime({ q: "frieren" }));
  assert.equal(fallback.calls.length, 0);
});
