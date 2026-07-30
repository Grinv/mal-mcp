// Tenrai's real enums (its own OpenAPI spec) — the single source of truth for every enum-shaped
// query param this server exposes. Each is a runtime `as const` array (not just a TS type): the
// zod schemas in tools/read.ts build their `z.enum(...)` directly from these same arrays instead
// of re-typing the values, so the two layers cannot drift apart. tenraiParams.ts and
// TenraiClient's own method signatures derive their TS types from these same arrays via
// `(typeof X)[number]`, for the same reason — TenraiClient is called directly by tests
// (contract.test.ts), not just through the zod-validated tool layer, so its own params
// shouldn't be bare `string` either.
export const ANIME_MEDIA_TYPES = [
  "tv",
  "movie",
  "ova",
  "special",
  "ona",
  "music",
  "cm",
  "pv",
  "tv_special",
] as const;
export const MANGA_MEDIA_TYPES = [
  "manga",
  "novel",
  "lightnovel",
  "oneshot",
  "doujin",
  "manhwa",
  "manhua",
] as const;
export const CONTENT_RATINGS = ["g", "pg", "pg13", "r17", "r", "rx"] as const;
export const ANIME_STATUSES = ["airing", "complete", "upcoming"] as const;
export const MANGA_STATUSES = [
  "publishing",
  "complete",
  "hiatus",
  "discontinued",
  "upcoming",
] as const;
export const SORT_DIRS = ["asc", "desc"] as const;
export const ANIME_ORDER_BY = [
  "mal_id",
  "title",
  "start_date",
  "end_date",
  "episodes",
  "score",
  "scored_by",
  "rank",
  "popularity",
  "members",
  "favorites",
] as const;
export const MANGA_ORDER_BY = [
  "mal_id",
  "title",
  "start_date",
  "end_date",
  "chapters",
  "volumes",
  "score",
  "scored_by",
  "rank",
  "popularity",
  "members",
  "favorites",
] as const;
export const ANIME_TOP_FILTERS = ["airing", "upcoming", "bypopularity", "favorite"] as const;
export const MANGA_TOP_FILTERS = ["publishing", "upcoming", "bypopularity", "favorite"] as const;
export const SEASON_NAMES = ["winter", "spring", "summer", "fall"] as const;
export const SEASON_ORDER_BY = ["score", "members", "start_date"] as const;
export const SCHEDULE_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "unknown",
  "other",
] as const;
export const REVIEW_SORTS = ["newest", "oldest", "most_helpful"] as const;
export const REVIEW_TRI_STATES = ["true", "false", "only"] as const;
export const REVIEW_SENTIMENTS = ["recommended", "mixed_feelings", "not_recommended"] as const;
export const CHARACTER_ORDER_BY = ["mal_id", "name", "favorites"] as const;
export const PERSON_ORDER_BY = ["mal_id", "name", "birthday", "favorites"] as const;
export const PRODUCER_ORDER_BY = ["mal_id", "count", "favorites", "established"] as const;
export const MAGAZINE_ORDER_BY = ["mal_id", "name", "count"] as const;
export const GENRE_FILTERS = ["genres", "explicit_genres", "themes", "demographics"] as const;

export type AnimeMediaType = (typeof ANIME_MEDIA_TYPES)[number];
export type MangaMediaType = (typeof MANGA_MEDIA_TYPES)[number];
export type ContentRating = (typeof CONTENT_RATINGS)[number];
export type AnimeStatus = (typeof ANIME_STATUSES)[number];
export type MangaStatus = (typeof MANGA_STATUSES)[number];
export type SortDir = (typeof SORT_DIRS)[number];
export type AnimeOrderBy = (typeof ANIME_ORDER_BY)[number];
export type MangaOrderBy = (typeof MANGA_ORDER_BY)[number];
export type AnimeTopFilter = (typeof ANIME_TOP_FILTERS)[number];
export type MangaTopFilter = (typeof MANGA_TOP_FILTERS)[number];
export type SeasonName = (typeof SEASON_NAMES)[number];
export type SeasonOrderBy = (typeof SEASON_ORDER_BY)[number];
export type ScheduleDay = (typeof SCHEDULE_DAYS)[number];
export type ReviewSort = (typeof REVIEW_SORTS)[number];
export type ReviewTriState = (typeof REVIEW_TRI_STATES)[number];
export type ReviewSentiment = (typeof REVIEW_SENTIMENTS)[number];
// search_characters/search_people/get_producers/get_magazines each get their own order_by type —
// deliberately NOT unioned into one shared type, since each endpoint's real enum differs (e.g.
// only producers has "established") and a merged union would let any of the four tools
// type-accept a value only valid for one of the others.
export type CharacterOrderBy = (typeof CHARACTER_ORDER_BY)[number];
export type PersonOrderBy = (typeof PERSON_ORDER_BY)[number];
export type ProducerOrderBy = (typeof PRODUCER_ORDER_BY)[number];
export type MagazineOrderBy = (typeof MAGAZINE_ORDER_BY)[number];
export type GenreFilter = (typeof GENRE_FILTERS)[number];
