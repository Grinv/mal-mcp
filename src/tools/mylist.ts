// Personal-list tools backed by the official MAL API. These require a user
// token; when none is configured they return a clear, actionable error instead
// of failing the whole server. Write tools carry destructive/idempotent hints.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  type MalClient,
  MyUserInfoSchema,
  ListStatusUpdateResponseSchema,
} from "../clients/mal.js";
import {
  myListSchema,
  deleteAnimeItemSchema,
  deleteMangaItemSchema,
} from "../lib/format.schemas.js";
import { errorResult, jsonResult, type ToolResult } from "../lib/result.js";
import { ApiError } from "../lib/errors.js";
import { guard } from "./guard.js";

const NEEDS_TOKEN =
  "This tool needs a MyAnimeList login, which isn't set up yet. Register a MAL API " +
  "app (type 'other') at https://myanimelist.net/apiconfig, set MAL_CLIENT_ID in your " +
  "MCP client config, then run the `login_mal` tool once to authorize — it stores the " +
  "token and refreshes it automatically afterwards. See docs/auth.md. (Alternatives: " +
  "pre-supply the MAL_CLIENT_ID + MAL_REFRESH_TOKEN pair, or a standalone MAL_ACCESS_TOKEN " +
  "that expires in ~30 days.)";

const animeListStatus = z
  .enum(["watching", "completed", "on_hold", "dropped", "plan_to_watch"])
  .describe("List status bucket.");
const mangaListStatus = z
  .enum(["reading", "completed", "on_hold", "dropped", "plan_to_read"])
  .describe("List status bucket.");
const score = z.number().int().min(0).max(10).describe("Score 0-10 (0 clears the score).");
const priority = z
  .number()
  .int()
  .min(0)
  .max(2)
  .describe("List priority: 0 = low, 1 = medium, 2 = high.");
const rewatchValue = z
  .number()
  .int()
  .min(0)
  .max(5)
  .describe("Rewatch/reread value: 0 = none … 5 = very high.");
const tags = z.string().describe("Comma-separated free-text tags.");
const listLimit = z.number().int().min(1).max(100).describe("Max results (1-100).");
const offset = z.number().int().min(0).describe("Offset for pagination.");
const malId = z.number().int().positive().describe("MyAnimeList numeric ID.");
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("Date as YYYY-MM-DD.");

export function registerMyListTools(server: McpServer, mal: MalClient): void {
  // Run a personal-list operation only when authenticated; otherwise return an
  // actionable error instead of failing. Checked live (not the startup config
  // snapshot) so a token obtained via login_mal this session unlocks the tools
  // immediately.
  const requireToken = (fn: () => Promise<ToolResult>): Promise<ToolResult> =>
    mal.isConfigured() ? guard(fn) : Promise.resolve(errorResult(NEEDS_TOKEN));

  server.registerTool(
    "get_my_user_info",
    {
      title: "Get my MAL profile",
      description:
        "Get the logged-in user's MyAnimeList profile and anime watch-status statistics. " +
        "Requires MyAnimeList authentication (via `login_mal`, or a pre-supplied " +
        "`MAL_REFRESH_TOKEN`/`MAL_ACCESS_TOKEN`). Anime-only — the official API has no manga " +
        "statistics field at all; use get_user_profile with your own username instead for " +
        "manga read stats too (no login needed).",
      inputSchema: {},
      outputSchema: MyUserInfoSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    () => requireToken(async () => jsonResult(await mal.getMyUserInfo())),
  );

  server.registerTool(
    "get_my_anime_list",
    {
      title: "Get my anime list",
      description:
        "Get the authenticated user's own anime list, with each entry's status, score and progress. " +
        "Requires MyAnimeList authentication (via `login_mal`, or a pre-supplied " +
        "`MAL_REFRESH_TOKEN`/`MAL_ACCESS_TOKEN`).",
      inputSchema: {
        status: animeListStatus.optional(),
        sort: z
          .enum(["list_score", "list_updated_at", "anime_title", "anime_start_date"])
          .describe("Sort order.")
          .optional(),
        limit: listLimit.optional(),
        offset: offset.optional(),
      },
      outputSchema: myListSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => requireToken(async () => jsonResult(await mal.getMyAnimeList(args))),
  );

  server.registerTool(
    "get_my_manga_list",
    {
      title: "Get my manga list",
      description:
        "Get the authenticated user's own manga list, with status, score and progress. Requires " +
        "MyAnimeList authentication (via `login_mal`, or a pre-supplied " +
        "`MAL_REFRESH_TOKEN`/`MAL_ACCESS_TOKEN`).",
      inputSchema: {
        status: mangaListStatus.optional(),
        sort: z
          .enum(["list_score", "list_updated_at", "manga_title", "manga_start_date"])
          .describe("Sort order.")
          .optional(),
        limit: listLimit.optional(),
        offset: offset.optional(),
      },
      outputSchema: myListSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => requireToken(async () => jsonResult(await mal.getMyMangaList(args))),
  );

  server.registerTool(
    "update_my_anime_status",
    {
      title: "Update my anime status",
      description:
        "Add or update an anime on the authenticated user's list (status, score, watched episodes, " +
        "dates). Creates the entry if absent; fields you omit are left unchanged on an existing " +
        "entry. Provide at least one field besides anime_id. Requires MyAnimeList authentication " +
        "(via `login_mal`, or a pre-supplied `MAL_REFRESH_TOKEN`/`MAL_ACCESS_TOKEN`).",
      inputSchema: {
        anime_id: malId,
        status: animeListStatus.optional(),
        score: score.optional(),
        num_watched_episodes: z
          .number()
          .int()
          .min(0)
          .describe(
            "Episodes watched. Note: get_my_anime_list returns this same value as " +
              "`num_episodes_watched` — the field name is intentionally different here.",
          )
          .optional(),
        is_rewatching: z.boolean().describe("Whether currently rewatching.").optional(),
        num_times_rewatched: z.number().int().min(0).describe("Times rewatched.").optional(),
        rewatch_value: rewatchValue.optional(),
        priority: priority.optional(),
        tags: tags.optional(),
        start_date: date.optional(),
        finish_date: date.optional(),
        comments: z.string().describe("Free-text comments.").optional(),
      },
      outputSchema: ListStatusUpdateResponseSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    ({ anime_id, ...update }) =>
      requireToken(async () => {
        if (Object.keys(update).length === 0) {
          throw new ApiError({
            code: "bad_request",
            message: "Provide at least one field besides anime_id.",
          });
        }
        return jsonResult(await mal.updateMyAnimeStatus(anime_id, update));
      }),
  );

  server.registerTool(
    "update_my_manga_status",
    {
      title: "Update my manga status",
      description:
        "Add or update a manga on the authenticated user's list (status, score, chapters/volumes " +
        "read). Creates the entry if absent; fields you omit are left unchanged on an existing " +
        "entry. Provide at least one field besides manga_id. Requires MyAnimeList authentication " +
        "(via `login_mal`, or a pre-supplied `MAL_REFRESH_TOKEN`/`MAL_ACCESS_TOKEN`).",
      inputSchema: {
        manga_id: malId,
        status: mangaListStatus.optional(),
        score: score.optional(),
        num_chapters_read: z.number().int().min(0).describe("Chapters read.").optional(),
        num_volumes_read: z.number().int().min(0).describe("Volumes read.").optional(),
        is_rereading: z.boolean().describe("Whether currently rereading.").optional(),
        num_times_reread: z.number().int().min(0).describe("Times reread.").optional(),
        reread_value: rewatchValue.optional(),
        priority: priority.optional(),
        tags: tags.optional(),
        comments: z.string().describe("Free-text comments.").optional(),
      },
      outputSchema: ListStatusUpdateResponseSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    ({ manga_id, ...update }) =>
      requireToken(async () => {
        if (Object.keys(update).length === 0) {
          throw new ApiError({
            code: "bad_request",
            message: "Provide at least one field besides manga_id.",
          });
        }
        return jsonResult(await mal.updateMyMangaStatus(manga_id, update));
      }),
  );

  server.registerTool(
    "delete_my_anime_list_item",
    {
      title: "Remove anime from my list",
      description:
        "Remove an anime entry from the authenticated user's list. This cannot be undone. " +
        "Requires MyAnimeList authentication (via `login_mal`, or a pre-supplied " +
        "`MAL_REFRESH_TOKEN`/`MAL_ACCESS_TOKEN`).",
      inputSchema: { anime_id: malId },
      outputSchema: deleteAnimeItemSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    ({ anime_id }) =>
      requireToken(async () => jsonResult(await mal.deleteMyAnimeListItem(anime_id))),
  );

  server.registerTool(
    "delete_my_manga_list_item",
    {
      title: "Remove manga from my list",
      description:
        "Remove a manga entry from the authenticated user's list. This cannot be undone. " +
        "Requires MyAnimeList authentication (via `login_mal`, or a pre-supplied " +
        "`MAL_REFRESH_TOKEN`/`MAL_ACCESS_TOKEN`).",
      inputSchema: { manga_id: malId },
      outputSchema: deleteMangaItemSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    ({ manga_id }) =>
      requireToken(async () => jsonResult(await mal.deleteMyMangaListItem(manga_id))),
  );
}
