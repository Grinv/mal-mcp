// Public (Client-ID-only, no OAuth) reads from the official MAL API. Used as a fallback for
// search_anime/search_manga/get_top_anime/get_top_manga/get_seasonal_anime/get_upcoming_season
// when Jikan's live pass-through to MAL is degraded (see notes/jikan-reliability.md).
// Structurally implements JikanFallback (see clients/jikan.ts) — neither module imports the
// other. Deliberately separate from MalClient: that class is about OAuth-authenticated
// personal-list reads/writes, this one needs no user token at all, just an app registration.
import { HttpClient } from "../lib/http.js";
import { ApiError } from "../lib/errors.js";
import { RateLimiter } from "../lib/rateLimit.js";
import { malApiHttpClient } from "./httpClients.js";
import {
  summarizeOfficialAnime,
  summarizeOfficialManga,
  type OfficialAnimeNode,
  type OfficialMangaNode,
} from "../lib/formatOfficial.js";
import type { Logger } from "../lib/logger.js";
import type { Config } from "../config.js";

// The official API returns only `id,title,main_picture` unless every other field is requested
// explicitly. `authors{first_name,last_name}` is the API's nested-field syntax for sub-objects.
// `nsfw` (white/gray/black — verified live) is always requested so #list can honor `sfw` by
// filtering client-side; the official API has no server-side nsfw-exclusion query param.
const ANIME_FIELDS =
  "alternative_titles,start_date,start_season,synopsis,mean,rank,popularity,num_list_users," +
  "media_type,status,genres,num_episodes,rating,studios,nsfw";
const MANGA_FIELDS =
  "alternative_titles,start_date,synopsis,mean,rank,popularity,num_list_users,media_type,status," +
  "genres,num_chapters,num_volumes,authors{first_name,last_name},nsfw";

// Official `ranking_type` enums (verified against myanimelist.net/apiconfig/references/api/v2 —
// there is no combined type+filter like Jikan's TopParams, just one enum value per request).
const ANIME_RANKING_TYPES = new Set([
  "all",
  "airing",
  "upcoming",
  "tv",
  "ova",
  "movie",
  "special",
  "bypopularity",
  "favorite",
]);
const MANGA_RANKING_TYPES = new Set([
  "all",
  "manga",
  "novels",
  "oneshots",
  "doujin",
  "manhwa",
  "manhua",
  "bypopularity",
  "favorite",
]);
// Jikan's manga `type` values don't all have an official ranking_type match (e.g. "lightnovel");
// map to the closest official bucket rather than dropping the filter entirely.
const MANGA_TYPE_TO_RANKING: Record<string, string> = {
  manga: "manga",
  novel: "novels",
  lightnovel: "novels",
  oneshot: "oneshots",
  doujin: "doujin",
  manhwa: "manhwa",
  manhua: "manhua",
};

interface RankingParams {
  type?: string;
  filter?: string;
}

// Best-effort mapping, not parity: Jikan's TopParams separates `type` and `filter`, the official
// API takes one ranking_type. Prefer `filter` (closer semantic match), fall back to `type`, else "all".
function pickAnimeRankingType(p: RankingParams): string {
  if (p.filter && ANIME_RANKING_TYPES.has(p.filter)) return p.filter;
  if (p.type && ANIME_RANKING_TYPES.has(p.type)) return p.type;
  return "all";
}

function pickMangaRankingType(p: RankingParams): string {
  if (p.filter && MANGA_RANKING_TYPES.has(p.filter)) return p.filter;
  if (p.type && MANGA_TYPE_TO_RANKING[p.type]) return MANGA_TYPE_TO_RANKING[p.type]!;
  return "all";
}

// MAL's own age-rating field: "white" = safe, "gray"/"black" = suggestive/explicit. Fail closed
// (exclude unless explicitly "white") — this filter's only job is honoring an explicit
// `sfw: true` request, so treating a missing/unexpected value as unsafe is the correct default.
function isSfw(node: { nsfw?: string | null }): boolean {
  return node.nsfw === "white";
}

export interface OfficialSearchParams {
  q: string;
  limit?: number;
  page?: number;
  sfw?: boolean;
}

export interface OfficialTopParams {
  type?: string;
  filter?: string;
  limit?: number;
  page?: number;
}

export interface OfficialSeasonParams {
  limit?: number;
  page?: number;
  sfw?: boolean;
}

// No documented rate limit for MAL's official API (unlike Jikan's published 3/s+60/min — see
// docs/api-references.md). A conservative per-request spacing avoids bursting it during exactly
// the Jikan-outage scenario this fallback exists for, when many concurrent read-tool calls could
// otherwise fail over at once with no client-side throttling at all.
const MIN_INTERVAL_MS = 350;

export class OfficialReadsClient {
  readonly #http: HttpClient;
  readonly #clientId: string | undefined;

  constructor(config: Config, logger: Logger) {
    this.#clientId = config.auth.clientId;
    const limiter = new RateLimiter(MIN_INTERVAL_MS);
    this.#http = malApiHttpClient(config, logger, { beforeRequest: () => limiter.acquire() });
  }

  /** Whether Client-ID-only public reads are available (just an app registration — no
   *  user login needed), independent of MalClient's personal-list `isConfigured()`. */
  hasClientId(): boolean {
    return Boolean(this.#clientId);
  }

  searchAnimeOfficial(p: OfficialSearchParams): Promise<Record<string, unknown>> {
    return this.#list<OfficialAnimeNode>(
      "anime",
      ANIME_FIELDS,
      { q: p.q },
      p,
      summarizeOfficialAnime,
    );
  }

  searchMangaOfficial(p: OfficialSearchParams): Promise<Record<string, unknown>> {
    return this.#list<OfficialMangaNode>(
      "manga",
      MANGA_FIELDS,
      { q: p.q },
      p,
      summarizeOfficialManga,
    );
  }

  topAnimeOfficial(p: OfficialTopParams): Promise<Record<string, unknown>> {
    return this.#list<OfficialAnimeNode>(
      "anime/ranking",
      ANIME_FIELDS,
      { ranking_type: pickAnimeRankingType(p) },
      p,
      summarizeOfficialAnime,
    );
  }

  topMangaOfficial(p: OfficialTopParams): Promise<Record<string, unknown>> {
    return this.#list<OfficialMangaNode>(
      "manga/ranking",
      MANGA_FIELDS,
      { ranking_type: pickMangaRankingType(p) },
      p,
      summarizeOfficialManga,
    );
  }

  seasonOfficial(
    year: number,
    season: string,
    p: OfficialSeasonParams,
  ): Promise<Record<string, unknown>> {
    return this.#list<OfficialAnimeNode>(
      `anime/season/${year}/${season}`,
      ANIME_FIELDS,
      {},
      p,
      summarizeOfficialAnime,
    );
  }

  async #list<T extends { nsfw?: string | null }>(
    path: string,
    fields: string,
    extraQuery: Record<string, string | undefined>,
    p: { limit?: number; page?: number; sfw?: boolean },
    summarize: (node: T) => Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!this.#clientId) {
      throw new ApiError({ code: "unauthorized", message: "MAL_CLIENT_ID not configured" });
    }
    const limit = p.limit ?? 25;
    // Official API paginates by offset, not by page number.
    const offset = ((p.page ?? 1) - 1) * limit;
    const res = await this.#http.getJson<{
      data: { node: T }[];
      paging?: { next?: string };
    }>(path, {
      query: { ...extraQuery, limit, offset, fields },
      headers: { "X-MAL-CLIENT-ID": this.#clientId },
    });
    // Client-side nsfw exclusion (see isSfw): the official API has no server-side equivalent of
    // Jikan's `sfw` param, so this is the fallback's one way to honor an explicit `sfw: true`.
    // Filtering after the page is fetched means a filtered page can come back shorter than
    // `limit` even when more results exist upstream — an accepted degraded-mode trade-off.
    const nodes = p.sfw ? res.data.filter((d) => isSfw(d.node)) : res.data;
    return {
      results: nodes.map((d) => summarize(d.node)),
      page: { has_next_page: Boolean(res.paging?.next) },
    };
  }
}
