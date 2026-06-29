// Client for the official MyAnimeList API (v2). Handles the personal-list
// operations that Jikan cannot do (they require a user token). Implements
// silent token refresh: on 401 (or when the cached access token is expired)
// it refreshes via grant_type=refresh_token and persists the rotated token.
import { HttpClient } from "../lib/http.js";
import { ApiError } from "../lib/errors.js";
import { TokenStore, type TokenState } from "../lib/tokenStore.js";
import type { Logger } from "../lib/logger.js";
import type { Config, MalAuth } from "../config.js";

const REFRESH_SKEW_MS = 60_000;

const ANIME_LIST_FIELDS =
  "list_status{status,score,num_episodes_watched,is_rewatching,updated_at,start_date,finish_date}";
const MANGA_LIST_FIELDS =
  "list_status{status,score,num_chapters_read,num_volumes_read,is_rereading,updated_at}";
const USER_FIELDS = "id,name,location,joined_at,anime_statistics";

type Resource = "anime" | "manga";

export interface AnimeListParams {
  status?: string;
  sort?: string;
  limit?: number;
  offset?: number;
}

export interface AnimeStatusUpdate {
  status?: string;
  score?: number;
  num_watched_episodes?: number;
  is_rewatching?: boolean;
  num_times_rewatched?: number;
  rewatch_value?: number;
  priority?: number;
  tags?: string;
  start_date?: string;
  finish_date?: string;
  comments?: string;
}

export interface MangaStatusUpdate {
  status?: string;
  score?: number;
  num_chapters_read?: number;
  num_volumes_read?: number;
  is_rereading?: boolean;
  num_times_reread?: number;
  reread_value?: number;
  priority?: number;
  tags?: string;
  comments?: string;
}

export class MalClient {
  readonly #http: HttpClient;
  readonly #oauth: HttpClient;
  readonly #auth: MalAuth;
  readonly #logger: Logger;
  readonly #store: TokenStore | undefined;
  #state: TokenState;
  // Single-flight: dedupe concurrent refreshes so parallel 401s don't each spend
  // the (rotating) refresh token and clobber each other.
  #refreshing: Promise<string> | undefined;

  constructor(config: Config, logger: Logger, store?: TokenStore) {
    this.#auth = config.auth;
    this.#logger = logger;
    this.#store = store;
    this.#http = new HttpClient({
      baseUrl: config.malBaseUrl,
      logger,
      timeoutMs: config.httpTimeoutMs,
      retries: config.httpRetries,
    });
    this.#oauth = new HttpClient({
      baseUrl: config.malOauthBaseUrl,
      logger,
      timeoutMs: config.httpTimeoutMs,
      retries: config.httpRetries,
    });

    const stored = store?.load();
    this.#state = stored ?? {
      accessToken: this.#auth.accessToken ?? "",
      refreshToken: this.#auth.refreshToken ?? "",
      // Unknown expiry for an env-provided token: trust it until a 401.
      expiresAt: this.#auth.accessToken ? Number.POSITIVE_INFINITY : 0,
    };
  }

  // ---- personal list operations -------------------------------------------
  // Anime and manga share the same MAL endpoints up to a `${resource}` segment,
  // so each public method delegates to one resource-parameterized private helper.

  async getMyUserInfo(): Promise<Record<string, unknown>> {
    return this.#authed((token) =>
      this.#http.getJson<Record<string, unknown>>("users/@me", {
        query: { fields: USER_FIELDS },
        headers: bearer(token),
      }),
    );
  }

  getMyAnimeList(p: AnimeListParams): Promise<Record<string, unknown>> {
    return this.#getMyList("anime", ANIME_LIST_FIELDS, p);
  }

  getMyMangaList(p: AnimeListParams): Promise<Record<string, unknown>> {
    return this.#getMyList("manga", MANGA_LIST_FIELDS, p);
  }

  async #getMyList(
    resource: Resource,
    fields: string,
    p: AnimeListParams,
  ): Promise<Record<string, unknown>> {
    const res = await this.#authed((token) =>
      this.#http.getJson<MalListResponse>(`users/@me/${resource}list`, {
        query: { fields, status: p.status, sort: p.sort, limit: p.limit, offset: p.offset },
        headers: bearer(token),
      }),
    );
    return trimList(res);
  }

  updateMyAnimeStatus(
    animeId: number,
    update: AnimeStatusUpdate,
  ): Promise<Record<string, unknown>> {
    return this.#updateStatus("anime", animeId, update);
  }

  updateMyMangaStatus(
    mangaId: number,
    update: MangaStatusUpdate,
  ): Promise<Record<string, unknown>> {
    return this.#updateStatus("manga", mangaId, update);
  }

  #updateStatus(
    resource: Resource,
    id: number,
    update: AnimeStatusUpdate | MangaStatusUpdate,
  ): Promise<Record<string, unknown>> {
    return this.#authed((token) =>
      this.#http.requestJson<Record<string, unknown>>(`${resource}/${id}/my_list_status`, {
        method: "PATCH",
        body: formBody(update),
        headers: { ...bearer(token), "Content-Type": "application/x-www-form-urlencoded" },
      }),
    );
  }

  deleteMyAnimeListItem(animeId: number): Promise<Record<string, unknown>> {
    return this.#deleteItem("anime", animeId);
  }

  deleteMyMangaListItem(mangaId: number): Promise<Record<string, unknown>> {
    return this.#deleteItem("manga", mangaId);
  }

  async #deleteItem(resource: Resource, id: number): Promise<Record<string, unknown>> {
    await this.#authed((token) =>
      this.#http.requestJson<unknown>(`${resource}/${id}/my_list_status`, {
        method: "DELETE",
        headers: bearer(token),
      }),
    );
    return { deleted: true, [`${resource}_id`]: id };
  }

  // ---- auth ----------------------------------------------------------------

  /** Run `fn` with a valid access token, refreshing once on 401 if possible. */
  async #authed<T>(fn: (token: string) => Promise<T>): Promise<T> {
    const token = await this.#ensureAccessToken();
    try {
      return await fn(token);
    } catch (err) {
      if (err instanceof ApiError && err.code === "unauthorized" && this.#auth.canRefresh) {
        this.#logger.info("access token rejected; attempting silent refresh");
        const fresh = await this.#refresh();
        return await fn(fresh);
      }
      throw err;
    }
  }

  async #ensureAccessToken(): Promise<string> {
    const valid = this.#state.accessToken && this.#state.expiresAt - REFRESH_SKEW_MS > Date.now();
    if (valid) return this.#state.accessToken;
    if (this.#auth.canRefresh) return this.#refresh();
    if (this.#state.accessToken) return this.#state.accessToken;
    throw new ApiError({
      code: "unauthorized",
      message: "No MyAnimeList access token configured",
    });
  }

  #refresh(): Promise<string> {
    // Coalesce concurrent refreshes into one in-flight request.
    this.#refreshing ??= this.#doRefresh().finally(() => {
      this.#refreshing = undefined;
    });
    return this.#refreshing;
  }

  async #doRefresh(): Promise<string> {
    const refreshToken = this.#state.refreshToken || this.#auth.refreshToken;
    if (!this.#auth.clientId || !this.#auth.clientSecret || !refreshToken) {
      throw new ApiError({
        code: "unauthorized",
        message: "Cannot refresh: missing client credentials or refresh token",
      });
    }
    const body = formBody({
      grant_type: "refresh_token",
      client_id: this.#auth.clientId,
      client_secret: this.#auth.clientSecret,
      refresh_token: refreshToken,
    });
    const res = await this.#oauth.requestJson<TokenResponse>("token", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      retries: 0,
    });

    this.#state = {
      accessToken: res.access_token,
      refreshToken: res.refresh_token ?? refreshToken,
      expiresAt: Date.now() + (res.expires_in ?? 0) * 1000,
    };
    this.#store?.save(this.#state);
    this.#logger.info("refreshed MyAnimeList access token");
    return this.#state.accessToken;
  }
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

interface MalListNode {
  node?: { id?: number; title?: string };
  list_status?: Record<string, unknown>;
}
interface MalListResponse {
  data?: MalListNode[];
  paging?: { next?: string; previous?: string };
}

function trimList(res: MalListResponse): Record<string, unknown> {
  return {
    items: (res.data ?? []).map((entry) => ({
      mal_id: entry.node?.id,
      title: entry.node?.title,
      list_status: entry.list_status,
    })),
    has_next_page: Boolean(res.paging?.next),
  };
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** Serialize a plain object to application/x-www-form-urlencoded, skipping nullish. */
function formBody(fields: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  return params.toString();
}
