import { test } from "node:test";
import assert from "node:assert/strict";
import {
  withFallback,
  currentSeason,
  nextSeason,
  type JikanFallback,
} from "../clients/jikanFallback.js";
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

function fakeFallback(hasClientId = true): JikanFallback {
  return {
    hasClientId: () => hasClientId,
    searchAnimeOfficial: async () => ({ results: [] }),
    searchMangaOfficial: async () => ({ results: [] }),
    topAnimeOfficial: async () => ({ results: [] }),
    topMangaOfficial: async () => ({ results: [] }),
    seasonOfficial: async () => ({ results: [] }),
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
