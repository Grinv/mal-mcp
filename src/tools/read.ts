// Read-only tools backed by Jikan (no credentials required). Each tool maps a
// validated input to one JikanClient call; `reply` wraps that call in the shared
// guard/jsonResult plumbing so the handlers stay one-liners. Descriptions and
// per-field `.describe()` text are written for the calling model: they explain
// when to use a tool and the meaning/units of every parameter.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { JikanClient } from "../clients/jikan.js";
import { jsonResult, type ToolResult } from "../lib/result.js";
import { guard } from "./guard.js";
import {
  animeDetailSchema,
  animeSummarySchema,
  charactersSchema,
  characterEntitySchema,
  episodesSchema,
  favoritesSchema,
  genresSchema,
  listPageSchema,
  mangaDetailSchema,
  mangaSummarySchema,
  newsItemSchema,
  personEntitySchema,
  producerSchema,
  recommendationsSchema,
  reviewsSchema,
  seasonsListSchema,
  staffSchema,
  statisticsSchema,
  userSchema,
} from "../lib/format.schemas.js";

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
const genreFilter = z
  .enum(["genres", "explicit_genres", "themes", "demographics"])
  .describe("Restrict to one kind of tag. Omit to list all.");
const genreIds = (lookupTool: string) =>
  z
    .string()
    .regex(/^\d+(,\d+)*$/, "Comma-separated numeric genre IDs, e.g. '1,4' — no other format.")
    .describe(`Comma-separated Jikan genre IDs, e.g. '1,4'. Look up the IDs with ${lookupTool}.`);

/** Run a client call and wrap its result (or any failure) as a tool result. */
const reply = (fn: () => Promise<Record<string, unknown>>): Promise<ToolResult> =>
  guard(async () => jsonResult(await fn()));

export function registerReadTools(server: McpServer, jikan: JikanClient): void {
  server.registerTool(
    "search_anime",
    {
      title: "Search anime",
      description:
        "Search MyAnimeList anime by keyword; returns compact summaries (with the mal_id that " +
        "other anime tools require) plus pagination info. If Jikan is unavailable and " +
        "MAL_CLIENT_ID is set, transparently retries via the official API, which ignores " +
        "`genres`/`status`/`order_by`/`sort` (only `q`/`sfw`/`limit`/`page` still apply), " +
        "always returns empty `themes`/`demographics` and no `broadcast` (no official-API " +
        "equivalent for any of these), enforces " +
        "an explicit `sfw: true` client-side (a filtered page can come back shorter than " +
        "`limit`), and — for a query with no real title match — comes back with a page of " +
        "unrelated anime instead of an empty result (a quirk of the official search endpoint " +
        "itself, not a mal-mcp bug; don't treat a nonsense-query result as a real match during " +
        "a fallback).",
      inputSchema: z
        .object({
          q: z.string().trim().min(1).describe("Search query, e.g. an anime title."),
          type: animeType.optional(),
          status: animeStatus.optional(),
          genres: genreIds("get_anime_genres").optional(),
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
        })
        .strict(),
      outputSchema: listPageSchema(animeSummarySchema),
      annotations: READ_ONLY,
    },
    (args) => reply(() => jikan.searchAnime(args)),
  );

  server.registerTool(
    "search_manga",
    {
      title: "Search manga",
      description:
        "Search MyAnimeList manga by keyword (also light novels, manhwa/manhua); returns compact " +
        "summaries with the mal_id that other manga tools require. If Jikan is unavailable and " +
        "MAL_CLIENT_ID is set, transparently retries via the official API, which ignores " +
        "`genres`/`status`/`order_by`/`sort` (only `q`/`sfw`/`limit`/`page` still apply), " +
        "always returns empty `themes`/`demographics` (no official-API equivalent), enforces " +
        "an explicit `sfw: true` client-side (a filtered page can come back shorter than " +
        "`limit`), and — for a query with no real title match — comes back with a page of " +
        "unrelated manga instead of an empty result (a quirk of the official search endpoint " +
        "itself, not a mal-mcp bug; don't treat a nonsense-query result as a real match during " +
        "a fallback).",
      inputSchema: z
        .object({
          q: z.string().trim().min(1).describe("Search query, e.g. a manga title."),
          type: mangaType.optional(),
          status: mangaStatus.optional(),
          genres: genreIds("get_manga_genres").optional(),
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
        })
        .strict(),
      outputSchema: listPageSchema(mangaSummarySchema),
      annotations: READ_ONLY,
    },
    (args) => reply(() => jikan.searchManga(args)),
  );

  server.registerTool(
    "get_anime",
    {
      title: "Get anime details",
      description:
        "Get full details for one anime by mal_id: synopsis, score, genres, studios, " +
        "streaming links and related entries. Obtain the mal_id from search_anime first. If " +
        "Jikan is unavailable and MAL_CLIENT_ID is set, transparently retries via the official " +
        "API, which omits `producers`/`licensors`/`streaming`/`opening_themes`/`ending_themes`/" +
        "`trailer`/`favorites` (no equivalent fields there).",
      inputSchema: z.object({ id: malId }).strict(),
      outputSchema: animeDetailSchema,
      annotations: READ_ONLY,
    },
    ({ id }) => reply(() => jikan.getAnime(id)),
  );

  server.registerTool(
    "get_manga",
    {
      title: "Get manga details",
      description:
        "Get full details for one manga by mal_id: synopsis, score, genres, authors, " +
        "serialization, and related entries. Obtain the mal_id from search_manga first. If " +
        "Jikan is unavailable and MAL_CLIENT_ID is set, transparently retries via the official " +
        "API, which omits `favorites` (no equivalent field there).",
      inputSchema: z.object({ id: malId }).strict(),
      outputSchema: mangaDetailSchema,
      annotations: READ_ONLY,
    },
    ({ id }) => reply(() => jikan.getManga(id)),
  );

  server.registerTool(
    "get_anime_characters",
    {
      title: "Get anime characters",
      description:
        "List the characters of an anime (by mal_id) with their roles and Japanese voice actors. " +
        "Get the mal_id from search_anime.",
      inputSchema: z.object({ id: malId }).strict(),
      outputSchema: charactersSchema,
      annotations: READ_ONLY,
    },
    ({ id }) => reply(() => jikan.getAnimeCharacters(id)),
  );

  server.registerTool(
    "get_manga_characters",
    {
      title: "Get manga characters",
      description:
        "List the characters of a manga (by mal_id) with their roles. Get the mal_id from search_manga.",
      inputSchema: z.object({ id: malId }).strict(),
      outputSchema: charactersSchema,
      annotations: READ_ONLY,
    },
    ({ id }) => reply(() => jikan.getMangaCharacters(id)),
  );

  server.registerTool(
    "get_anime_episodes",
    {
      title: "Get anime episodes",
      description:
        "List an anime's episodes (by mal_id) with titles, air dates and filler/recap flags. " +
        "Paginated (~100 per page); use `page` for long-running series. Get the mal_id from search_anime.",
      inputSchema: z.object({ id: malId, page: page.optional() }).strict(),
      outputSchema: episodesSchema,
      annotations: READ_ONLY,
    },
    ({ id, page: pg }) => reply(() => jikan.getAnimeEpisodes(id, pg)),
  );

  server.registerTool(
    "get_anime_recommendations",
    {
      title: "Get anime recommendations",
      description:
        "Get community recommendations for anime similar to the given mal_id, ordered by votes " +
        "and capped at the top 25 (no pagination). Get the mal_id from search_anime. Use " +
        "get_top_anime instead for a global popularity/score ranking not tied to one title. If " +
        "Jikan is unavailable and MAL_CLIENT_ID is set, transparently retries via the official " +
        "API's own recommendations field (same output shape, but ordering/counts may differ " +
        "slightly from Jikan's).",
      inputSchema: z.object({ id: malId }).strict(),
      outputSchema: recommendationsSchema,
      annotations: READ_ONLY,
    },
    ({ id }) => reply(() => jikan.getAnimeRecommendations(id)),
  );

  server.registerTool(
    "get_anime_reviews",
    {
      title: "Get anime reviews",
      description:
        "Get user reviews for one anime (by mal_id), including score and review text (truncated " +
        "to 1200 characters). Defaults to 5 reviews if `limit` is omitted. Get the mal_id from " +
        "search_anime.",
      inputSchema: z.object({ id: malId, limit: limit.default(5) }).strict(),
      outputSchema: reviewsSchema,
      annotations: READ_ONLY,
    },
    ({ id, limit: lim }) => reply(() => jikan.getAnimeReviews(id, lim)),
  );

  server.registerTool(
    "get_manga_recommendations",
    {
      title: "Get manga recommendations",
      description:
        "Get community recommendations for manga similar to the given mal_id, ordered by votes " +
        "and capped at the top 25 (no pagination). Get the mal_id from search_manga. Use " +
        "get_top_manga instead for a global popularity/score ranking not tied to one title. If " +
        "Jikan is unavailable and MAL_CLIENT_ID is set, transparently retries via the official " +
        "API's own recommendations field (same output shape, but ordering/counts may differ " +
        "slightly from Jikan's).",
      inputSchema: z.object({ id: malId }).strict(),
      outputSchema: recommendationsSchema,
      annotations: READ_ONLY,
    },
    ({ id }) => reply(() => jikan.getMangaRecommendations(id)),
  );

  server.registerTool(
    "get_manga_reviews",
    {
      title: "Get manga reviews",
      description:
        "Get user reviews for one manga (by mal_id), including score and review text (truncated " +
        "to 1200 characters). Defaults to 5 reviews if `limit` is omitted. Get the mal_id from " +
        "search_manga.",
      inputSchema: z.object({ id: malId, limit: limit.default(5) }).strict(),
      outputSchema: reviewsSchema,
      annotations: READ_ONLY,
    },
    ({ id, limit: lim }) => reply(() => jikan.getMangaReviews(id, lim)),
  );

  server.registerTool(
    "get_top_anime",
    {
      title: "Get top anime",
      description:
        "Get anime ranked by all-time score/popularity, not tied to any season. Use `filter` for " +
        "special rankings (airing, upcoming, bypopularity, favorite); for a specific season's " +
        "lineup use get_seasonal_anime or get_upcoming_season instead. If Jikan is unavailable " +
        "and MAL_CLIENT_ID is set, transparently retries via the official API — `type`/`filter` " +
        "are merged into one best-effort ranking, and `themes`/`demographics`/`broadcast` come back empty.",
      inputSchema: z
        .object({
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
        })
        .strict(),
      outputSchema: listPageSchema(animeSummarySchema),
      annotations: READ_ONLY,
    },
    (args) => reply(() => jikan.getTopAnime(args)),
  );

  server.registerTool(
    "get_top_manga",
    {
      title: "Get top manga",
      description:
        "Get manga ranked by all-time score/popularity, not tied to any release window. Use " +
        "`filter` for special rankings (publishing, upcoming, bypopularity, favorite). If Jikan is unavailable and " +
        "MAL_CLIENT_ID is set, transparently retries via the official API — `type`/`filter` are " +
        "merged into one best-effort ranking, and `themes`/`demographics` come back empty.",
      inputSchema: z
        .object({
          type: mangaType.optional(),
          filter: z
            .enum(["publishing", "upcoming", "bypopularity", "favorite"])
            .describe("Special ranking filter.")
            .optional(),
          limit: limit.optional(),
          page: page.optional(),
        })
        .strict(),
      outputSchema: listPageSchema(mangaSummarySchema),
      annotations: READ_ONLY,
    },
    (args) => reply(() => jikan.getTopManga(args)),
  );

  server.registerTool(
    "get_seasonal_anime",
    {
      title: "Get seasonal anime",
      description:
        "List anime from a given season — supply both `year` and `season` together, or omit both " +
        "for the current season; supplying only one is treated as omitting both. For next " +
        "season's lineup use get_upcoming_season instead. If Jikan is " +
        "unavailable and MAL_CLIENT_ID is set, transparently retries via the official API — " +
        "`themes`/`demographics`/`broadcast` come back empty, and an explicit `sfw: true` is enforced " +
        "client-side (a filtered page can come back shorter than `limit`).",
      inputSchema: z
        .object({
          year: z
            .number()
            .int()
            .min(1900)
            .max(2100)
            .describe("Four-digit year, e.g. 2024.")
            .optional(),
          season: z
            .enum(["winter", "spring", "summer", "fall"])
            .describe("Season name.")
            .optional(),
          sfw: sfw.optional(),
          limit: limit.optional(),
          page: page.optional(),
        })
        .strict(),
      outputSchema: listPageSchema(animeSummarySchema),
      annotations: READ_ONLY,
    },
    (args) => reply(() => jikan.getSeason(args)),
  );

  server.registerTool(
    "get_anime_schedule",
    {
      title: "Get broadcast schedule",
      description:
        "Get the anime broadcast schedule (air times in JST), optionally for a single weekday. " +
        "`broadcast` is only present for currently-airing shows. Defaults to 25 results if " +
        "`limit` is omitted.",
      inputSchema: z
        .object({
          day: z
            .enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"])
            .describe("Weekday to filter by. Omit for the whole week.")
            .optional(),
          limit: limit.default(25),
        })
        .strict(),
      outputSchema: listPageSchema(animeSummarySchema),
      annotations: READ_ONLY,
    },
    ({ day, limit: lim }) => reply(() => jikan.getSchedule(day, lim)),
  );

  server.registerTool(
    "get_user_profile",
    {
      title: "Get user profile",
      description:
        "Get a public MyAnimeList user's profile and watch/read statistics by username — works " +
        "for any username, including your own, with no login needed. Use get_my_user_info " +
        "instead when you're already logged in via login_mal and want the authenticated " +
        "user's data specifically (though that tool only covers anime stats, not manga).",
      inputSchema: z
        .object({ username: z.string().trim().min(1).describe("MyAnimeList username.") })
        .strict(),
      outputSchema: userSchema,
      annotations: READ_ONLY,
    },
    ({ username }) => reply(() => jikan.getUserProfile(username)),
  );

  server.registerTool(
    "get_user_favorites",
    {
      title: "Get user favorites",
      description:
        "Get a public MyAnimeList user's favorite anime, manga, characters and people by username.",
      inputSchema: z
        .object({ username: z.string().trim().min(1).describe("MyAnimeList username.") })
        .strict(),
      outputSchema: favoritesSchema,
      annotations: READ_ONLY,
    },
    ({ username }) => reply(() => jikan.getUserFavorites(username)),
  );

  server.registerTool(
    "get_anime_genres",
    {
      title: "Get anime genres",
      description:
        "List anime genres/themes/demographics with their Jikan IDs. Use this to discover the " +
        "numeric IDs that the `genres` parameter of search_anime expects.",
      inputSchema: z.object({ filter: genreFilter.optional() }).strict(),
      outputSchema: genresSchema,
      annotations: READ_ONLY,
    },
    ({ filter }) => reply(() => jikan.getAnimeGenres(filter)),
  );

  server.registerTool(
    "get_manga_genres",
    {
      title: "Get manga genres",
      description:
        "List manga genres/themes/demographics with their Jikan IDs. Use this to discover the " +
        "numeric IDs that the `genres` parameter of search_manga expects.",
      inputSchema: z.object({ filter: genreFilter.optional() }).strict(),
      outputSchema: genresSchema,
      annotations: READ_ONLY,
    },
    ({ filter }) => reply(() => jikan.getMangaGenres(filter)),
  );

  // ---- characters & people (Tier 1) ----------------------------------------

  server.registerTool(
    "search_characters",
    {
      title: "Search characters",
      description:
        "Search MyAnimeList characters by name. Returns compact summaries and the mal_id needed " +
        "by get_character. Use get_anime_characters instead if you already have an anime's " +
        "mal_id and want its full cast.",
      inputSchema: z
        .object({
          q: z.string().trim().min(1).describe("Character name."),
          order_by: z
            .enum(["mal_id", "name", "favorites"])
            .describe("Field to order by.")
            .optional(),
          sort: sortDir.optional(),
          limit: limit.optional(),
          page: page.optional(),
        })
        .strict(),
      outputSchema: listPageSchema(characterEntitySchema),
      annotations: READ_ONLY,
    },
    (args) => reply(() => jikan.searchCharacters(args)),
  );

  server.registerTool(
    "get_character",
    {
      title: "Get character details",
      description:
        "Get full details for one character by mal_id: bio, the anime/manga they appear in, and " +
        "their voice actors. Obtain the mal_id from search_characters or get_anime_characters.",
      inputSchema: z.object({ id: malId }).strict(),
      outputSchema: characterEntitySchema,
      annotations: READ_ONLY,
    },
    ({ id }) => reply(() => jikan.getCharacter(id)),
  );

  server.registerTool(
    "search_people",
    {
      title: "Search people",
      description:
        "Search MyAnimeList people (voice actors, directors, authors) by name. Returns the mal_id " +
        "needed by get_person.",
      inputSchema: z
        .object({
          q: z.string().trim().min(1).describe("Person name."),
          order_by: z
            .enum(["mal_id", "name", "birthday", "favorites"])
            .describe("Field to order by.")
            .optional(),
          sort: sortDir.optional(),
          limit: limit.optional(),
          page: page.optional(),
        })
        .strict(),
      outputSchema: listPageSchema(personEntitySchema),
      annotations: READ_ONLY,
    },
    (args) => reply(() => jikan.searchPeople(args)),
  );

  server.registerTool(
    "get_person",
    {
      title: "Get person details",
      description:
        "Get full details for one person by mal_id: bio, their anime/manga staff positions and " +
        "voiced roles (capped to the first 50 for prolific people, in whatever order the " +
        "upstream API returns them — not necessarily their most notable roles). Obtain the " +
        "mal_id from search_people, or from get_character's voice_actors (which include each " +
        "actor's mal_id — get_anime_characters' voice_actors are names only, with no id).",
      inputSchema: z.object({ id: malId }).strict(),
      outputSchema: personEntitySchema,
      annotations: READ_ONLY,
    },
    ({ id }) => reply(() => jikan.getPerson(id)),
  );

  server.registerTool(
    "get_anime_staff",
    {
      title: "Get anime staff",
      description:
        "List the production staff of an anime (by mal_id) — director, composer, etc. — with their " +
        "roles. Complements get_anime_characters (which covers voice actors). " +
        "Get the mal_id from search_anime.",
      inputSchema: z.object({ id: malId }).strict(),
      outputSchema: staffSchema,
      annotations: READ_ONLY,
    },
    ({ id }) => reply(() => jikan.getAnimeStaff(id)),
  );

  // ---- discovery & statistics (Tier 2) -------------------------------------

  server.registerTool(
    "get_random_anime",
    {
      title: "Get a random anime",
      description: "Return one random anime (full details). Good for discovery / suggestions.",
      inputSchema: z.object({}).strict(),
      outputSchema: animeDetailSchema,
      annotations: READ_ONLY,
    },
    () => reply(() => jikan.getRandomAnime()),
  );

  server.registerTool(
    "get_random_manga",
    {
      title: "Get a random manga",
      description: "Return one random manga (full details). Good for discovery / suggestions.",
      inputSchema: z.object({}).strict(),
      outputSchema: mangaDetailSchema,
      annotations: READ_ONLY,
    },
    () => reply(() => jikan.getRandomManga()),
  );

  server.registerTool(
    "get_upcoming_season",
    {
      title: "Get upcoming season anime",
      description:
        "List anime scheduled for the upcoming season. Use get_seasonal_anime for the current or a " +
        "specific past season. If Jikan is unavailable and MAL_CLIENT_ID is set, transparently " +
        "retries via the official API — `themes`/`demographics`/`broadcast` come back empty, and an explicit " +
        "`sfw: true` is enforced client-side (a filtered page can come back shorter than `limit`).",
      inputSchema: z
        .object({ sfw: sfw.optional(), limit: limit.optional(), page: page.optional() })
        .strict(),
      outputSchema: listPageSchema(animeSummarySchema),
      annotations: READ_ONLY,
    },
    (args) => reply(() => jikan.getUpcomingSeason(args)),
  );

  server.registerTool(
    "get_anime_statistics",
    {
      title: "Get anime statistics",
      description:
        "Get watch-status counts (watching/completed/…) and the score distribution for an anime by mal_id. " +
        "Get the mal_id from search_anime. If Jikan is unavailable and MAL_CLIENT_ID is set, " +
        "transparently retries via the official API, which omits the score distribution " +
        "(`scores`) entirely — no equivalent field there.",
      inputSchema: z.object({ id: malId }).strict(),
      outputSchema: statisticsSchema,
      annotations: READ_ONLY,
    },
    ({ id }) => reply(() => jikan.getAnimeStatistics(id)),
  );

  server.registerTool(
    "get_manga_statistics",
    {
      title: "Get manga statistics",
      description:
        "Get read-status counts (reading/completed/…) and the score distribution for a manga by mal_id. " +
        "Get the mal_id from search_manga. Unlike get_anime_statistics, no official-API fallback " +
        "exists for this tool — it always needs Jikan itself to be reachable.",
      inputSchema: z.object({ id: malId }).strict(),
      outputSchema: statisticsSchema,
      annotations: READ_ONLY,
    },
    ({ id }) => reply(() => jikan.getMangaStatistics(id)),
  );

  // ---- broader surface (Tier 3) --------------------------------------------

  server.registerTool(
    "get_producers",
    {
      title: "Get producers/studios",
      description:
        "List or search anime producers and studios with their Jikan IDs and counts. Use `q` to search by name.",
      inputSchema: z
        .object({
          q: z.string().describe("Filter by name.").optional(),
          order_by: z
            .enum(["mal_id", "count", "favorites", "established"])
            .describe("Field to order by.")
            .optional(),
          sort: sortDir.optional(),
          limit: limit.optional(),
          page: page.optional(),
        })
        .strict(),
      outputSchema: listPageSchema(producerSchema),
      annotations: READ_ONLY,
    },
    (args) => reply(() => jikan.getProducers(args)),
  );

  server.registerTool(
    "get_top_people",
    {
      title: "Get top people",
      description:
        "Get the most popular/favorited people (voice actors, staff, authors), ranked overall. " +
        "Use search_people instead to look up a specific person by name.",
      inputSchema: z.object({ limit: limit.optional(), page: page.optional() }).strict(),
      outputSchema: listPageSchema(personEntitySchema),
      annotations: READ_ONLY,
    },
    (args) => reply(() => jikan.getTopPeople(args)),
  );

  server.registerTool(
    "get_top_characters",
    {
      title: "Get top characters",
      description:
        "Get the most popular/favorited characters, ranked overall. Use search_characters instead " +
        "to look up a specific character by name.",
      inputSchema: z.object({ limit: limit.optional(), page: page.optional() }).strict(),
      outputSchema: listPageSchema(characterEntitySchema),
      annotations: READ_ONLY,
    },
    (args) => reply(() => jikan.getTopCharacters(args)),
  );

  // ---- curated extras ------------------------------------------------------

  server.registerTool(
    "get_seasons_list",
    {
      title: "List available seasons",
      description:
        "List the years and seasons that have anime data, so you can pick valid arguments for " +
        "get_seasonal_anime.",
      inputSchema: z.object({}).strict(),
      outputSchema: seasonsListSchema,
      annotations: READ_ONLY,
    },
    () => reply(() => jikan.getSeasonsList()),
  );

  server.registerTool(
    "get_random_character",
    {
      title: "Get a random character",
      description: "Return one random character (full details). Good for discovery / trivia.",
      inputSchema: z.object({}).strict(),
      outputSchema: characterEntitySchema,
      annotations: READ_ONLY,
    },
    () => reply(() => jikan.getRandomCharacter()),
  );

  server.registerTool(
    "get_random_person",
    {
      title: "Get a random person",
      description:
        "Return one random person — voice actor, director, author (full details). Good for " +
        "discovery / trivia.",
      inputSchema: z.object({}).strict(),
      outputSchema: personEntitySchema,
      annotations: READ_ONLY,
    },
    () => reply(() => jikan.getRandomPerson()),
  );

  server.registerTool(
    "get_anime_news",
    {
      title: "Get anime news",
      description:
        "List recent news articles about an anime (by mal_id): headline, date, author and excerpt. " +
        "Useful for 'what's new / any announcements' questions. Get the mal_id from search_anime.",
      inputSchema: z.object({ id: malId, page: page.optional() }).strict(),
      outputSchema: listPageSchema(newsItemSchema),
      annotations: READ_ONLY,
    },
    ({ id, page: pg }) => reply(() => jikan.getAnimeNews(id, pg)),
  );
}
