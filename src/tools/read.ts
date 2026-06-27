// Read-only tools backed by Jikan (no credentials required). Descriptions and
// per-field `.describe()` text are written for the calling model: they explain
// when to use each tool and the meaning/units of every parameter.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JikanClient } from "../clients/jikan.js";
import { jsonResult } from "../lib/result.js";
import { guard } from "./guard.js";

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

const animeType = z
  .enum(["tv", "movie", "ova", "special", "ona", "music", "cm", "pv", "tv_special"])
  .describe("Filter by media type.");
const animeStatus = z.enum(["airing", "complete", "upcoming"]).describe("Filter by airing status.");
const mangaType = z
  .enum(["manga", "novel", "lightnovel", "oneshot", "doujin", "manhwa", "manhua"])
  .describe("Filter by publication type.");
const mangaStatus = z
  .enum(["publishing", "complete", "hiatus", "discontinued", "upcoming"])
  .describe("Filter by publication status.");
const sortDir = z.enum(["desc", "asc"]).describe("Sort direction.");
const limit = z.number().int().min(1).max(25).describe("Max results per page (1-25).");
const page = z.number().int().min(1).describe("1-based page number for pagination.");
const sfw = z
  .boolean()
  .describe("If true, exclude adult (NSFW) entries. Defaults to false (no filtering).");
const malId = z.number().int().positive().describe("MyAnimeList numeric ID.");

export function registerReadTools(server: McpServer, jikan: JikanClient): void {
  server.registerTool(
    "search_anime",
    {
      title: "Search anime",
      description:
        "Search MyAnimeList anime by keyword. Use this to find an anime and its mal_id, " +
        "which other tools (get_anime, get_anime_characters, ...) require. Returns compact " +
        "summaries plus pagination info.",
      inputSchema: {
        q: z.string().min(1).describe("Search query, e.g. an anime title."),
        type: animeType.optional(),
        status: animeStatus.optional(),
        genres: z.string().describe("Comma-separated Jikan genre IDs, e.g. '1,4'.").optional(),
        order_by: z
          .enum([
            "title",
            "start_date",
            "score",
            "rank",
            "popularity",
            "members",
            "favorites",
            "episodes",
          ])
          .describe("Field to order by.")
          .optional(),
        sort: sortDir.optional(),
        sfw: sfw.optional(),
        limit: limit.optional(),
        page: page.optional(),
      },
      annotations: READ_ONLY,
    },
    (args) => guard(async () => jsonResult(await jikan.searchAnime(args))),
  );

  server.registerTool(
    "search_manga",
    {
      title: "Search manga",
      description:
        "Search MyAnimeList manga by keyword. Returns compact summaries and the mal_id needed " +
        "by get_manga. Covers manga, light novels, manhwa/manhua, etc.",
      inputSchema: {
        q: z.string().min(1).describe("Search query, e.g. a manga title."),
        type: mangaType.optional(),
        status: mangaStatus.optional(),
        genres: z.string().describe("Comma-separated Jikan genre IDs.").optional(),
        order_by: z
          .enum([
            "title",
            "start_date",
            "score",
            "rank",
            "popularity",
            "members",
            "favorites",
            "chapters",
            "volumes",
          ])
          .describe("Field to order by.")
          .optional(),
        sort: sortDir.optional(),
        sfw: sfw.optional(),
        limit: limit.optional(),
        page: page.optional(),
      },
      annotations: READ_ONLY,
    },
    (args) => guard(async () => jsonResult(await jikan.searchManga(args))),
  );

  server.registerTool(
    "get_anime",
    {
      title: "Get anime details",
      description:
        "Get full details for one anime by mal_id: synopsis, score, genres, studios, " +
        "streaming links and related entries. Obtain the mal_id from search_anime first.",
      inputSchema: { id: malId },
      annotations: READ_ONLY,
    },
    ({ id }) => guard(async () => jsonResult(await jikan.getAnime(id))),
  );

  server.registerTool(
    "get_manga",
    {
      title: "Get manga details",
      description:
        "Get full details for one manga by mal_id. Obtain the mal_id from search_manga first.",
      inputSchema: { id: malId },
      annotations: READ_ONLY,
    },
    ({ id }) => guard(async () => jsonResult(await jikan.getManga(id))),
  );

  server.registerTool(
    "get_anime_characters",
    {
      title: "Get anime characters",
      description:
        "List the characters of an anime (by mal_id) with their roles and Japanese voice actors.",
      inputSchema: { id: malId },
      annotations: READ_ONLY,
    },
    ({ id }) => guard(async () => jsonResult(await jikan.getAnimeCharacters(id))),
  );

  server.registerTool(
    "get_anime_recommendations",
    {
      title: "Get anime recommendations",
      description:
        "Get community recommendations for anime similar to the given mal_id, ordered by votes.",
      inputSchema: { id: malId },
      annotations: READ_ONLY,
    },
    ({ id }) => guard(async () => jsonResult(await jikan.getAnimeRecommendations(id))),
  );

  server.registerTool(
    "get_anime_reviews",
    {
      title: "Get anime reviews",
      description: "Get user reviews for an anime (by mal_id), including score and review text.",
      inputSchema: { id: malId, limit: limit.optional() },
      annotations: READ_ONLY,
    },
    ({ id, limit: lim }) =>
      guard(async () => jsonResult(await jikan.getAnimeReviews(id, lim ?? 5))),
  );

  server.registerTool(
    "get_top_anime",
    {
      title: "Get top anime",
      description:
        "Get ranked/top anime. Use `filter` for special rankings (airing, upcoming, bypopularity, favorite).",
      inputSchema: {
        type: z
          .enum(["tv", "movie", "ova", "special", "ona", "music"])
          .describe("Restrict to a media type.")
          .optional(),
        filter: z
          .enum(["airing", "upcoming", "bypopularity", "favorite"])
          .describe("Special ranking filter.")
          .optional(),
        limit: limit.optional(),
        page: page.optional(),
      },
      annotations: READ_ONLY,
    },
    (args) => guard(async () => jsonResult(await jikan.getTopAnime(args))),
  );

  server.registerTool(
    "get_top_manga",
    {
      title: "Get top manga",
      description:
        "Get ranked/top manga. Use `filter` for special rankings (bypopularity, favorite).",
      inputSchema: {
        type: mangaType.optional(),
        filter: z
          .enum(["publishing", "upcoming", "bypopularity", "favorite"])
          .describe("Special ranking filter.")
          .optional(),
        limit: limit.optional(),
        page: page.optional(),
      },
      annotations: READ_ONLY,
    },
    (args) => guard(async () => jsonResult(await jikan.getTopManga(args))),
  );

  server.registerTool(
    "get_seasonal_anime",
    {
      title: "Get seasonal anime",
      description:
        "List anime from a given season. Omit year and season to get the current season.",
      inputSchema: {
        year: z
          .number()
          .int()
          .min(1900)
          .max(2100)
          .describe("Four-digit year, e.g. 2024.")
          .optional(),
        season: z.enum(["winter", "spring", "summer", "fall"]).describe("Season name.").optional(),
        sfw: sfw.optional(),
        limit: limit.optional(),
        page: page.optional(),
      },
      annotations: READ_ONLY,
    },
    (args) => guard(async () => jsonResult(await jikan.getSeason(args))),
  );

  server.registerTool(
    "get_anime_schedule",
    {
      title: "Get broadcast schedule",
      description: "Get the anime broadcast schedule, optionally for a single weekday.",
      inputSchema: {
        day: z
          .enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"])
          .describe("Weekday to filter by. Omit for the whole week.")
          .optional(),
        limit: limit.optional(),
      },
      annotations: READ_ONLY,
    },
    ({ day, limit: lim }) => guard(async () => jsonResult(await jikan.getSchedule(day, lim ?? 25))),
  );

  server.registerTool(
    "get_user_profile",
    {
      title: "Get user profile",
      description: "Get a public MyAnimeList user's profile and watch/read statistics by username.",
      inputSchema: { username: z.string().min(1).describe("MyAnimeList username.") },
      annotations: READ_ONLY,
    },
    ({ username }) => guard(async () => jsonResult(await jikan.getUserProfile(username))),
  );

  server.registerTool(
    "get_user_favorites",
    {
      title: "Get user favorites",
      description:
        "Get a public MyAnimeList user's favorite anime, manga, characters and people by username.",
      inputSchema: { username: z.string().min(1).describe("MyAnimeList username.") },
      annotations: READ_ONLY,
    },
    ({ username }) => guard(async () => jsonResult(await jikan.getUserFavorites(username))),
  );
}
