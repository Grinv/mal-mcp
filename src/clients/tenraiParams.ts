// Parameter interfaces for every TenraiClient method (tenrai.ts). Split out from the client
// itself: these are pure data shapes with no HTTP/caching logic, and this file was the bulk of
// what made tenrai.ts hard to scan. Every enum-shaped field's TS type comes from tenraiEnums.ts's
// `as const` arrays — see that file's header comment for why.
import type {
  AnimeMediaType,
  MangaMediaType,
  ContentRating,
  AnimeStatus,
  MangaStatus,
  SortDir,
  AnimeOrderBy,
  MangaOrderBy,
  AnimeTopFilter,
  MangaTopFilter,
  SeasonName,
  SeasonOrderBy,
  ScheduleDay,
  ReviewSort,
  ReviewTriState,
  ReviewSentiment,
  NameOrderBy,
} from "./tenraiEnums.js";

// Shared by the plain-name-search endpoints (characters/people/producers) — no content
// filtering, just find-by-name plus ordering/pagination/alphabetical browse.
export interface SearchParams {
  q?: string;
  order_by?: NameOrderBy;
  sort?: SortDir;
  limit?: number;
  page?: number;
  letter?: string;
}

// searchAnime/searchManga's much larger filter set — kept separate from SearchParams so a
// plain-name search interface doesn't carry a dozen anime/manga-only fields it never uses.
// (Omits SearchParams's own `order_by` rather than extending it — anime/manga order_by is a
// different, larger enum than the plain-name-search one.)
// Fields identical between the two (score range, genres, dates, sfw, ...) live in this
// unexported base; everything that actually differs between anime and manga — `type`,
// `status`, `order_by`, `rating` (anime-only), `producers` vs. `magazines` — is declared on
// the two exported interfaces below instead of merged into one over-wide union/optional pair.
interface AnimeMangaSearchParamsBase extends Omit<SearchParams, "order_by"> {
  genres?: string;
  genres_exclude?: string;
  sfw?: boolean;
  sfw_strict?: boolean;
  score?: number;
  min_score?: number;
  max_score?: number;
  start_date?: string;
  end_date?: string;
  unapproved?: boolean;
}

export interface AnimeSearchParams extends AnimeMangaSearchParamsBase {
  type?: AnimeMediaType[];
  status?: AnimeStatus;
  order_by?: AnimeOrderBy;
  rating?: ContentRating[];
  producers?: string;
}

export interface MangaSearchParams extends AnimeMangaSearchParamsBase {
  type?: MangaMediaType[];
  status?: MangaStatus;
  order_by?: MangaOrderBy;
  magazines?: string;
}

interface TopParamsBase {
  sfw?: boolean;
  sfw_strict?: boolean;
  limit?: number;
  page?: number;
}

export interface AnimeTopParams extends TopParamsBase {
  type?: AnimeMediaType[];
  filter?: AnimeTopFilter;
  rating?: ContentRating[];
}

export interface MangaTopParams extends TopParamsBase {
  type?: MangaMediaType[];
  filter?: MangaTopFilter;
}

export interface SeasonParams {
  year?: number;
  season?: SeasonName;
  limit?: number;
  page?: number;
  sfw?: boolean;
  sfw_strict?: boolean;
  filter?: AnimeMediaType[];
  rating?: ContentRating[];
  unapproved?: boolean;
  continuing?: boolean;
  kids?: boolean;
  order_by?: SeasonOrderBy;
  sort?: SortDir;
}

export interface ScheduleParams {
  day?: ScheduleDay;
  limit: number;
  sfw?: boolean;
  sfw_strict?: boolean;
  kids?: boolean;
  unapproved?: boolean;
  page?: number;
}

export interface ReviewParams {
  page?: number;
  sort?: ReviewSort;
  preliminary?: ReviewTriState;
  spoilers?: ReviewTriState;
  sentiment?: ReviewSentiment;
}
