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
  CharacterOrderBy,
  PersonOrderBy,
  ProducerOrderBy,
  MagazineOrderBy,
} from "./tenraiEnums.js";

// Shared by every "search by name" style endpoint — pagination, sort direction, and the
// alphabetical `letter` browse are identical everywhere. `order_by` is deliberately NOT here:
// each of characters/people/producers/magazines (and, below, anime/manga) has its own,
// genuinely different order_by enum, so merging them into one union would let e.g.
// searchCharacters type-accept "established" (a producer-only value) — the same over-wide-union
// mistake AnimeMangaOrderBy was before it got split into AnimeOrderBy/MangaOrderBy.
interface SearchParamsBase {
  q?: string;
  sort?: SortDir;
  limit?: number;
  page?: number;
  letter?: string;
}

export interface CharacterSearchParams extends SearchParamsBase {
  order_by?: CharacterOrderBy;
}

export interface PersonSearchParams extends SearchParamsBase {
  order_by?: PersonOrderBy;
}

export interface ProducerSearchParams extends SearchParamsBase {
  order_by?: ProducerOrderBy;
}

export interface MagazineSearchParams extends SearchParamsBase {
  order_by?: MagazineOrderBy;
}

// searchAnime/searchManga's much larger filter set — kept separate from the name-search
// interfaces above for the same reason: order_by differs (and is larger) here too.
// Fields identical between anime and manga (score range, genres, dates, sfw, ...) live in this
// unexported base; everything that actually differs — `type`, `status`, `order_by`, `rating`
// (anime-only), `producers` vs. `magazines` — is declared on the two exported interfaces below.
interface AnimeMangaSearchParamsBase extends SearchParamsBase {
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
