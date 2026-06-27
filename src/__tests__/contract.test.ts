// Live contract tests against the real Jikan API. Skipped unless RUN_LIVE is
// set, so the default unit suite stays offline and deterministic. These assert
// key fields exist (not just HTTP 200), catching upstream schema drift.
//   RUN_LIVE=1 npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { JikanClient } from "../clients/jikan.js";
import { loadConfig } from "../config.js";
import { silentLogger } from "./helpers.js";

const skip = process.env.RUN_LIVE ? false : "set RUN_LIVE=1 to run live contract tests";
const client = new JikanClient(loadConfig({ JIKAN_MIN_INTERVAL_MS: "700" }), silentLogger());

test("live: searchAnime returns results with expected fields", { skip }, async () => {
  const res = (await client.searchAnime({ q: "frieren", limit: 1 })) as {
    results: Record<string, unknown>[];
  };
  assert.ok(res.results.length >= 1);
  const first = res.results[0]!;
  assert.equal(typeof first["mal_id"], "number");
  assert.equal(typeof first["title"], "string");
});

test("live: getAnime returns detailed fields", { skip }, async () => {
  const a = (await client.getAnime(52991)) as Record<string, unknown>;
  assert.equal(typeof a["title"], "string");
  assert.equal(typeof a["synopsis"], "string");
});

test("live: getSeason(now) returns a list", { skip }, async () => {
  const res = (await client.getSeason({ limit: 1 })) as { results: unknown[] };
  assert.ok(Array.isArray(res.results));
});
