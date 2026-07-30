// The official MyAnimeList API's real enums for personal-list fields — the single source of
// truth for both MalClient's own param/update interfaces and tools/mylist.ts's z.enum(...)
// calls, mirroring the same pattern (and the same reasoning) as clients/tenraiEnums.ts.
export const ANIME_LIST_STATUSES = [
  "watching",
  "completed",
  "on_hold",
  "dropped",
  "plan_to_watch",
] as const;
export const MANGA_LIST_STATUSES = [
  "reading",
  "completed",
  "on_hold",
  "dropped",
  "plan_to_read",
] as const;
export const ANIME_LIST_SORT = [
  "list_score",
  "list_updated_at",
  "anime_title",
  "anime_start_date",
] as const;
export const MANGA_LIST_SORT = [
  "list_score",
  "list_updated_at",
  "manga_title",
  "manga_start_date",
] as const;

export type AnimeListStatus = (typeof ANIME_LIST_STATUSES)[number];
export type MangaListStatus = (typeof MANGA_LIST_STATUSES)[number];
export type AnimeListSort = (typeof ANIME_LIST_SORT)[number];
export type MangaListSort = (typeof MANGA_LIST_SORT)[number];
