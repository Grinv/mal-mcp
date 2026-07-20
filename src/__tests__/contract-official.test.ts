// Live contract tests against the real official MAL API's Client-ID-only public
// reads (OfficialReadsClient/formatOfficial.ts). Skipped unless RUN_LIVE is set
// AND a real MAL_CLIENT_ID is present — see docs/auth.md.
//   RUN_LIVE=1 npm test   (reads .env via --env-file, see scripts/run-tests.mjs)
import { test } from "node:test";
import assert from "node:assert/strict";
import { OfficialReadsClient } from "../clients/officialReads.js";
import { currentSeason } from "../clients/jikanFallback.js";
import { loadConfig } from "../config.js";
import { silentLogger } from "./helpers.js";

const skip =
  process.env.RUN_LIVE && process.env.MAL_CLIENT_ID
    ? false
    : "set RUN_LIVE=1 and MAL_CLIENT_ID to run live official-API contract tests";

const client = new OfficialReadsClient(loadConfig(), silentLogger());

test(
  "live: searchAnimeOfficial maps a real response onto AnimeSummaryFields",
  { skip },
  async () => {
    const res = (await client.searchAnimeOfficial({ q: "frieren", limit: 1 })) as {
      results: Record<string, unknown>[];
    };
    assert.ok(res.results.length >= 1);
    const first = res.results[0]!;
    assert.equal(typeof first["mal_id"], "number");
    assert.equal(typeof first["title"], "string");
    assert.match(first["url"] as string, /^https:\/\/myanimelist\.net\/anime\//);
  },
);

test("live: topMangaOfficial maps a real response onto MangaSummaryFields", { skip }, async () => {
  const res = (await client.topMangaOfficial({ limit: 1 })) as {
    results: Record<string, unknown>[];
  };
  assert.ok(res.results.length >= 1);
  const first = res.results[0]!;
  assert.equal(typeof first["mal_id"], "number");
  assert.equal(typeof first["title"], "string");
});

test("live: seasonOfficial(current) returns a list", { skip }, async () => {
  const { year, season } = currentSeason(new Date());
  const res = (await client.seasonOfficial(year, season, { limit: 1 })) as {
    results: unknown[];
  };
  assert.ok(Array.isArray(res.results));
});

test(
  "live: animeRecommendationsOfficial maps a real response onto {mal_id,title,votes,url}",
  { skip },
  async () => {
    const res = (await client.animeRecommendationsOfficial(1)) as {
      recommendations: Record<string, unknown>[];
    };
    assert.ok(res.recommendations.length >= 1);
    const first = res.recommendations[0]!;
    assert.equal(typeof first["mal_id"], "number");
    assert.equal(typeof first["title"], "string");
    assert.match(first["url"] as string, /^https:\/\/myanimelist\.net\/anime\//);
  },
);

test(
  "live: animeDetailsOfficial returns detail-mode fields for a real anime",
  { skip },
  async () => {
    const res = await client.animeDetailsOfficial(1); // Cowboy Bebop
    assert.equal(typeof res["mal_id"], "number");
    assert.equal(typeof res["title"], "string");
    assert.equal(typeof res["synopsis"], "string");
  },
);

test(
  "live: mangaDetailsOfficial returns detail-mode fields for a real manga",
  { skip },
  async () => {
    const res = await client.mangaDetailsOfficial(2); // Berserk
    assert.equal(typeof res["mal_id"], "number");
    assert.equal(typeof res["title"], "string");
  },
);

test(
  "live: animeStatisticsOfficial returns watch-status counts for a real anime",
  { skip },
  async () => {
    const res = await client.animeStatisticsOfficial(1); // Cowboy Bebop
    assert.equal(typeof res["total"], "number");
    assert.equal(typeof res["completed"], "number");
  },
);
