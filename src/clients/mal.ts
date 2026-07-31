// Client for the official MyAnimeList API (v2). Handles the personal-list
// operations that Tenrai cannot do (they require a user token). OAuth token
// lifecycle (silent refresh, the login_mal/submit_mal_redirect PKCE flow) is
// delegated to MalAuthManager (malAuth.ts) — this class owns only the
// personal-list CRUD calls and their request/response shaping.
import { z } from "zod";
import { ApiError } from "../lib/errors.js";
import { TokenStore } from "../lib/tokenStore.js";
import { malApiHttpClient, formBody } from "./httpClients.js";
import { MalAuthManager } from "./malAuth.js";
import type { HttpClient } from "../lib/http.js";
import type { Logger } from "../lib/logger.js";
import type { Config } from "../config.js";
import {
  myListSchema,
  myListItemSchema,
  deleteAnimeItemSchema,
  deleteMangaItemSchema,
} from "../lib/format.schemas.js";
import { mapLenient } from "../lib/format.js";
import type { AnimeListStatus, MangaListStatus, AnimeListSort, MangaListSort } from "./malEnums.js";

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

interface ListParamsBase {
  limit?: number;
  offset?: number;
}

export interface AnimeListParams extends ListParamsBase {
  status?: AnimeListStatus;
  sort?: AnimeListSort;
}

export interface MangaListParams extends ListParamsBase {
  status?: MangaListStatus;
  sort?: MangaListSort;
}

export interface AnimeStatusUpdate {
  status?: AnimeListStatus;
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
  status?: MangaListStatus;
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
  readonly #auth: MalAuthManager;

  constructor(config: Config, logger: Logger, store?: TokenStore) {
    // Deliberately no withThrottle() here (contrast OfficialReadsClient): personal-list
    // reads/writes are single user-initiated calls, not bulk enumeration, and MAL publishes
    // no rate limit for this API's OAuth-authenticated endpoints either way. Revisit if that
    // stops holding true.
    this.#http = malApiHttpClient(config, logger);
    this.#auth = new MalAuthManager(config, logger, store);
  }

  /** Whether the personal-list tools are usable right now — a valid access
   *  token in hand, or the means to refresh one. Computed live (not a static
   *  config snapshot) so a token obtained via login_mal during this session, or
   *  loaded from the token store, counts immediately. */
  isConfigured(): boolean {
    return this.#auth.isConfigured();
  }

  /** Begin an interactive OAuth login and return the authorize URL for the user
   *  to open. See MalAuthManager.startLogin for the full contract. */
  startLogin(options: { open?: (url: string) => void } = {}): Promise<{
    authorizeUrl: string;
    redirectUri: string;
    listening: boolean;
  }> {
    return this.#auth.startLogin(options);
  }

  /** Finish an interactive login from the redirected URL (or bare code) the user
   *  pasted back — the remote/headless path. */
  submitRedirect(redirect: string): Promise<void> {
    return this.#auth.submitRedirect(redirect);
  }

  // ---- personal list operations -------------------------------------------
  // Anime and manga share the same MAL endpoints up to a `${resource}` segment,
  // so each public method delegates to one resource-parameterized private helper.

  async getMyUserInfo(): Promise<z.infer<typeof MyUserInfoSchema>> {
    const data = await this.#auth.withAuth((token) =>
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

  getMyMangaList(p: MangaListParams): Promise<z.infer<typeof myListSchema>> {
    return this.#getMyList("manga", MANGA_LIST_FIELDS, p);
  }

  async #getMyList(
    resource: Resource,
    fields: string,
    p: AnimeListParams | MangaListParams,
  ): Promise<z.infer<typeof myListSchema>> {
    const data = await this.#auth.withAuth((token) =>
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
    const data = await this.#auth.withAuth((token) =>
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
    await this.#auth.withAuth((token) =>
      this.#http.requestJson<unknown>(`${resource}/${id}/my_list_status`, {
        method: "DELETE",
        headers: bearer(token),
      }),
    );
    return { deleted: true, [`${resource}_id`]: id };
  }
}

// Response shapes are validated (not just cast) at the boundary: the official API drives
// data straight into the tool result with no summarizer in between (unlike Tenrai/officialReads,
// whose format.ts/formatOfficial.ts reshape every field), so a malformed/unexpected response
// here would otherwise reach the agent completely unnoticed. Every schema declared IN THIS FILE
// is z.looseObject() — we only assert the fields we read have sane types, never reject fields MAL
// adds later. myListSchema/deleteAnimeItemSchema/deleteMangaItemSchema below are the exception:
// they describe trimList()'s/deleteMy*ListItem()'s own shaped output, not a raw upstream
// response, so — same convention as format.schemas.ts — they're z.strictObject() and defined
// there. (z.looseObject()/z.strictObject() are zod v4's replacements for the legacy
// z.object({...}).passthrough()/.strict() chains — .passthrough() is deprecated outright.)

const MalListNodeSchema = z.looseObject({
  node: z.object({ id: z.int().positive().optional(), title: z.string().optional() }).optional(),
  list_status: z.record(z.string(), z.unknown()).optional(),
});

const MalListResponseSchema = z.looseObject({
  data: z.array(MalListNodeSchema).optional(),
  paging: z.object({ next: z.string().optional(), previous: z.string().optional() }).optional(),
});

// Exported for reuse as the get_my_user_info tool's outputSchema — it's the exact shape this
// client hands back (no summarizer in between, see the comment above), so the same
// upstream-validating schema doubles as the MCP-facing one.
export const MyUserInfoSchema = z.looseObject({
  id: z.int().positive(),
  name: z.string(),
  location: z.string().nullable().optional(),
  joined_at: z.string().optional(),
  anime_statistics: z.record(z.string(), z.unknown()).optional(),
});

// Loose on purpose: anime and manga list_status responses differ (num_episodes_watched vs
// num_chapters_read/num_volumes_read, is_rewatching vs is_rereading, …) and MAL may add fields —
// this only confirms the response is the object shape update_my_*_status promises, not a bare
// array/string/null a broken upstream could return. Exported for reuse as the
// update_my_anime_status/update_my_manga_status tools' outputSchema, same reasoning as
// MyUserInfoSchema above.
export const ListStatusUpdateResponseSchema = z.looseObject({
  status: z.string().optional(),
  // Same 0-10 whole-number scale as mylist.ts's own `score` input field.
  score: z.int().min(0).max(10).optional(),
});

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

// A list entry with no resolvable mal_id (e.g. an orphaned entry pointing at a removed/merged
// MAL title — a real, if rare, MAL data quirk) is dropped rather than failing the whole page —
// see format.ts's `mapLenient`.
function trimList(res: z.infer<typeof MalListResponseSchema>): z.infer<typeof myListSchema> {
  return myListSchema.parse({
    items: mapLenient(res.data ?? [], myListItemSchema, (entry) => ({
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
