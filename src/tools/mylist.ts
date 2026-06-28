// Personal-list tools backed by the official MAL API. These require a user
// token; when none is configured they return a clear, actionable error instead
// of failing the whole server. Write tools carry destructive/idempotent hints.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MalClient } from "../clients/mal.js";
import type { Config } from "../config.js";
import { errorResult, jsonResult, type ToolResult } from "../lib/result.js";
import { guard } from "./guard.js";

const NEEDS_TOKEN =
  "This tool needs MyAnimeList credentials, which are not configured. Set " +
  "MAL_CLIENT_ID, MAL_CLIENT_SECRET and MAL_REFRESH_TOKEN in your MCP client config " +
  "(the server's `env` block — it does not read a .env file). Get them via the " +
  "one-time OAuth described in docs/auth.md; the access token is then managed " +
  "automatically. (Advanced: a standalone MAL_ACCESS_TOKEN also works but expires in ~30 days.)";

const animeListStatus = z
  .enum(["watching", "completed", "on_hold", "dropped", "plan_to_watch"])
  .describe("List status bucket.");
const mangaListStatus = z
  .enum(["reading", "completed", "on_hold", "dropped", "plan_to_read"])
  .describe("List status bucket.");
const score = z.number().int().min(0).max(10).describe("Score 0-10 (0 clears the score).");
const listLimit = z.number().int().min(1).max(100).describe("Max results (1-100).");
const offset = z.number().int().min(0).describe("Offset for pagination.");
const malId = z.number().int().positive().describe("MyAnimeList numeric ID.");
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("Date as YYYY-MM-DD.");

export function registerMyListTools(server: McpServer, mal: MalClient, config: Config): void {
  // Run a personal-list operation only when a token is configured; otherwise
  // return an actionable error instead of failing.
  const requireToken = (fn: () => Promise<ToolResult>): Promise<ToolResult> =>
    config.auth.configured ? guard(fn) : Promise.resolve(errorResult(NEEDS_TOKEN));

  server.registerTool(
    "get_my_user_info",
    {
      title: "Get my MAL profile",
      description: "Get the authenticated user's MyAnimeList profile and anime statistics.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    () => requireToken(async () => jsonResult(await mal.getMyUserInfo())),
  );

  server.registerTool(
    "get_my_anime_list",
    {
      title: "Get my anime list",
      description:
        "Get the authenticated user's own anime list, with each entry's status, score and progress.",
      inputSchema: {
        status: animeListStatus.optional(),
        sort: z
          .enum(["list_score", "list_updated_at", "anime_title", "anime_start_date"])
          .describe("Sort order.")
          .optional(),
        limit: listLimit.optional(),
        offset: offset.optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => requireToken(async () => jsonResult(await mal.getMyAnimeList(args))),
  );

  server.registerTool(
    "get_my_manga_list",
    {
      title: "Get my manga list",
      description: "Get the authenticated user's own manga list, with status, score and progress.",
      inputSchema: {
        status: mangaListStatus.optional(),
        sort: z
          .enum(["list_score", "list_updated_at", "manga_title", "manga_start_date"])
          .describe("Sort order.")
          .optional(),
        limit: listLimit.optional(),
        offset: offset.optional(),
      },
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
        "dates). Creates the entry if absent. Provide at least one field besides anime_id.",
      inputSchema: {
        anime_id: malId,
        status: animeListStatus.optional(),
        score: score.optional(),
        num_watched_episodes: z.number().int().min(0).describe("Episodes watched.").optional(),
        is_rewatching: z.boolean().describe("Whether currently rewatching.").optional(),
        start_date: date.optional(),
        finish_date: date.optional(),
        comments: z.string().describe("Free-text comments.").optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    ({ anime_id, ...update }) =>
      requireToken(async () => jsonResult(await mal.updateMyAnimeStatus(anime_id, update))),
  );

  server.registerTool(
    "update_my_manga_status",
    {
      title: "Update my manga status",
      description:
        "Add or update a manga on the authenticated user's list (status, score, chapters/volumes read). " +
        "Creates the entry if absent. Provide at least one field besides manga_id.",
      inputSchema: {
        manga_id: malId,
        status: mangaListStatus.optional(),
        score: score.optional(),
        num_chapters_read: z.number().int().min(0).describe("Chapters read.").optional(),
        num_volumes_read: z.number().int().min(0).describe("Volumes read.").optional(),
        is_rereading: z.boolean().describe("Whether currently rereading.").optional(),
        comments: z.string().describe("Free-text comments.").optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    ({ manga_id, ...update }) =>
      requireToken(async () => jsonResult(await mal.updateMyMangaStatus(manga_id, update))),
  );

  server.registerTool(
    "delete_my_anime_list_item",
    {
      title: "Remove anime from my list",
      description:
        "Remove an anime entry from the authenticated user's list. This cannot be undone.",
      inputSchema: { anime_id: malId },
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
        "Remove a manga entry from the authenticated user's list. This cannot be undone.",
      inputSchema: { manga_id: malId },
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
