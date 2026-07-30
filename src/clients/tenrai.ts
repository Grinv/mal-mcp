// Read-only client for the Tenrai API (a free, unofficial MyAnimeList mirror that follows the
// Jikan v4 schema — no credentials needed). Wraps HttpClient with a polite rate limiter and a
// TTL cache. It only fetches and caches; all raw→agent-facing shaping lives in ../lib/format.js.
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

export interface SearchParams {
  q?: string;
  type?: string;
  status?: string;
  genres?: string;
  order_by?: string;
  sort?: string;
  sfw?: boolean;
  limit?: number;
  page?: number;
}

export interface TopParams {
  type?: string;
  filter?: string;
  limit?: number;
  page?: number;
}

export interface SeasonParams {
  year?: number;
  season?: string;
  limit?: number;
  page?: number;
  sfw?: boolean;
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

  async searchAnime(p: SearchParams): Promise<Record<string, unknown>> {
    return withFallback(
      this.#logger,
      this.#fallback,
      "anime search",
      () => this.#list<AnimeMangaRaw>("anime", { ...p }, (a) => summarizeAnime(a)),
      () =>
        this.#fallback!.searchAnimeOfficial({
          q: p.q ?? "",
          limit: p.limit,
          page: p.page,
          sfw: p.sfw,
        }),
    );
  }

  async searchManga(p: SearchParams): Promise<Record<string, unknown>> {
    return withFallback(
      this.#logger,
      this.#fallback,
      "manga search",
      () => this.#list<AnimeMangaRaw>("manga", { ...p }, (m) => summarizeManga(m)),
      () =>
        this.#fallback!.searchMangaOfficial({
          q: p.q ?? "",
          limit: p.limit,
          page: p.page,
          sfw: p.sfw,
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

  async getAnimeReviews(id: number, limit: number): Promise<Record<string, unknown>> {
    return this.#reviews("anime", id, limit);
  }

  async getMangaReviews(id: number, limit: number): Promise<Record<string, unknown>> {
    return this.#reviews("manga", id, limit);
  }

  // Reviews are not cached: they are paginated and change as users post.
  // Tenrai's `/{kind}/{id}/reviews` has no `limit` param at all (confirmed against its
  // OpenAPI spec and live: `?limit=1` and `?limit=2` both still return a full 20-review
  // page) — `limit` is applied here, client-side, to actually honor the tool's own
  // documented default/cap instead of silently ignoring it.
  async #reviews(
    kind: "anime" | "manga",
    id: number,
    limit: number,
  ): Promise<Record<string, unknown>> {
    const res = await this.#http.getJson<ListResponse<RawReview>>(`${kind}/${id}/reviews`);
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
      () => this.#list<AnimeMangaRaw>("top/anime", { ...p }, (a) => summarizeAnime(a)),
      () =>
        this.#fallback!.topAnimeOfficial({
          type: p.type,
          filter: p.filter,
          limit: p.limit,
          page: p.page,
        }),
    );
  }

  async getTopManga(p: TopParams): Promise<Record<string, unknown>> {
    return withFallback(
      this.#logger,
      this.#fallback,
      "top manga",
      () => this.#list<AnimeMangaRaw>("top/manga", { ...p }, (m) => summarizeManga(m)),
      () =>
        this.#fallback!.topMangaOfficial({
          type: p.type,
          filter: p.filter,
          limit: p.limit,
          page: p.page,
        }),
    );
  }

  async getSeason(p: SeasonParams): Promise<Record<string, unknown>> {
    const path = p.year && p.season ? `seasons/${p.year}/${p.season}` : "seasons/now";
    return withFallback(
      this.#logger,
      this.#fallback,
      "seasonal anime",
      () =>
        this.#list<AnimeMangaRaw>(path, { limit: p.limit, page: p.page, sfw: p.sfw }, (a) =>
          summarizeAnime(a),
        ),
      () => {
        // The official API has no "current season" shortcut — an explicit year+season
        // is required either way, so use the caller's if given, else compute it.
        const { year, season } =
          p.year && p.season ? { year: p.year, season: p.season } : currentSeason(new Date());
        return this.#fallback!.seasonOfficial(year, season, {
          limit: p.limit,
          page: p.page,
          sfw: p.sfw,
        });
      },
    );
  }

  async getUpcomingSeason(p: SeasonParams): Promise<Record<string, unknown>> {
    return withFallback(
      this.#logger,
      this.#fallback,
      "upcoming season",
      () =>
        this.#list<AnimeMangaRaw>(
          "seasons/upcoming",
          { limit: p.limit, page: p.page, sfw: p.sfw },
          (a) => summarizeAnime(a),
        ),
      () => {
        const { year, season } = nextSeason(new Date());
        return this.#fallback!.seasonOfficial(year, season, {
          limit: p.limit,
          page: p.page,
          sfw: p.sfw,
        });
      },
    );
  }

  async getSchedule(day: string | undefined, limit: number): Promise<Record<string, unknown>> {
    return this.#list<AnimeMangaRaw>("schedules", { filter: day, limit }, (a) => summarizeAnime(a));
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
  async getRandomAnime(): Promise<Record<string, unknown>> {
    const res = await this.#http.getJson<ItemResponse<AnimeMangaRaw>>("random/anime");
    return summarizeAnime(res.data, true);
  }

  async getRandomManga(): Promise<Record<string, unknown>> {
    const res = await this.#http.getJson<ItemResponse<AnimeMangaRaw>>("random/manga");
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

  async getTopPeople(p: TopParams): Promise<Record<string, unknown>> {
    return this.#list<RawPersonEntity>("top/people", { ...p }, (person) => summarizePerson(person));
  }

  async getTopCharacters(p: TopParams): Promise<Record<string, unknown>> {
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
