// Fallback-retry policy for JikanClient: when a Jikan call fails with a genuine upstream error
// (not a real 4xx) and an official-API fallback is configured, retry once there instead of
// failing the tool outright. Kept separate from jikan.ts's HTTP/caching/rate-limit mechanics —
// this module is purely about *when* and *how* to fall back, independently testable. See
// notes/jikan-reliability.md for why Jikan's live pass-through endpoints (search/top/seasonal)
// are the ones that need this.
import { ApiError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";

// Structurally satisfied by OfficialReadsClient (see server.ts wiring) — kept as an interface
// here so this module doesn't need to import that client module directly. `sfw` is the one
// Jikan filter the official API can approximate (client-side, via its `nsfw` response field —
// see officialReads.ts); genre/status/order_by/sort have no official-API equivalent at all and
// are simply unavailable during a fallback (documented degraded-mode trade-off).
export interface JikanFallback {
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
    limit?: number;
    page?: number;
  }): Promise<Record<string, unknown>>;
  topMangaOfficial(p: {
    type?: string;
    filter?: string;
    limit?: number;
    page?: number;
  }): Promise<Record<string, unknown>>;
  seasonOfficial(
    year: number,
    season: string,
    p: { limit?: number; page?: number; sfw?: boolean },
  ): Promise<Record<string, unknown>>;
}

function isUpstreamFailure(err: unknown): err is ApiError {
  return (
    err instanceof ApiError &&
    (err.code === "server_error" || err.code === "timeout" || err.code === "network")
  );
}

/** Run `primary`; on a genuine upstream failure (not a real client-side error) with a Client-ID
 *  fallback configured, retry once via `fallback` instead of throwing. `fallback` always loses
 *  some filtering fidelity vs `primary` (the official API's params don't line up 1:1 with
 *  Jikan's) — a degraded-mode trade-off, not parity. */
export async function withFallback(
  logger: Logger,
  fallback: JikanFallback | undefined,
  label: string,
  primary: () => Promise<Record<string, unknown>>,
  fallbackCall: () => Promise<Record<string, unknown>>,
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
    logger.warn(`Jikan ${label} failed (${err.code}); falling back to the official MAL API`);
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
