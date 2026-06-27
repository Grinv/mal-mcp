// Read-only client for the unofficial Jikan API (v4) — no credentials needed.
// Wraps HttpClient with a polite rate limiter and a TTL cache, and trims the
// large upstream payloads down to agent-friendly summaries.
import { HttpClient } from "../lib/http.js";
import { RateLimiter } from "../lib/rateLimit.js";
import { TtlCache } from "../lib/cache.js";
import {
  pageInfo,
  summarizeAnime,
  summarizeManga,
  type JikanMedia,
  type JikanPagination,
} from "../lib/format.js";
import type { Logger } from "../lib/logger.js";
import type { Config } from "../config.js";

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

export class JikanClient {
  readonly #http: HttpClient;
  readonly #cache: TtlCache<Record<string, unknown>>;

  constructor(config: Config, logger: Logger) {
    const limiter = new RateLimiter(config.jikanMinIntervalMs);
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
  async #list(
    path: string,
    query: Record<string, string | number | boolean | undefined>,
    summarize: (m: JikanMedia) => Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const res = await this.#http.getJson<ListResponse<JikanMedia>>(path, { query });
    return { results: res.data.map(summarize), page: pageInfo(res.pagination) };
  }

  async searchAnime(p: SearchParams): Promise<Record<string, unknown>> {
    return this.#list("anime", { ...p }, (a) => summarizeAnime(a));
  }

  async searchManga(p: SearchParams): Promise<Record<string, unknown>> {
    return this.#list("manga", { ...p }, (m) => summarizeManga(m));
  }

  async getAnime(id: number): Promise<Record<string, unknown>> {
    return this.#cache.wrapStaleOnError(`anime:${id}`, async () => {
      const res = await this.#http.getJson<ItemResponse<JikanMedia>>(`anime/${id}/full`);
      return summarizeAnime(res.data, true);
    });
  }

  async getManga(id: number): Promise<Record<string, unknown>> {
    return this.#cache.wrapStaleOnError(`manga:${id}`, async () => {
      const res = await this.#http.getJson<ItemResponse<JikanMedia>>(`manga/${id}/full`);
      return summarizeManga(res.data, true);
    });
  }

  async getAnimeCharacters(id: number): Promise<Record<string, unknown>> {
    return this.#cache.wrapStaleOnError(`anime-characters:${id}`, async () => {
      const res = await this.#http.getJson<ListResponse<RawCharacter>>(`anime/${id}/characters`);
      return {
        characters: res.data.map((c) => ({
          mal_id: c.character?.mal_id,
          name: c.character?.name,
          role: c.role,
          url: c.character?.url,
          voice_actors: (c.voice_actors ?? [])
            .filter((v) => v.language === "Japanese")
            .map((v) => v.person?.name)
            .filter((n): n is string => typeof n === "string"),
        })),
      };
    });
  }

  async getAnimeRecommendations(id: number): Promise<Record<string, unknown>> {
    return this.#cache.wrapStaleOnError(`anime-recs:${id}`, async () => {
      const res = await this.#http.getJson<ListResponse<RawRecommendation>>(
        `anime/${id}/recommendations`,
      );
      return {
        recommendations: res.data.slice(0, 25).map((r) => ({
          mal_id: r.entry?.mal_id,
          title: r.entry?.title,
          votes: r.votes,
          url: r.entry?.url,
        })),
      };
    });
  }

  async getAnimeReviews(id: number, limit: number): Promise<Record<string, unknown>> {
    const res = await this.#http.getJson<ListResponse<RawReview>>(`anime/${id}/reviews`, {
      query: { limit },
    });
    return {
      reviews: res.data.map((r) => ({
        user: r.user?.username,
        score: r.score,
        tags: r.tags ?? [],
        date: r.date,
        review: typeof r.review === "string" ? r.review.slice(0, 1200) : undefined,
        url: r.url,
      })),
    };
  }

  async getTopAnime(p: TopParams): Promise<Record<string, unknown>> {
    return this.#list("top/anime", { ...p }, (a) => summarizeAnime(a));
  }

  async getTopManga(p: TopParams): Promise<Record<string, unknown>> {
    return this.#list("top/manga", { ...p }, (m) => summarizeManga(m));
  }

  async getSeason(p: SeasonParams): Promise<Record<string, unknown>> {
    const path = p.year && p.season ? `seasons/${p.year}/${p.season}` : "seasons/now";
    return this.#list(path, { limit: p.limit, page: p.page, sfw: p.sfw }, (a) => summarizeAnime(a));
  }

  async getSchedule(day: string | undefined, limit: number): Promise<Record<string, unknown>> {
    return this.#list("schedules", { filter: day, limit }, (a) => summarizeAnime(a));
  }

  async getUserProfile(username: string): Promise<Record<string, unknown>> {
    return this.#cache.wrapStaleOnError(`user:${username}`, async () => {
      const res = await this.#http.getJson<ItemResponse<RawUser>>(
        `users/${encodeURIComponent(username)}/full`,
      );
      const u = res.data;
      return {
        username: u.username,
        url: u.url,
        joined: u.joined,
        location: u.location ?? undefined,
        gender: u.gender ?? undefined,
        last_online: u.last_online ?? undefined,
        about: typeof u.about === "string" ? u.about.slice(0, 600) : undefined,
        statistics: u.statistics,
      };
    });
  }

  async getUserFavorites(username: string): Promise<Record<string, unknown>> {
    return this.#cache.wrapStaleOnError(`user-fav:${username}`, async () => {
      const res = await this.#http.getJson<ItemResponse<RawFavorites>>(
        `users/${encodeURIComponent(username)}/favorites`,
      );
      const f = res.data;
      const titles = (items: RawFavEntry[] | undefined): Record<string, unknown>[] =>
        (items ?? []).map((i) => ({ mal_id: i.mal_id, title: i.title ?? i.name, url: i.url }));
      return {
        anime: titles(f.anime),
        manga: titles(f.manga),
        characters: titles(f.characters),
        people: titles(f.people),
      };
    });
  }
}

// Minimal shapes for the nested fields we read.
interface RawCharacter {
  character?: { mal_id?: number; name?: string; url?: string };
  role?: string;
  voice_actors?: { language?: string; person?: { name?: string } }[];
}
interface RawRecommendation {
  entry?: { mal_id?: number; title?: string; url?: string };
  votes?: number;
}
interface RawReview {
  user?: { username?: string };
  score?: number;
  tags?: string[];
  date?: string;
  review?: string;
  url?: string;
}
interface RawUser {
  username?: string;
  url?: string;
  joined?: string;
  location?: string | null;
  gender?: string | null;
  last_online?: string | null;
  about?: string | null;
  statistics?: unknown;
}
interface RawFavEntry {
  mal_id?: number;
  title?: string;
  name?: string;
  url?: string;
}
interface RawFavorites {
  anime?: RawFavEntry[];
  manga?: RawFavEntry[];
  characters?: RawFavEntry[];
  people?: RawFavEntry[];
}
