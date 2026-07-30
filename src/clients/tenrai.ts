// Read-only client for the Tenrai API (a free, unofficial MyAnimeList mirror — no credentials
// needed). Wraps HttpClient with a polite rate limiter and a TTL cache. It only fetches and
// caches; all raw→agent-facing shaping lives in ../lib/format.js.
import { HttpClient } from "../lib/http.js";
import type { RateRule } from "../lib/rateLimit.js";
import { TtlCache } from "../lib/cache.js";
import { withThrottle } from "./httpClients.js";
import { withFallback, currentSeason, nextSeason, type ReadFallback } from "./readFallback.js";
import {
  pageInfo,
  summarizeAnime,
  summarizeManga,
  summarizeCharacters,
  summarizeRecommendations,
  summarizeReviews,
  summarizeEpisodes,
  summarizeGenres,
  summarizeCharacter,
  summarizePerson,
  summarizeStaff,
  summarizeStatistics,
  summarizeProducer,
  summarizeSeasonsList,
  summarizeNewsItem,
  type AnimeMangaRaw,
  type RawPagination,
  type RawCharacter,
  type RawRecommendation,
  type RawReview,
  type RawEpisode,
  type RawGenre,
  type RawCharacterEntity,
  type RawPersonEntity,
  type RawStaff,
  type RawStatistics,
  type RawProducer,
  type RawSeasonEntry,
  type RawNewsItem,
} from "../lib/format.js";
import type { Logger } from "../lib/logger.js";
import type { Config } from "../config.js";

type Query = Record<string, string | number | boolean | undefined>;

interface ListResponse<T> {
  data: T[];
  pagination?: RawPagination;
}
interface ItemResponse<T> {
  data: T;
}

// Shared by the plain-name-search endpoints (characters/people/producers) — no content
// filtering, just find-by-name plus ordering/pagination/alphabetical browse.
export interface SearchParams {
  q?: string;
  order_by?: string;
  sort?: string;
  limit?: number;
  page?: number;
  letter?: string;
}

// searchAnime/searchManga's much larger filter set — kept separate from SearchParams so a
// plain-name search interface doesn't carry a dozen anime/manga-only fields it never uses.
export interface AnimeMangaSearchParams extends SearchParams {
  type?: string[];
  status?: string;
  genres?: string;
  genres_exclude?: string;
  sfw?: boolean;
  sfw_strict?: boolean;
  rating?: string[];
  score?: number;
  min_score?: number;
  max_score?: number;
  producers?: string;
  magazines?: string;
  start_date?: string;
  end_date?: string;
  unapproved?: boolean;
}

export interface TopParams {
  type?: string[];
  filter?: string;
  rating?: string[];
  sfw?: boolean;
  sfw_strict?: boolean;
  limit?: number;
  page?: number;
}

export interface SeasonParams {
  year?: number;
  season?: string;
  limit?: number;
  page?: number;
  sfw?: boolean;
  sfw_strict?: boolean;
  filter?: string[];
  rating?: string[];
  unapproved?: boolean;
  continuing?: boolean;
  kids?: boolean;
  order_by?: string;
  sort?: string;
}

export interface ScheduleParams {
  day?: string;
  limit: number;
  sfw?: boolean;
  sfw_strict?: boolean;
  kids?: boolean;
  unapproved?: boolean;
  page?: number;
}

export interface ReviewParams {
  page?: number;
  sort?: string;
  preliminary?: string;
  spoilers?: string;
  sentiment?: string;
}

/** Tenrai's stricter NSFW filter is the hyphenated query param `sfw-strict` — not a valid JS
 *  object-literal identifier — so `{...p}` alone would send it verbatim under the wrong
 *  (underscored) name. Spread this alongside `{...p}` to correct it: it blanks the wrong key
 *  and adds the right one. */
function sfwStrictQuery(sfwStrict: boolean | undefined): Record<string, boolean | undefined> {
  return { sfw_strict: undefined, "sfw-strict": sfwStrict };
}

/** Tenrai's array-typed query params (`type`, `rating`, seasonal `filter`) use OpenAPI's
 *  `style: form, explode: false` — a single comma-joined string, not repeated query keys. */
function csv(values: string[] | undefined): string | undefined {
  return values && values.length > 0 ? values.join(",") : undefined;
}

/** Shared query-builder for the three `/seasons/*` list endpoints (`{year}/{season}`, `now`,
 *  `upcoming`) — they all accept the same filter set. */
function seasonQuery(p: SeasonParams): Query {
  return {
    filter: csv(p.filter),
    rating: csv(p.rating),
    limit: p.limit,
    page: p.page,
    sfw: p.sfw,
    unapproved: p.unapproved,
    continuing: p.continuing,
    kids: p.kids,
    order_by: p.order_by,
    sort: p.sort,
    ...sfwStrictQuery(p.sfw_strict),
  };
}

// Tenrai's published limits (see api.tenrai.org/llms.txt "Auth & Rate Limits"): 4 req/s AND
// 120 req/min for unauthenticated (public) access. A min-interval alone covers the per-second
// cap but not the sustained per-minute one, so both windows are enforced.
const TENRAI_RATE_RULES: RateRule[] = [
  { limit: 4, windowMs: 1000 },
  { limit: 120, windowMs: 60_000 },
];

export class TenraiClient {
  readonly #http: HttpClient;
  readonly #cache: TtlCache<Record<string, unknown>>;
  readonly #logger: Logger;
  readonly #fallback: ReadFallback | undefined;

  constructor(config: Config, logger: Logger, fallback?: ReadFallback) {
    // A zero interval disables client-side throttling entirely (used in tests);
    // otherwise enforce both the min interval and Tenrai's documented windows.
    this.#http = new HttpClient({
      baseUrl: config.tenraiBaseUrl,
      logger,
      timeoutMs: config.httpTimeoutMs,
      retries: config.httpRetries,
      ...withThrottle(
        config.tenraiMinIntervalMs,
        config.tenraiMinIntervalMs === 0 ? [] : TENRAI_RATE_RULES,
      ),
    });
    this.#cache = new TtlCache(config.cacheTtlMs);
    this.#logger = logger;
    this.#fallback = fallback;
  }

  /** Fetch a paginated list and map each item through `summarize`. A single
   *  malformed item (e.g. missing a field its outputSchema requires) is
   *  dropped with a warning instead of failing the whole page — one bad
   *  entry in a 25-item response shouldn't cost the agent all 25 results. */
  async #list<T>(
    path: string,
    query: Query,
    summarize: (item: T) => Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const res = await this.#http.getJson<ListResponse<T>>(path, { query });
    const results: Record<string, unknown>[] = [];
    for (const item of res.data) {
      try {
        results.push(summarize(item));
      } catch (err) {
        this.#logger.warn(`dropping malformed ${path} list item`, err);
      }
    }
    return { results, page: pageInfo(res.pagination) };
  }

  /** Cache by `key`, GET `path`, then shape the raw `data` (item or array). */
  async #cached<T>(
    key: string,
    path: string,
    shape: (data: T) => Record<string, unknown>,
    query?: Query,
  ): Promise<Record<string, unknown>> {
    return this.#cache.wrapStaleOnError(key, async () => {
      const res = await this.#http.getJson<ItemResponse<T>>(path, query ? { query } : undefined);
      return shape(res.data);
    });
  }

  async searchAnime(p: AnimeMangaSearchParams): Promise<Record<string, unknown>> {
    return withFallback(
      this.#logger,
      this.#fallback,
      "anime search",
      () =>
        this.#list<AnimeMangaRaw>(
          "anime",
          { ...p, type: csv(p.type), rating: csv(p.rating), ...sfwStrictQuery(p.sfw_strict) },
          (a) => summarizeAnime(a),
        ),
      () =>
        this.#fallback!.searchAnimeOfficial({
          q: p.q ?? "",
          limit: p.limit,
          page: p.page,
          // The official API's client-side nsfw filter can't distinguish "adult-rated" from
          // "genre-tagged Ecchi but otherwise safe" — sfw_strict degrades to the same sfw
          // filtering as a plain `sfw: true` during a fallback (documented gap, not a bug).
          sfw: p.sfw || p.sfw_strict,
        }),
    );
  }

  async searchManga(p: AnimeMangaSearchParams): Promise<Record<string, unknown>> {
    return withFallback(
      this.#logger,
      this.#fallback,
      "manga search",
      () =>
        this.#list<AnimeMangaRaw>(
          "manga",
          { ...p, type: csv(p.type), rating: csv(p.rating), ...sfwStrictQuery(p.sfw_strict) },
          (m) => summarizeManga(m),
        ),
      () =>
        this.#fallback!.searchMangaOfficial({
          q: p.q ?? "",
          limit: p.limit,
          page: p.page,
          sfw: p.sfw || p.sfw_strict,
        }),
    );
  }

  async getAnime(id: number): Promise<Record<string, unknown>> {
    return this.#cache.wrapStaleOnError(`anime:${id}`, () =>
      withFallback(
        this.#logger,
        this.#fallback,
        "anime details",
        async () => {
          const res = await this.#http.getJson<ItemResponse<AnimeMangaRaw>>(`anime/${id}/full`);
          return summarizeAnime(res.data, true);
        },
        () => this.#fallback!.animeDetailsOfficial(id),
      ),
    );
  }

  async getManga(id: number): Promise<Record<string, unknown>> {
    return this.#cache.wrapStaleOnError(`manga:${id}`, () =>
      withFallback(
        this.#logger,
        this.#fallback,
        "manga details",
        async () => {
          const res = await this.#http.getJson<ItemResponse<AnimeMangaRaw>>(`manga/${id}/full`);
          return summarizeManga(res.data, true);
        },
        () => this.#fallback!.mangaDetailsOfficial(id),
      ),
    );
  }

  async getAnimeCharacters(id: number): Promise<Record<string, unknown>> {
    return this.#cached<RawCharacter[]>(`anime-characters:${id}`, `anime/${id}/characters`, (d) =>
      summarizeCharacters(d, true),
    );
  }

  async getMangaCharacters(id: number): Promise<Record<string, unknown>> {
    return this.#cached<RawCharacter[]>(`manga-characters:${id}`, `manga/${id}/characters`, (d) =>
      summarizeCharacters(d, false),
    );
  }

  async getAnimeRecommendations(id: number): Promise<Record<string, unknown>> {
    return this.#recommendations("anime", id);
  }

  async getMangaRecommendations(id: number): Promise<Record<string, unknown>> {
    return this.#recommendations("manga", id);
  }

  #recommendations(kind: "anime" | "manga", id: number): Promise<Record<string, unknown>> {
    return this.#cache.wrapStaleOnError(`${kind}-recs:${id}`, () =>
      withFallback(
        this.#logger,
        this.#fallback,
        `${kind} recommendations`,
        async () => {
          const res = await this.#http.getJson<ItemResponse<RawRecommendation[]>>(
            `${kind}/${id}/recommendations`,
          );
          return summarizeRecommendations(res.data);
        },
        () =>
          kind === "anime"
            ? this.#fallback!.animeRecommendationsOfficial(id)
            : this.#fallback!.mangaRecommendationsOfficial(id),
      ),
    );
  }

  async getAnimeReviews(
    id: number,
    limit: number,
    params: ReviewParams = {},
  ): Promise<Record<string, unknown>> {
    return this.#reviews("anime", id, limit, params);
  }

  async getMangaReviews(
    id: number,
    limit: number,
    params: ReviewParams = {},
  ): Promise<Record<string, unknown>> {
    return this.#reviews("manga", id, limit, params);
  }

  // Reviews are not cached: they are paginated and change as users post.
  // Tenrai's `/{kind}/{id}/reviews` has no `limit` param at all (confirmed against its
  // OpenAPI spec and live: `?limit=1` and `?limit=2` both still return a full 20-review
  // page) — `limit` is applied here, client-side, to actually honor the tool's own
  // documented default/cap instead of silently ignoring it. `page`/`sort`/`preliminary`/
  // `spoilers`/`sentiment` ARE real upstream params (unlike `limit`) and are forwarded as-is.
  async #reviews(
    kind: "anime" | "manga",
    id: number,
    limit: number,
    params: ReviewParams,
  ): Promise<Record<string, unknown>> {
    const res = await this.#http.getJson<ListResponse<RawReview>>(`${kind}/${id}/reviews`, {
      query: { ...params },
    });
    return summarizeReviews(res.data.slice(0, limit));
  }

  // Not cached: the response is paginated, and the cache key here would not
  // include `page`, so caching would return the wrong page on later calls.
  async getAnimeEpisodes(id: number, page?: number): Promise<Record<string, unknown>> {
    const res = await this.#http.getJson<ListResponse<RawEpisode>>(`anime/${id}/episodes`, {
      query: { page },
    });
    return summarizeEpisodes(res.data, res.pagination);
  }

  async getAnimeGenres(filter?: string): Promise<Record<string, unknown>> {
    return this.#genres("anime", filter);
  }

  async getMangaGenres(filter?: string): Promise<Record<string, unknown>> {
    return this.#genres("manga", filter);
  }

  // Genre IDs feed the `genres` param of search_*; they rarely change, so cache.
  #genres(kind: "anime" | "manga", filter?: string): Promise<Record<string, unknown>> {
    return this.#cached<RawGenre[]>(
      `genres:${kind}:${filter ?? "all"}`,
      `genres/${kind}`,
      summarizeGenres,
      { filter },
    );
  }

  async getTopAnime(p: TopParams): Promise<Record<string, unknown>> {
    return withFallback(
      this.#logger,
      this.#fallback,
      "top anime",
      () =>
        this.#list<AnimeMangaRaw>(
          "top/anime",
          { ...p, type: csv(p.type), rating: csv(p.rating), ...sfwStrictQuery(p.sfw_strict) },
          (a) => summarizeAnime(a),
        ),
      () =>
        this.#fallback!.topAnimeOfficial({
          type: csv(p.type),
          filter: p.filter,
          limit: p.limit,
          page: p.page,
          sfw: p.sfw || p.sfw_strict,
        }),
    );
  }

  async getTopManga(p: TopParams): Promise<Record<string, unknown>> {
    return withFallback(
      this.#logger,
      this.#fallback,
      "top manga",
      () =>
        this.#list<AnimeMangaRaw>(
          "top/manga",
          { ...p, type: csv(p.type), rating: csv(p.rating), ...sfwStrictQuery(p.sfw_strict) },
          (m) => summarizeManga(m),
        ),
      () =>
        this.#fallback!.topMangaOfficial({
          type: csv(p.type),
          filter: p.filter,
          limit: p.limit,
          page: p.page,
          sfw: p.sfw || p.sfw_strict,
        }),
    );
  }

  async getSeason(p: SeasonParams): Promise<Record<string, unknown>> {
    const path = p.year && p.season ? `seasons/${p.year}/${p.season}` : "seasons/now";
    return withFallback(
      this.#logger,
      this.#fallback,
      "seasonal anime",
      () => this.#list<AnimeMangaRaw>(path, seasonQuery(p), (a) => summarizeAnime(a)),
      () => {
        // The official API has no "current season" shortcut — an explicit year+season
        // is required either way, so use the caller's if given, else compute it.
        const { year, season } =
          p.year && p.season ? { year: p.year, season: p.season } : currentSeason(new Date());
        return this.#fallback!.seasonOfficial(year, season, {
          limit: p.limit,
          page: p.page,
          sfw: p.sfw || p.sfw_strict,
        });
      },
    );
  }

  async getUpcomingSeason(p: SeasonParams): Promise<Record<string, unknown>> {
    return withFallback(
      this.#logger,
      this.#fallback,
      "upcoming season",
      () => this.#list<AnimeMangaRaw>("seasons/upcoming", seasonQuery(p), (a) => summarizeAnime(a)),
      () => {
        const { year, season } = nextSeason(new Date());
        return this.#fallback!.seasonOfficial(year, season, {
          limit: p.limit,
          page: p.page,
          sfw: p.sfw || p.sfw_strict,
        });
      },
    );
  }

  async getSchedule(p: ScheduleParams): Promise<Record<string, unknown>> {
    return this.#list<AnimeMangaRaw>(
      "schedules",
      {
        filter: p.day,
        limit: p.limit,
        sfw: p.sfw,
        kids: p.kids,
        unapproved: p.unapproved,
        page: p.page,
        ...sfwStrictQuery(p.sfw_strict),
      },
      (a) => summarizeAnime(a),
    );
  }

  // ---- characters & people (Tier 1) ----------------------------------------

  async searchCharacters(p: SearchParams): Promise<Record<string, unknown>> {
    return this.#list<RawCharacterEntity>("characters", { ...p }, (c) => summarizeCharacter(c));
  }

  async getCharacter(id: number): Promise<Record<string, unknown>> {
    return this.#cached<RawCharacterEntity>(`character:${id}`, `characters/${id}/full`, (c) =>
      summarizeCharacter(c, true),
    );
  }

  async searchPeople(p: SearchParams): Promise<Record<string, unknown>> {
    return this.#list<RawPersonEntity>("people", { ...p }, (person) => summarizePerson(person));
  }

  async getPerson(id: number): Promise<Record<string, unknown>> {
    return this.#cached<RawPersonEntity>(`person:${id}`, `people/${id}/full`, (person) =>
      summarizePerson(person, true),
    );
  }

  async getAnimeStaff(id: number): Promise<Record<string, unknown>> {
    return this.#cached<RawStaff[]>(`anime-staff:${id}`, `anime/${id}/staff`, summarizeStaff);
  }

  // ---- discovery & statistics (Tier 2) -------------------------------------

  // Random endpoints are never cached — the whole point is a fresh pick.
  async getRandomAnime(sfw?: boolean, sfwStrict?: boolean): Promise<Record<string, unknown>> {
    const res = await this.#http.getJson<ItemResponse<AnimeMangaRaw>>("random/anime", {
      query: { sfw, ...sfwStrictQuery(sfwStrict) },
    });
    return summarizeAnime(res.data, true);
  }

  async getRandomManga(sfw?: boolean, sfwStrict?: boolean): Promise<Record<string, unknown>> {
    const res = await this.#http.getJson<ItemResponse<AnimeMangaRaw>>("random/manga", {
      query: { sfw, ...sfwStrictQuery(sfwStrict) },
    });
    return summarizeManga(res.data, true);
  }

  async getAnimeStatistics(id: number): Promise<Record<string, unknown>> {
    return this.#cache.wrapStaleOnError(`anime-stats:${id}`, () =>
      withFallback(
        this.#logger,
        this.#fallback,
        "anime statistics",
        async () => {
          const res = await this.#http.getJson<ItemResponse<RawStatistics>>(
            `anime/${id}/statistics`,
          );
          return summarizeStatistics(res.data);
        },
        () => this.#fallback!.animeStatisticsOfficial(id),
      ),
    );
  }

  // No official-API equivalent for manga statistics (see officialReads.ts) — always Tenrai-only.
  async getMangaStatistics(id: number): Promise<Record<string, unknown>> {
    return this.#cached<RawStatistics>(
      `manga-stats:${id}`,
      `manga/${id}/statistics`,
      summarizeStatistics,
    );
  }

  // ---- broader surface (Tier 3) --------------------------------------------

  async getProducers(p: SearchParams): Promise<Record<string, unknown>> {
    return this.#list<RawProducer>("producers", { ...p }, summarizeProducer);
  }

  async getTopPeople(p: { limit?: number; page?: number }): Promise<Record<string, unknown>> {
    return this.#list<RawPersonEntity>("top/people", { ...p }, (person) => summarizePerson(person));
  }

  async getTopCharacters(p: { limit?: number; page?: number }): Promise<Record<string, unknown>> {
    return this.#list<RawCharacterEntity>("top/characters", { ...p }, (c) => summarizeCharacter(c));
  }

  // ---- curated extras ------------------------------------------------------

  // Lists which years/seasons exist; helps drive get_seasonal_anime. Very static.
  async getSeasonsList(): Promise<Record<string, unknown>> {
    return this.#cached<RawSeasonEntry[]>("seasons-list", "seasons", summarizeSeasonsList);
  }

  async getRandomCharacter(): Promise<Record<string, unknown>> {
    const res = await this.#http.getJson<ItemResponse<RawCharacterEntity>>("random/characters");
    return summarizeCharacter(res.data, true);
  }

  async getRandomPerson(): Promise<Record<string, unknown>> {
    const res = await this.#http.getJson<ItemResponse<RawPersonEntity>>("random/people");
    return summarizePerson(res.data, true);
  }

  async getAnimeNews(id: number, page?: number): Promise<Record<string, unknown>> {
    return this.#list<RawNewsItem>(`anime/${id}/news`, { page }, summarizeNewsItem);
  }
}
