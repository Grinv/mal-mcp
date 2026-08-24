// Fallback-retry policy for TenraiClient: when a Tenrai call fails with a genuine upstream error
// (not a real 4xx) and an official-API fallback is configured, retry once there instead of
// failing the tool outright. Kept separate from tenrai.ts's HTTP/caching/rate-limit mechanics —
// this module is purely about *when* and *how* to fall back, independently testable. Tenrai is
// itself a beta service (per its own docs) that can have its own outages independent of MAL's —
// this fallback tier is defense-in-depth against that, not against any one upstream's specific
// failure mode.
import { ApiError, type ApiErrorCode } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";

// Structurally satisfied by OfficialReadsClient (see server.ts wiring) — kept as an interface
// here so this module doesn't need to import that client module directly. `sfw` is the one
// filter the official API can approximate (client-side, via its `nsfw` response field —
// see officialReads.ts); genre/status/order_by/sort have no official-API equivalent at all and
// are simply unavailable during a fallback (documented degraded-mode trade-off).
export interface ReadFallback {
  hasClientId(): boolean;
  searchAnimeOfficial(p: {
    q: string;
    limit?: number;
    page?: number;
    sfw?: boolean;
  }): Promise<Record<string, unknown>>;
  searchMangaOfficial(p: {
    q: string;
    limit?: number;
    page?: number;
    sfw?: boolean;
  }): Promise<Record<string, unknown>>;
  topAnimeOfficial(p: {
    type?: string;
    filter?: string;
    sfw?: boolean;
    limit?: number;
    page?: number;
  }): Promise<Record<string, unknown>>;
  topMangaOfficial(p: {
    type?: string;
    filter?: string;
    sfw?: boolean;
    limit?: number;
    page?: number;
  }): Promise<Record<string, unknown>>;
  seasonOfficial(
    year: number,
    season: string,
    p: { limit?: number; page?: number; sfw?: boolean },
  ): Promise<Record<string, unknown>>;
  animeRecommendationsOfficial(id: number): Promise<Record<string, unknown>>;
  mangaRecommendationsOfficial(id: number): Promise<Record<string, unknown>>;
  animeDetailsOfficial(id: number): Promise<Record<string, unknown>>;
  mangaDetailsOfficial(id: number): Promise<Record<string, unknown>>;
  animeStatisticsOfficial(id: number): Promise<Record<string, unknown>>;
}

// Codes meaning "the primary backend is the problem", so asking a *different* backend can
// plausibly work:
//  - server_error / timeout / network: Tenrai is broken, slow or unreachable.
//  - rate_limited: Tenrai's quota is keyed to our IP, while the official API's is keyed to the
//    Client ID. RateLimiter is also per-process, so two server instances on one machine already
//    share Tenrai's budget without knowing it — a 429 here says nothing about the official path.
//    By the time withFallback sees it, http.ts has already exhausted its Retry-After backoff.
//  - unknown: what http.ts raises for "Upstream returned invalid JSON", i.e. a 200 carrying a CDN
//    or maintenance HTML page. That is an outage wearing a success status.
// Everything else (400/401/403/404/422) is a real answer about the request itself, and the
// official API would answer the same way.
const UPSTREAM_FAILURE_CODES = new Set<ApiErrorCode>([
  "server_error",
  "timeout",
  "network",
  "rate_limited",
  "unknown",
]);

function isUpstreamFailure(err: unknown): err is ApiError {
  return err instanceof ApiError && UPSTREAM_FAILURE_CODES.has(err.code);
}

/** Run `primary`; on a genuine upstream failure (not a real client-side error) with a Client-ID
 *  fallback configured, retry once via `fallback` instead of throwing. `fallback` always loses
 *  some filtering fidelity vs `primary` (the official API's params don't line up 1:1 with
 *  Tenrai's) — a degraded-mode trade-off, not parity. `onFallback` fires just before that retry,
 *  so a caching caller can tell a full primary response apart from a thinner fallback one and
 *  decline to cache the latter. */
export async function withFallback(
  logger: Logger,
  fallback: ReadFallback | undefined,
  label: string,
  primary: () => Promise<Record<string, unknown>>,
  fallbackCall: () => Promise<Record<string, unknown>>,
  onFallback?: () => void,
): Promise<Record<string, unknown>> {
  try {
    return await primary();
  } catch (err) {
    if (!isUpstreamFailure(err)) throw err;
    if (!fallback?.hasClientId()) {
      // No fallback available for this genuine upstream failure — surface a fact, not prose;
      // result.ts's messageFor() owns the actual sentence for the "client_id_would_help" hint.
      throw new ApiError({
        code: err.code,
        status: err.status,
        retryable: err.retryable,
        message: err.message,
        cause: err,
        hint: "client_id_would_help",
      });
    }
    logger.warn(`Tenrai ${label} failed (${err.code}); falling back to the official MAL API`);
    return fallbackCall();
  }
}

export const SEASON_ORDER = ["winter", "spring", "summer", "fall"] as const;

/** The anime season (per MAL's own month grouping — winter=Jan-Mar, etc.) containing `now`. */
export function currentSeason(now: Date): { year: number; season: string } {
  return { year: now.getUTCFullYear(), season: SEASON_ORDER[Math.floor(now.getUTCMonth() / 3)]! };
}

/** The season following `now`'s — used for the upcoming-season fallback (the official API has no
 *  direct "upcoming" endpoint, only `season/{year}/{season}`, so the caller must compute it). */
export function nextSeason(now: Date): { year: number; season: string } {
  const cur = currentSeason(now);
  const idx = SEASON_ORDER.indexOf(cur.season as (typeof SEASON_ORDER)[number]);
  return idx === SEASON_ORDER.length - 1
    ? { year: cur.year + 1, season: SEASON_ORDER[0] }
    : { year: cur.year, season: SEASON_ORDER[idx + 1]! };
}
