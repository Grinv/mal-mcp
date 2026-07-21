// Client for the official MyAnimeList API (v2). Handles the personal-list
// operations that Jikan cannot do (they require a user token). Implements
// silent token refresh: on 401 (or when the cached access token is expired)
// it refreshes via grant_type=refresh_token and persists the rotated token.
import { z } from "zod";
import { HttpClient } from "../lib/http.js";
import { ApiError } from "../lib/errors.js";
import { TokenStore, type TokenState } from "../lib/tokenStore.js";
import {
  buildAuthorizeUrl,
  extractCode,
  generateVerifier,
  listenForCode,
  openBrowser,
} from "../lib/oauthLogin.js";
import { malApiHttpClient } from "./httpClients.js";
import type { Logger } from "../lib/logger.js";
import type { Config, MalAuth } from "../config.js";
import {
  myListSchema,
  deleteAnimeItemSchema,
  deleteMangaItemSchema,
} from "../lib/format.schemas.js";

const REFRESH_SKEW_MS = 60_000;

// Request the full list_status the update tools can WRITE, so reads round-trip
// them (priority/tags/comments/rewatch counters were previously write-only —
// settable via update_my_* but absent from get_my_*_list). Verified live: MAL
// returns these under list_status when asked.
const ANIME_LIST_FIELDS =
  "list_status{status,score,num_episodes_watched,is_rewatching,updated_at,start_date,finish_date," +
  "priority,num_times_rewatched,rewatch_value,tags,comments}";
const MANGA_LIST_FIELDS =
  "list_status{status,score,num_chapters_read,num_volumes_read,is_rereading,updated_at,start_date,finish_date," +
  "priority,num_times_reread,reread_value,tags,comments}";
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
  readonly #oauthBaseUrl: string;
  readonly #oauthPort: number;
  readonly #auth: MalAuth;
  readonly #logger: Logger;
  readonly #store: TokenStore | undefined;
  #state: TokenState;
  // Single-flight: dedupe concurrent refreshes so parallel 401s don't each spend
  // the (rotating) refresh token and clobber each other.
  #refreshing: Promise<string> | undefined;
  // In-progress interactive login (login_mal): the PKCE verifier + redirect URI
  // awaiting a code, and the localhost listener (if one could be bound).
  #pendingLogin: { verifier: string; redirectUri: string } | undefined;
  #loginServer: { close: () => void } | undefined;

  constructor(config: Config, logger: Logger, store?: TokenStore) {
    this.#auth = config.auth;
    this.#logger = logger;
    this.#store = store;
    // Deliberately no withThrottle() here (contrast OfficialReadsClient): personal-list
    // reads/writes are single user-initiated calls, not bulk enumeration, and MAL publishes
    // no rate limit for this API's OAuth-authenticated endpoints either way. Revisit if that
    // stops holding true.
    this.#http = malApiHttpClient(config, logger);
    this.#oauth = new HttpClient({
      baseUrl: config.malOauthBaseUrl,
      logger,
      timeoutMs: config.httpTimeoutMs,
      retries: config.httpRetries,
    });
    this.#oauthBaseUrl = config.malOauthBaseUrl;
    this.#oauthPort = config.oauthPort;

    const stored = store?.load();
    this.#state = stored ?? {
      accessToken: this.#auth.accessToken ?? "",
      refreshToken: this.#auth.refreshToken ?? "",
      // Unknown expiry for an env-provided token: trust it until a 401.
      expiresAt: this.#auth.accessToken ? Number.POSITIVE_INFINITY : 0,
    };
  }

  /** Whether the personal-list tools are usable right now — a valid access
   *  token in hand, or the means to refresh one. Computed live (not a static
   *  config snapshot) so a token obtained via login_mal during this session, or
   *  loaded from the token store, counts immediately. */
  isConfigured(): boolean {
    return Boolean(this.#state.accessToken || this.#canRefresh());
  }

  // Can we silently refresh? A client id plus a refresh token (from the live
  // state — e.g. just saved by login — or from env). The client secret is
  // optional (public PKCE client).
  #canRefresh(): boolean {
    return Boolean(this.#auth.clientId && (this.#state.refreshToken || this.#auth.refreshToken));
  }

  // ---- personal list operations -------------------------------------------
  // Anime and manga share the same MAL endpoints up to a `${resource}` segment,
  // so each public method delegates to one resource-parameterized private helper.

  async getMyUserInfo(): Promise<z.infer<typeof MyUserInfoSchema>> {
    const data = await this.#authed((token) =>
      this.#http.getJson<unknown>("users/@me", {
        query: { fields: USER_FIELDS },
        headers: bearer(token),
      }),
    );
    return parseUpstream(MyUserInfoSchema, data, "get_my_user_info");
  }

  getMyAnimeList(p: AnimeListParams): Promise<z.infer<typeof myListSchema>> {
    return this.#getMyList("anime", ANIME_LIST_FIELDS, p);
  }

  getMyMangaList(p: AnimeListParams): Promise<z.infer<typeof myListSchema>> {
    return this.#getMyList("manga", MANGA_LIST_FIELDS, p);
  }

  async #getMyList(
    resource: Resource,
    fields: string,
    p: AnimeListParams,
  ): Promise<z.infer<typeof myListSchema>> {
    const data = await this.#authed((token) =>
      this.#http.getJson<unknown>(`users/@me/${resource}list`, {
        query: { fields, status: p.status, sort: p.sort, limit: p.limit, offset: p.offset },
        headers: bearer(token),
      }),
    );
    const res = parseUpstream(MalListResponseSchema, data, `get_my_${resource}_list`);
    return trimList(res);
  }

  updateMyAnimeStatus(
    animeId: number,
    update: AnimeStatusUpdate,
  ): Promise<z.infer<typeof ListStatusUpdateResponseSchema>> {
    return this.#updateStatus("anime", animeId, update);
  }

  updateMyMangaStatus(
    mangaId: number,
    update: MangaStatusUpdate,
  ): Promise<z.infer<typeof ListStatusUpdateResponseSchema>> {
    return this.#updateStatus("manga", mangaId, update);
  }

  async #updateStatus(
    resource: Resource,
    id: number,
    update: AnimeStatusUpdate | MangaStatusUpdate,
  ): Promise<z.infer<typeof ListStatusUpdateResponseSchema>> {
    const data = await this.#authed((token) =>
      this.#http.requestJson<unknown>(`${resource}/${id}/my_list_status`, {
        method: "PATCH",
        body: formBody(update),
        headers: { ...bearer(token), "Content-Type": "application/x-www-form-urlencoded" },
      }),
    );
    return parseUpstream(ListStatusUpdateResponseSchema, data, `update_my_${resource}_status`);
  }

  async deleteMyAnimeListItem(animeId: number): Promise<z.infer<typeof deleteAnimeItemSchema>> {
    return deleteAnimeItemSchema.parse(await this.#deleteItem("anime", animeId));
  }

  async deleteMyMangaListItem(mangaId: number): Promise<z.infer<typeof deleteMangaItemSchema>> {
    return deleteMangaItemSchema.parse(await this.#deleteItem("manga", mangaId));
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
      if (err instanceof ApiError && err.code === "unauthorized" && this.#canRefresh()) {
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
    if (this.#canRefresh()) return this.#refresh();
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
    if (!this.#auth.clientId || !refreshToken) {
      throw new ApiError({
        code: "unauthorized",
        message: "Cannot refresh: missing client id or refresh token",
      });
    }
    // Public (secret-less) PKCE client → no client_secret in the request.
    const body = formBody({
      grant_type: "refresh_token",
      client_id: this.#auth.clientId,
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

  // ---- interactive login (login_mal / submit_mal_redirect) -----------------

  /** The localhost Redirect URI the MAL app must be registered with. */
  get redirectUri(): string {
    return `http://localhost:${this.#oauthPort}/callback`;
  }

  /** Begin an interactive OAuth login and return the authorize URL for the user
   *  to open. Best-effort, so it works in every environment: it also starts a
   *  localhost listener (auto-completes when the browser is on the same machine)
   *  and tries to open the browser. When the browser is remote/headless, the
   *  user finishes by pasting the redirected URL into {@link submitRedirect}. */
  async startLogin(options: { open?: (url: string) => void } = {}): Promise<{
    authorizeUrl: string;
    redirectUri: string;
    listening: boolean;
  }> {
    if (!this.#auth.clientId) {
      throw new ApiError({ code: "unauthorized", message: "Set MAL_CLIENT_ID before login." });
    }
    this.#loginServer?.close(); // supersede any prior pending login
    this.#loginServer = undefined;

    const verifier = generateVerifier();
    const redirectUri = this.redirectUri;
    this.#pendingLogin = { verifier, redirectUri };
    const authorizeUrl = buildAuthorizeUrl({
      oauthBaseUrl: this.#oauthBaseUrl,
      clientId: this.#auth.clientId,
      redirectUri,
      verifier,
      state: "login_mal",
    });

    let listening = false;
    try {
      this.#loginServer = await listenForCode({
        port: this.#oauthPort,
        path: "/callback",
        onCode: (code) => {
          void this.#completeWithCode(code).catch((err) =>
            this.#logger.warn(`login_mal callback exchange failed: ${errMsg(err)}`),
          );
        },
      });
      listening = true;
    } catch (err) {
      // Port busy / can't bind → user completes via submit_mal_redirect instead.
      this.#logger.info(`login_mal: local callback unavailable (${errMsg(err)}); use manual paste`);
    }

    (options.open ?? openBrowser)(authorizeUrl);
    return { authorizeUrl, redirectUri, listening };
  }

  /** Finish an interactive login from the redirected URL (or bare code) the user
   *  pasted back — the remote/headless path. */
  async submitRedirect(redirect: string): Promise<void> {
    if (!this.#pendingLogin) {
      throw new ApiError({
        code: "bad_request",
        message: "No login in progress; run login_mal first.",
      });
    }
    await this.#completeWithCode(extractCode(redirect));
  }

  // Exchange an authorization code for tokens (public PKCE client → no secret),
  // persist them, and clear the pending-login state.
  async #completeWithCode(code: string): Promise<void> {
    const pending = this.#pendingLogin;
    if (!pending) throw new ApiError({ code: "bad_request", message: "No login in progress." });
    const body = formBody({
      grant_type: "authorization_code",
      client_id: this.#auth.clientId,
      code,
      code_verifier: pending.verifier,
      redirect_uri: pending.redirectUri,
    });
    const res = await this.#oauth.requestJson<TokenResponse>("token", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      retries: 0,
    });
    this.#state = {
      accessToken: res.access_token,
      refreshToken: res.refresh_token ?? "",
      expiresAt: Date.now() + (res.expires_in ?? 0) * 1000,
    };
    this.#store?.save(this.#state);
    this.#pendingLogin = undefined;
    this.#loginServer?.close();
    this.#loginServer = undefined;
    this.#logger.info("login_mal: obtained and stored a MyAnimeList token");
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

// Response shapes are validated (not just cast) at the boundary: the official API drives
// data straight into the tool result with no summarizer in between (unlike Jikan/officialReads,
// whose format.ts/formatOfficial.ts reshape every field), so a malformed/unexpected response
// here would otherwise reach the agent completely unnoticed. Every schema declared IN THIS FILE
// is .passthrough() — we only assert the fields we read have sane types, never reject fields MAL
// adds later. myListSchema/deleteAnimeItemSchema/deleteMangaItemSchema below are the exception:
// they describe trimList()'s/deleteMy*ListItem()'s own shaped output, not a raw upstream
// response, so — same convention as format.schemas.ts — they're .strict() and defined there.

const MalListNodeSchema = z
  .object({
    node: z.object({ id: z.number().optional(), title: z.string().optional() }).optional(),
    list_status: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const MalListResponseSchema = z
  .object({
    data: z.array(MalListNodeSchema).optional(),
    paging: z.object({ next: z.string().optional(), previous: z.string().optional() }).optional(),
  })
  .passthrough();

// Exported for reuse as the get_my_user_info tool's outputSchema — it's the exact shape this
// client hands back (no summarizer in between, see the comment above), so the same
// upstream-validating schema doubles as the MCP-facing one.
export const MyUserInfoSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    location: z.string().nullable().optional(),
    joined_at: z.string().optional(),
    anime_statistics: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

// Loose on purpose: anime and manga list_status responses differ (num_episodes_watched vs
// num_chapters_read/num_volumes_read, is_rewatching vs is_rereading, …) and MAL may add fields —
// this only confirms the response is the object shape update_my_*_status promises, not a bare
// array/string/null a broken upstream could return. Exported for reuse as the
// update_my_anime_status/update_my_manga_status tools' outputSchema, same reasoning as
// MyUserInfoSchema above.
export const ListStatusUpdateResponseSchema = z
  .object({
    status: z.string().optional(),
    score: z.number().optional(),
  })
  .passthrough();

/** Validate an upstream JSON response against `schema`; a mismatch becomes an actionable
 *  ApiError instead of silently forwarding a malformed shape to the agent. */
function parseUpstream<T>(schema: z.ZodType<T>, data: unknown, context: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ApiError({
      code: "unknown",
      message:
        `MyAnimeList returned an unexpected response shape for ${context}: ` +
        result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
    });
  }
  return result.data;
}

function trimList(res: z.infer<typeof MalListResponseSchema>): z.infer<typeof myListSchema> {
  return myListSchema.parse({
    items: (res.data ?? []).map((entry) => ({
      mal_id: entry.node?.id,
      title: entry.node?.title,
      list_status: entry.list_status,
    })),
    has_next_page: Boolean(res.paging?.next),
  });
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
