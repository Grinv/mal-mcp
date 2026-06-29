// Read-only client for the unofficial Jikan API (v4) — no credentials needed.
// Wraps HttpClient with a polite rate limiter and a TTL cache. It only fetches
// and caches; all raw→agent-facing shaping lives in ../lib/format.js.
import { HttpClient } from "../lib/http.js";
import { RateLimiter, type RateRule } from "../lib/rateLimit.js";
import { TtlCache } from "../lib/cache.js";
import {
  pageInfo,
  summarizeAnime,
  summarizeManga,
  summarizeCharacters,
  summarizeRecommendations,
  summarizeReviews,
  summarizeEpisodes,
  summarizeGenres,
  summarizeUser,
  summarizeFavorites,
  summarizeCharacter,
  summarizePerson,
  summarizeStaff,
  summarizeStatistics,
  summarizeProducer,
  summarizeSeasonsList,
  summarizeNewsItem,
  type JikanMedia,
  type JikanPagination,
  type RawCharacter,
  type RawRecommendation,
  type RawReview,
  type RawEpisode,
  type RawGenre,
  type RawUser,
  type RawFavorites,
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
  pagination?: JikanPagination;
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

// Jikan's published limits (docs.api.jikan.moe "Rate Limiting"): 3 req/s AND
// 60 req/min. A min-interval alone covers the per-second cap but not the
// sustained per-minute one, so both windows are enforced.
const JIKAN_RATE_RULES: RateRule[] = [
  { limit: 3, windowMs: 1000 },
  { limit: 60, windowMs: 60_000 },
];

export class JikanClient {
  readonly #http: HttpClient;
  readonly #cache: TtlCache<Record<string, unknown>>;

  constructor(config: Config, logger: Logger) {
    // A zero interval disables client-side throttling entirely (used in tests);
    // otherwise enforce both the min interval and Jikan's documented windows.
    const limiter = new RateLimiter(
      config.jikanMinIntervalMs,
      config.jikanMinIntervalMs === 0 ? [] : JIKAN_RATE_RULES,
    );
    this.#http = new HttpClient({
      baseUrl: config.jikanBaseUrl,
      logger,
      timeoutMs: config.httpTimeoutMs,
      retries: config.httpRetries,
      beforeRequest: () => limiter.acquire(),
    });
    this.#cache = new TtlCache(config.cacheTtlMs);
  }

  /** Fetch a paginated list and map each item through `summarize`. */
  async #list<T>(
    path: string,
    query: Query,
    summarize: (item: T) => Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const res = await this.#http.getJson<ListResponse<T>>(path, { query });
    return { results: res.data.map(summarize), page: pageInfo(res.pagination) };
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
    return this.#list<JikanMedia>("anime", { ...p }, (a) => summarizeAnime(a));
  }

  async searchManga(p: SearchParams): Promise<Record<string, unknown>> {
    return this.#list<JikanMedia>("manga", { ...p }, (m) => summarizeManga(m));
  }

  async getAnime(id: number): Promise<Record<string, unknown>> {
    return this.#cached<JikanMedia>(`anime:${id}`, `anime/${id}/full`, (d) =>
      summarizeAnime(d, true),
    );
  }

  async getManga(id: number): Promise<Record<string, unknown>> {
    return this.#cached<JikanMedia>(`manga:${id}`, `manga/${id}/full`, (d) =>
      summarizeManga(d, true),
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
    return this.#cached<RawRecommendation[]>(
      `${kind}-recs:${id}`,
      `${kind}/${id}/recommendations`,
      summarizeRecommendations,
    );
  }

  async getAnimeReviews(id: number, limit: number): Promise<Record<string, unknown>> {
    return this.#reviews("anime", id, limit);
  }

  async getMangaReviews(id: number, limit: number): Promise<Record<string, unknown>> {
    return this.#reviews("manga", id, limit);
  }

  // Reviews are not cached: they are paginated and change as users post.
  async #reviews(
    kind: "anime" | "manga",
    id: number,
    limit: number,
  ): Promise<Record<string, unknown>> {
    const res = await this.#http.getJson<ListResponse<RawReview>>(`${kind}/${id}/reviews`, {
      query: { limit },
    });
    return summarizeReviews(res.data);
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
    return this.#list<JikanMedia>("top/anime", { ...p }, (a) => summarizeAnime(a));
  }

  async getTopManga(p: TopParams): Promise<Record<string, unknown>> {
    return this.#list<JikanMedia>("top/manga", { ...p }, (m) => summarizeManga(m));
  }

  async getSeason(p: SeasonParams): Promise<Record<string, unknown>> {
    const path = p.year && p.season ? `seasons/${p.year}/${p.season}` : "seasons/now";
    return this.#list<JikanMedia>(path, { limit: p.limit, page: p.page, sfw: p.sfw }, (a) =>
      summarizeAnime(a),
    );
  }

  async getUpcomingSeason(p: SeasonParams): Promise<Record<string, unknown>> {
    return this.#list<JikanMedia>(
      "seasons/upcoming",
      { limit: p.limit, page: p.page, sfw: p.sfw },
      (a) => summarizeAnime(a),
    );
  }

  async getSchedule(day: string | undefined, limit: number): Promise<Record<string, unknown>> {
    return this.#list<JikanMedia>("schedules", { filter: day, limit }, (a) => summarizeAnime(a));
  }

  async getUserProfile(username: string): Promise<Record<string, unknown>> {
    return this.#cached<RawUser>(
      `user:${username}`,
      `users/${encodeURIComponent(username)}/full`,
      summarizeUser,
    );
  }

  async getUserFavorites(username: string): Promise<Record<string, unknown>> {
    return this.#cached<RawFavorites>(
      `user-fav:${username}`,
      `users/${encodeURIComponent(username)}/favorites`,
      summarizeFavorites,
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
  async getRandomAnime(): Promise<Record<string, unknown>> {
    const res = await this.#http.getJson<ItemResponse<JikanMedia>>("random/anime");
    return summarizeAnime(res.data, true);
  }

  async getRandomManga(): Promise<Record<string, unknown>> {
    const res = await this.#http.getJson<ItemResponse<JikanMedia>>("random/manga");
    return summarizeManga(res.data, true);
  }

  async getAnimeStatistics(id: number): Promise<Record<string, unknown>> {
    return this.#cached<RawStatistics>(`anime-stats:${id}`, `anime/${id}/statistics`, (s) =>
      summarizeStatistics(s),
    );
  }

  async getMangaStatistics(id: number): Promise<Record<string, unknown>> {
    return this.#cached<RawStatistics>(`manga-stats:${id}`, `manga/${id}/statistics`, (s) =>
      summarizeStatistics(s),
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
