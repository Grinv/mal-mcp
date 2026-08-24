import { test } from "node:test";
import assert from "node:assert/strict";
import {
  withFallback,
  currentSeason,
  nextSeason,
  type ReadFallback,
} from "../clients/readFallback.js";
import { ApiError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";

function fakeLogger(): Logger & { warnings: string[] } {
  const warnings: string[] = [];
  return {
    warnings,
    debug: () => {},
    info: () => {},
    warn: (msg) => warnings.push(msg),
    error: () => {},
  };
}

function fakeFallback(hasClientId = true): ReadFallback {
  return {
    hasClientId: () => hasClientId,
    searchAnimeOfficial: async () => ({ results: [] }),
    searchMangaOfficial: async () => ({ results: [] }),
    topAnimeOfficial: async () => ({ results: [] }),
    topMangaOfficial: async () => ({ results: [] }),
    seasonOfficial: async () => ({ results: [] }),
    animeRecommendationsOfficial: async () => ({ recommendations: [] }),
    mangaRecommendationsOfficial: async () => ({ recommendations: [] }),
    animeDetailsOfficial: async () => ({ mal_id: 0 }),
    mangaDetailsOfficial: async () => ({ mal_id: 0 }),
    animeStatisticsOfficial: async () => ({}),
  };
}

test("withFallback returns the primary result without touching the fallback on success", async () => {
  const logger = fakeLogger();
  const res = await withFallback(
    logger,
    fakeFallback(),
    "test",
    async () => ({ ok: true }),
    async () => {
      throw new Error("fallback should not run");
    },
  );
  assert.deepEqual(res, { ok: true });
  assert.equal(logger.warnings.length, 0);
});

test("withFallback retries via the fallback on a retryable ApiError and logs a warning", async () => {
  const logger = fakeLogger();
  const res = await withFallback(
    logger,
    fakeFallback(),
    "anime search",
    async () => {
      throw new ApiError({ code: "server_error", message: "boom", retryable: true });
    },
    async () => ({ from: "fallback" }),
  );
  assert.deepEqual(res, { from: "fallback" });
  assert.equal(logger.warnings.length, 1);
  assert.match(logger.warnings[0]!, /anime search failed \(server_error\)/);
});

test("withFallback attaches the client_id_would_help hint (not prose) when no fallback is configured", async () => {
  const logger = fakeLogger();
  await assert.rejects(
    () =>
      withFallback(
        logger,
        undefined,
        "test",
        async () => {
          throw new ApiError({ code: "server_error", message: "boom", retryable: true });
        },
        async () => ({ from: "fallback" }),
      ),
    (err: unknown) =>
      err instanceof ApiError &&
      err.code === "server_error" &&
      err.retryable === true &&
      err.message === "boom" && // unmodified — messageFor(), not this module, owns the hint's prose
      err.hint === "client_id_would_help",
  );
});

test("withFallback attaches the same hint when the fallback has no client id", async () => {
  const logger = fakeLogger();
  await assert.rejects(
    () =>
      withFallback(
        logger,
        fakeFallback(false),
        "test",
        async () => {
          throw new ApiError({ code: "server_error", message: "boom", retryable: true });
        },
        async () => ({ from: "fallback" }),
      ),
    (err: unknown) => err instanceof ApiError && err.hint === "client_id_would_help",
  );
  assert.equal(logger.warnings.length, 0);
});

test("withFallback rethrows a non-upstream error (e.g. bad_request) without trying the fallback", async () => {
  const logger = fakeLogger();
  await assert.rejects(() =>
    withFallback(
      logger,
      fakeFallback(),
      "test",
      async () => {
        throw new ApiError({ code: "bad_request", message: "nope", retryable: false });
      },
      async () => ({ from: "fallback" }),
    ),
  );
  assert.equal(logger.warnings.length, 0);
});

test("withFallback rethrows a non-ApiError without trying the fallback", async () => {
  const logger = fakeLogger();
  await assert.rejects(
    () =>
      withFallback(
        logger,
        fakeFallback(),
        "test",
        async () => {
          throw new Error("plain error");
        },
        async () => ({ from: "fallback" }),
      ),
    /plain error/,
  );
  assert.equal(logger.warnings.length, 0);
});

test("currentSeason/nextSeason follow MAL's month grouping and wrap the year at winter", () => {
  assert.deepEqual(currentSeason(new Date(Date.UTC(2026, 0, 15))), {
    year: 2026,
    season: "winter",
  });
  assert.deepEqual(currentSeason(new Date(Date.UTC(2026, 3, 1))), { year: 2026, season: "spring" });
  assert.deepEqual(currentSeason(new Date(Date.UTC(2026, 6, 1))), { year: 2026, season: "summer" });
  assert.deepEqual(currentSeason(new Date(Date.UTC(2026, 9, 1))), { year: 2026, season: "fall" });
  assert.deepEqual(nextSeason(new Date(Date.UTC(2026, 9, 1))), { year: 2027, season: "winter" });
});

test("withFallback falls back on a Tenrai 429 rather than surfacing the rate limit", async () => {
  const logger = fakeLogger();
  const out = await withFallback(
    logger,
    fakeFallback(),
    "anime search",
    async () => {
      throw new ApiError({ code: "rate_limited", status: 429, retryable: true, message: "429" });
    },
    async () => ({ results: ["official"] }),
  );
  assert.deepEqual(out, { results: ["official"] });
});

test("withFallback falls back when Tenrai answers 200 with unparseable JSON", async () => {
  const logger = fakeLogger();
  const out = await withFallback(
    logger,
    fakeFallback(),
    "anime search",
    async () => {
      throw new ApiError({ code: "unknown", message: "Upstream returned invalid JSON" });
    },
    async () => ({ results: ["official"] }),
  );
  assert.deepEqual(out, { results: ["official"] });
});

test("a 429 with no Client ID configured carries the client_id_would_help hint", async () => {
  const logger = fakeLogger();
  await assert.rejects(
    withFallback(
      logger,
      fakeFallback(false),
      "anime search",
      async () => {
        throw new ApiError({ code: "rate_limited", status: 429, retryable: true, message: "429" });
      },
      async () => ({ results: ["official"] }),
    ),
    (err: unknown) =>
      err instanceof ApiError && err.code === "rate_limited" && err.hint === "client_id_would_help",
  );
});

test("a failing fallback rethrows the original Tenrai error, not the fallback's own", async () => {
  // The regression this guards: a revoked Client ID turned a Tenrai outage into "MyAnimeList
  // rejected the access token — run login_mal" on a read tool that needs no token at all.
  const logger = fakeLogger();
  await assert.rejects(
    withFallback(
      logger,
      fakeFallback(),
      "anime search",
      async () => {
        throw new ApiError({
          code: "server_error",
          status: 503,
          retryable: true,
          message: "HTTP 503",
        });
      },
      async () => {
        throw new ApiError({ code: "unauthorized", status: 401, message: "HTTP 401" });
      },
    ),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.code, "server_error");
      assert.equal(err.status, 503);
      assert.match(err.message, /HTTP 503 \(the official MAL API fallback also failed\)/);
      return true;
    },
  );
  assert.ok(
    logger.warnings.some((w) => /fallback for anime search also failed \(unauthorized\)/.test(w)),
  );
});

test("withFallback signals a caller when the fallback served the response", async () => {
  const logger = fakeLogger();
  let degraded = false;
  await withFallback(
    logger,
    fakeFallback(),
    "anime details",
    async () => {
      throw new ApiError({ code: "server_error", status: 503, retryable: true, message: "503" });
    },
    async () => ({ mal_id: 1 }),
    () => {
      degraded = true;
    },
  );
  assert.equal(degraded, true);
});

test("withFallback leaves the signal untouched when the primary succeeds", async () => {
  const logger = fakeLogger();
  let degraded = false;
  await withFallback(
    logger,
    fakeFallback(),
    "anime details",
    async () => ({ mal_id: 1 }),
    async () => ({ mal_id: 2 }),
    () => {
      degraded = true;
    },
  );
  assert.equal(degraded, false);
});
