// Read-only client for the Tenrai API (a free, unofficial MyAnimeList mirror — no credentials
// needed). Wraps HttpClient with a polite rate limiter and a TTL cache. It only fetches and
// caches; all raw→agent-facing shaping lives in ../lib/format.js.
import { ApiError } from "../lib/errors.js";
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
  summarizeRecentRecommendations,
  summarizeReviews,
  summarizeEpisodes,
  summarizeGenres,
  summarizeCharacter,
  summarizePerson,
  summarizeStaff,
  summarizeStatistics,
  summarizeProducer,
  summarizeMagazine,
  summarizeAnimeVideos,
  summarizeSeasonsList,
  summarizeNewsItem,
  summarizeStacks,
  summarizeStack,
  type RawAnime,
  type RawManga,
  type RawPagination,
  type RawCharacter,
  type RawRecommendation,
  type RawRecentRecommendation,
  type RawReview,
  type RawEpisode,
  type RawGenre,
  type RawCharacterEntity,
  type RawPersonEntity,
  type RawStaff,
  type RawStatistics,
  type RawProducer,
  type RawMagazine,
  type RawAnimeVideos,
  type RawSeasonEntry,
  type RawNewsItem,
  type RawStack,
} from "../lib/format.js";
import type { Logger } from "../lib/logger.js";
import type { Config } from "../config.js";
import type { GenreFilter } from "./tenraiEnums.js";
import type {
  CharacterSearchParams,
  PersonSearchParams,
  ProducerSearchParams,
  MagazineSearchParams,
  AnimeSearchParams,
  MangaSearchParams,
  AnimeTopParams,
  MangaTopParams,
  SeasonParams,
  ScheduleParams,
  ReviewParams,
  StackParams,
  StackSearchParams,
} from "./tenraiParams.js";

type Query = Record<string, string | number | boolean | undefined>;

interface ListResponse<T> {
  data: T[];
  pagination?: RawPagination;
}
interface ItemResponse<T> {
  data: T;
}

/** A 200 that carries no `data` at all. Modelled as `server_error` rather than left to become a
 *  TypeError deep inside a shaper: only an ApiError with an upstream-failure code reaches
 *  `guard()` as a readable message and lets `withFallback` try the official API. */
function missingDataError(path: string): ApiError {
  return new ApiError({
    code: "server_error",
    message: `Upstream returned a response with no data for ${path}`,
    retryable: true,
  });
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
    // A 200 whose body has no `data` array (an error envelope, a JSON maintenance page) would
    // otherwise throw a raw TypeError: the agent sees "res.data is not iterable", and
    // isUpstreamFailure() doesn't recognise it, so the official-API fallback never engages.
    // Classify it as what it is — the upstream misbehaving — so the fallback gets its chance.
    if (!Array.isArray(res.data)) throw missingDataError(path);
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

  /** Cache-key suffix for a query affected by sfw/sfw_strict — the response genuinely differs
   *  between values (see e.g. `#details`'s own comment), so a cached entry can't be shared across
   *  different sfw/sfwStrict combinations. */
  #sfwCacheKey(prefix: string, sfw: boolean | undefined, sfwStrict: boolean | undefined): string {
    return `${prefix}:${Boolean(sfw)}:${Boolean(sfwStrict)}`;
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
      // Same reasoning as #list's guard: a `data`-less 200 must surface as an upstream failure,
      // not as whatever TypeError the shaper happens to throw on undefined.
      if (res.data === undefined || res.data === null) throw missingDataError(path);
      return shape(res.data);
    });
  }

  /** Cache by `key`, but only when the value came from Tenrai itself. The official-API fallback
   *  is deliberately thinner (see formatOfficial.ts's *_FALLBACK_GAPS), so caching its response
   *  would pin the degraded payload under this key for the whole TTL — one transient 5xx would
   *  keep serving a stripped-down entry for minutes after Tenrai recovered, with nothing in the
   *  response saying so. The fallback value is still returned to this caller; it just isn't kept.
   *  Only the cached read paths need this: the uncached ones (search/top/season) can't poison
   *  anything. */
  #cachedWithFallback(
    key: string,
    label: string,
    primary: () => Promise<Record<string, unknown>>,
    fallbackCall: () => Promise<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    let servedByFallback = false;
    return this.#cache.wrapStaleOnError(
      key,
      () =>
        withFallback(this.#logger, this.#fallback, label, primary, fallbackCall, () => {
          servedByFallback = true;
        }),
      () => !servedByFallback,
    );
  }

  async searchAnime(p: AnimeSearchParams): Promise<Record<string, unknown>> {
    return withFallback(
      this.#logger,
      this.#fallback,
      "anime search",
      () =>
        this.#list<RawAnime>(
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

  async searchManga(p: MangaSearchParams): Promise<Record<string, unknown>> {
    return withFallback(
      this.#logger,
      this.#fallback,
      "manga search",
      () =>
        this.#list<RawManga>(
          "manga",
          { ...p, type: csv(p.type), ...sfwStrictQuery(p.sfw_strict) },
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

  async getAnime(id: number, sfw?: boolean, sfwStrict?: boolean): Promise<Record<string, unknown>> {
    return this.#details("anime", id, sfw, sfwStrict);
  }

  async getManga(id: number, sfw?: boolean, sfwStrict?: boolean): Promise<Record<string, unknown>> {
    return this.#details("manga", id, sfw, sfwStrict);
  }

  // sfw/sfw_strict don't filter the requested anime/manga itself (its own id was asked for
  // explicitly) — they filter NSFW entries out of its nested `relations` list. No effect during
  // an official-API fallback: animeDetailsOfficial/mangaDetailsOfficial take no sfw param.
  #details(
    kind: "anime" | "manga",
    id: number,
    sfw?: boolean,
    sfwStrict?: boolean,
  ): Promise<Record<string, unknown>> {
    return this.#cachedWithFallback(
      this.#sfwCacheKey(`${kind}:${id}`, sfw, sfwStrict),
      `${kind} details`,
      async () => {
        const res = await this.#http.getJson<ItemResponse<RawAnime | RawManga>>(
          `${kind}/${id}/full`,
          { query: { sfw, ...sfwStrictQuery(sfwStrict) } },
        );
        return kind === "anime"
          ? summarizeAnime(res.data as RawAnime, true)
          : summarizeManga(res.data as RawManga, true);
      },
      () =>
        kind === "anime"
          ? this.#fallback!.animeDetailsOfficial(id)
          : this.#fallback!.mangaDetailsOfficial(id),
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

  async getAnimeRecommendations(
    id: number,
    sfw?: boolean,
    sfwStrict?: boolean,
  ): Promise<Record<string, unknown>> {
    return this.#recommendations("anime", id, sfw, sfwStrict);
  }

  async getMangaRecommendations(
    id: number,
    sfw?: boolean,
    sfwStrict?: boolean,
  ): Promise<Record<string, unknown>> {
    return this.#recommendations("manga", id, sfw, sfwStrict);
  }

  // sfw/sfw_strict filter NSFW entries out of the recommendation list itself. No effect during
  // an official-API fallback: animeRecommendationsOfficial/mangaRecommendationsOfficial take no
  // sfw param.
  #recommendations(
    kind: "anime" | "manga",
    id: number,
    sfw?: boolean,
    sfwStrict?: boolean,
  ): Promise<Record<string, unknown>> {
    return this.#cachedWithFallback(
      this.#sfwCacheKey(`${kind}-recs:${id}`, sfw, sfwStrict),
      `${kind} recommendations`,
      async () => {
        const res = await this.#http.getJson<ItemResponse<RawRecommendation[]>>(
          `${kind}/${id}/recommendations`,
          { query: { sfw, ...sfwStrictQuery(sfwStrict) } },
        );
        return summarizeRecommendations(res.data);
      },
      () =>
        kind === "anime"
          ? this.#fallback!.animeRecommendationsOfficial(id)
          : this.#fallback!.mangaRecommendationsOfficial(id),
    );
  }

  // Site-wide feed, not tied to one title — not cached (paginated/frequently-changing, same
  // category as reviews/episodes/random picks).
  async getRecentAnimeRecommendations(p: {
    page?: number;
    limit?: number;
    sfw?: boolean;
    sfw_strict?: boolean;
  }): Promise<Record<string, unknown>> {
    const res = await this.#http.getJson<ListResponse<RawRecentRecommendation>>(
      "recommendations/anime",
      { query: { page: p.page, limit: p.limit, sfw: p.sfw, ...sfwStrictQuery(p.sfw_strict) } },
    );
    return summarizeRecentRecommendations(res.data, res.pagination);
  }

  async getRecentMangaRecommendations(p: {
    page?: number;
    limit?: number;
    sfw?: boolean;
    sfw_strict?: boolean;
  }): Promise<Record<string, unknown>> {
    const res = await this.#http.getJson<ListResponse<RawRecentRecommendation>>(
      "recommendations/manga",
      { query: { page: p.page, limit: p.limit, sfw: p.sfw, ...sfwStrictQuery(p.sfw_strict) } },
    );
    return summarizeRecentRecommendations(res.data, res.pagination);
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
    // Slice AFTER shaping, not before: summarizeReviews drops any malformed entry, so slicing the
    // raw array first could under-fill `limit` even when enough valid reviews exist further in.
    const { reviews } = summarizeReviews(res.data);
    return { reviews: reviews.slice(0, limit) };
  }

  // Not cached: the response is paginated, and the cache key here would not
  // include `page`, so caching would return the wrong page on later calls.
  async getAnimeEpisodes(id: number, page?: number): Promise<Record<string, unknown>> {
    const res = await this.#http.getJson<ListResponse<RawEpisode>>(`anime/${id}/episodes`, {
      query: { page },
    });
    return summarizeEpisodes(res.data, res.pagination);
  }

  async getAnimeVideos(id: number): Promise<Record<string, unknown>> {
    return this.#cached<RawAnimeVideos>(`anime-videos:${id}`, `anime/${id}/videos`, (v) =>
      summarizeAnimeVideos(v),
    );
  }

  async getAnimeGenres(filter?: GenreFilter): Promise<Record<string, unknown>> {
    return this.#genres("anime", filter);
  }

  async getMangaGenres(filter?: GenreFilter): Promise<Record<string, unknown>> {
    return this.#genres("manga", filter);
  }

  // Genre IDs feed the `genres` param of search_*; they rarely change, so cache.
  #genres(kind: "anime" | "manga", filter?: GenreFilter): Promise<Record<string, unknown>> {
    return this.#cached<RawGenre[]>(
      `genres:${kind}:${filter ?? "all"}`,
      `genres/${kind}`,
      summarizeGenres,
      { filter },
    );
  }

  async getTopAnime(p: AnimeTopParams): Promise<Record<string, unknown>> {
    return withFallback(
      this.#logger,
      this.#fallback,
      "top anime",
      () =>
        this.#list<RawAnime>(
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

  async getTopManga(p: MangaTopParams): Promise<Record<string, unknown>> {
    return withFallback(
      this.#logger,
      this.#fallback,
      "top manga",
      () =>
        this.#list<RawManga>(
          "top/manga",
          { ...p, type: csv(p.type), ...sfwStrictQuery(p.sfw_strict) },
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
      () => this.#list<RawAnime>(path, seasonQuery(p), (a) => summarizeAnime(a)),
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
      () => this.#list<RawAnime>("seasons/upcoming", seasonQuery(p), (a) => summarizeAnime(a)),
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
    return this.#list<RawAnime>(
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

  async searchCharacters(p: CharacterSearchParams): Promise<Record<string, unknown>> {
    return this.#list<RawCharacterEntity>("characters", { ...p }, (c) => summarizeCharacter(c));
  }

  async getCharacter(
    id: number,
    sfw?: boolean,
    sfwStrict?: boolean,
  ): Promise<Record<string, unknown>> {
    return this.#cached<RawCharacterEntity>(
      this.#sfwCacheKey(`character:${id}`, sfw, sfwStrict),
      `characters/${id}/full`,
      (c) => summarizeCharacter(c, true),
      { sfw, ...sfwStrictQuery(sfwStrict) },
    );
  }

  async searchPeople(p: PersonSearchParams): Promise<Record<string, unknown>> {
    return this.#list<RawPersonEntity>("people", { ...p }, (person) => summarizePerson(person));
  }

  async getPerson(
    id: number,
    sfw?: boolean,
    sfwStrict?: boolean,
  ): Promise<Record<string, unknown>> {
    return this.#cached<RawPersonEntity>(
      this.#sfwCacheKey(`person:${id}`, sfw, sfwStrict),
      `people/${id}/full`,
      (person) => summarizePerson(person, true),
      { sfw, ...sfwStrictQuery(sfwStrict) },
    );
  }

  async getAnimeStaff(id: number): Promise<Record<string, unknown>> {
    return this.#cached<RawStaff[]>(`anime-staff:${id}`, `anime/${id}/staff`, summarizeStaff);
  }

  // ---- discovery & statistics (Tier 2) -------------------------------------

  // Random endpoints are never cached — the whole point is a fresh pick.
  async getRandomAnime(sfw?: boolean, sfwStrict?: boolean): Promise<Record<string, unknown>> {
    const res = await this.#http.getJson<ItemResponse<RawAnime>>("random/anime", {
      query: { sfw, ...sfwStrictQuery(sfwStrict) },
    });
    return summarizeAnime(res.data, true);
  }

  async getRandomManga(sfw?: boolean, sfwStrict?: boolean): Promise<Record<string, unknown>> {
    const res = await this.#http.getJson<ItemResponse<RawManga>>("random/manga", {
      query: { sfw, ...sfwStrictQuery(sfwStrict) },
    });
    return summarizeManga(res.data, true);
  }

  async getAnimeStatistics(id: number): Promise<Record<string, unknown>> {
    return this.#cachedWithFallback(
      `anime-stats:${id}`,
      "anime statistics",
      async () => {
        const res = await this.#http.getJson<ItemResponse<RawStatistics>>(`anime/${id}/statistics`);
        return summarizeStatistics(res.data);
      },
      () => this.#fallback!.animeStatisticsOfficial(id),
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

  async getProducers(p: ProducerSearchParams): Promise<Record<string, unknown>> {
    return this.#list<RawProducer>("producers", { ...p }, summarizeProducer);
  }

  async getProducer(id: number): Promise<Record<string, unknown>> {
    return this.#cached<RawProducer>(`producer:${id}`, `producers/${id}/full`, (p) =>
      summarizeProducer(p, true),
    );
  }

  async getMagazines(p: MagazineSearchParams): Promise<Record<string, unknown>> {
    return this.#list<RawMagazine>("magazines", { ...p }, summarizeMagazine);
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

  async getAnimeNews(
    id: number,
    page?: number,
    sfw?: boolean,
    sfwStrict?: boolean,
  ): Promise<Record<string, unknown>> {
    return this.#news("anime", id, page, sfw, sfwStrict);
  }

  async getMangaNews(
    id: number,
    page?: number,
    sfw?: boolean,
    sfwStrict?: boolean,
  ): Promise<Record<string, unknown>> {
    return this.#news("manga", id, page, sfw, sfwStrict);
  }

  #news(
    kind: "anime" | "manga",
    id: number,
    page?: number,
    sfw?: boolean,
    sfwStrict?: boolean,
  ): Promise<Record<string, unknown>> {
    return this.#list<RawNewsItem>(
      `${kind}/${id}/news`,
      { page, sfw, ...sfwStrictQuery(sfwStrict) },
      summarizeNewsItem,
    );
  }

  // Site-wide news feed, not tied to one anime — not cached (paginated/frequently-changing).
  // Interest Stacks: user-curated anime/manga lists on MAL. Paginated and community-authored, so
  // not cached (same category as searches and news feeds). No official-API equivalent exists.
  async getStacks(p: StackSearchParams): Promise<Record<string, unknown>> {
    const res = await this.#http.getJson<ListResponse<RawStack>>("stacks", {
      query: { ...p, ...sfwStrictQuery(p.sfw_strict) },
    });
    if (!Array.isArray(res.data)) throw missingDataError("stacks");
    return summarizeStacks(res.data, res.pagination);
  }

  async getStack(id: number, sfw?: boolean, sfwStrict?: boolean): Promise<Record<string, unknown>> {
    return this.#cached<RawStack>(
      `stack:${this.#sfwCacheKey(String(id), sfw, sfwStrict)}`,
      `stacks/${id}`,
      summarizeStack,
      {
        sfw,
        ...sfwStrictQuery(sfwStrict),
      },
    );
  }

  async getAnimeStacks(id: number, p: StackParams): Promise<Record<string, unknown>> {
    return this.#entityStacks("anime", id, p);
  }

  async getMangaStacks(id: number, p: StackParams): Promise<Record<string, unknown>> {
    return this.#entityStacks("manga", id, p);
  }

  async #entityStacks(
    kind: "anime" | "manga",
    id: number,
    p: StackParams,
  ): Promise<Record<string, unknown>> {
    const res = await this.#http.getJson<ListResponse<RawStack>>(`${kind}/${id}/stacks`, {
      query: { ...p, ...sfwStrictQuery(p.sfw_strict) },
    });
    if (!Array.isArray(res.data)) throw missingDataError(`${kind}/${id}/stacks`);
    return summarizeStacks(res.data, res.pagination);
  }

  async getNews(p: {
    q?: string;
    tag?: string;
    limit?: number;
    page?: number;
  }): Promise<Record<string, unknown>> {
    return this.#list<RawNewsItem>("news", { ...p }, summarizeNewsItem);
  }
}
