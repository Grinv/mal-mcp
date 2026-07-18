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
