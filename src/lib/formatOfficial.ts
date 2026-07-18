// Shapes the official MAL API's search/ranking/season responses into the same
// agent-facing keys as format.ts's summarizeAnime/summarizeManga (non-detailed
// output). Used only by clients/officialReads.ts, the fallback for when Jikan's
// live pass-through to MAL is degraded (see notes/jikan-reliability.md) — the
// official API uses entirely different field names/shapes than Jikan, so this
// keeps search_anime/search_manga/get_top_anime/get_top_manga/get_seasonal_anime/
// get_upcoming_season returning a consistent shape regardless of which upstream
// actually answered.
import {
  names,
  score,
  trimSynopsis,
  projectAnimeSummary,
  projectMangaSummary,
  type AnimeSummaryFields,
  type MangaSummaryFields,
} from "./format.js";

const OFFICIAL_ANIME_STATUS: Record<string, string> = {
  currently_airing: "Currently Airing",
  finished_airing: "Finished Airing",
  not_yet_aired: "Not yet aired",
};
const OFFICIAL_MANGA_STATUS: Record<string, string> = {
  currently_publishing: "Publishing",
  finished: "Finished",
  not_yet_published: "Not yet published",
  on_hiatus: "On Hiatus",
  discontinued: "Discontinued",
};

interface OfficialPicture {
  medium?: string;
  large?: string;
}
interface OfficialGenre {
  name?: string;
}

function officialImageUrl(p: OfficialPicture | undefined): string | undefined {
  return p?.large ?? p?.medium;
}

export interface OfficialAnimeNode {
  id: number;
  title?: string;
  alternative_titles?: { en?: string | null };
  main_picture?: OfficialPicture;
  start_date?: string | null;
  start_season?: { year?: number; season?: string };
  synopsis?: string | null;
  mean?: number | null;
  rank?: number | null;
  popularity?: number | null;
  num_list_users?: number | null;
  media_type?: string | null;
  status?: string | null;
  genres?: OfficialGenre[];
  num_episodes?: number | null;
  rating?: string | null;
  studios?: OfficialGenre[];
  // Not surfaced in the summarized output — used by officialReads.ts's #list to honor an
  // explicit `sfw: true` client-side (the official API has no server-side nsfw filter).
  nsfw?: string | null;
}

export function summarizeOfficialAnime(n: OfficialAnimeNode): Record<string, unknown> {
  const fields: AnimeSummaryFields = {
    mal_id: n.id,
    title: n.title,
    title_english: n.alternative_titles?.en ?? undefined,
    type: n.media_type ?? undefined,
    episodes: n.num_episodes || undefined,
    status: (n.status && OFFICIAL_ANIME_STATUS[n.status]) ?? n.status ?? undefined,
    airing: n.status === "currently_airing",
    score: score(n.mean),
    rank: n.rank ?? undefined,
    popularity: n.popularity ?? undefined,
    members: n.num_list_users ?? undefined,
    year: n.start_season?.year ?? undefined,
    season: n.start_season?.season ?? undefined,
    rating: n.rating ?? undefined,
    aired: n.start_date ?? undefined,
    genres: names(n.genres),
    // The official API doesn't split themes/demographics out of genres like Jikan does.
    themes: [],
    demographics: [],
    studios: names(n.studios),
    synopsis: trimSynopsis(n.synopsis, false),
    url: `https://myanimelist.net/anime/${n.id}`,
    image_url: officialImageUrl(n.main_picture),
  };
  return projectAnimeSummary(fields);
}

export interface OfficialMangaNode {
  id: number;
  title?: string;
  alternative_titles?: { en?: string | null };
  main_picture?: OfficialPicture;
  start_date?: string | null;
  synopsis?: string | null;
  mean?: number | null;
  rank?: number | null;
  popularity?: number | null;
  num_list_users?: number | null;
  media_type?: string | null;
  status?: string | null;
  genres?: OfficialGenre[];
  num_chapters?: number | null;
  num_volumes?: number | null;
  authors?: { node?: { first_name?: string; last_name?: string } }[];
  // Not surfaced in the summarized output — used by officialReads.ts's #list to honor an
  // explicit `sfw: true` client-side (the official API has no server-side nsfw filter).
  nsfw?: string | null;
}

export function summarizeOfficialManga(n: OfficialMangaNode): Record<string, unknown> {
  const fields: MangaSummaryFields = {
    mal_id: n.id,
    title: n.title,
    title_english: n.alternative_titles?.en ?? undefined,
    type: n.media_type ?? undefined,
    chapters: n.num_chapters || undefined,
    volumes: n.num_volumes || undefined,
    status: (n.status && OFFICIAL_MANGA_STATUS[n.status]) ?? n.status ?? undefined,
    score: score(n.mean),
    rank: n.rank ?? undefined,
    popularity: n.popularity ?? undefined,
    members: n.num_list_users ?? undefined,
    published: n.start_date ?? undefined,
    genres: names(n.genres),
    themes: [],
    demographics: [],
    authors: (n.authors ?? [])
      .map((a) => [a.node?.first_name, a.node?.last_name].filter(Boolean).join(" "))
      .filter((name) => name.length > 0),
    synopsis: trimSynopsis(n.synopsis, false),
    url: `https://myanimelist.net/manga/${n.id}`,
    image_url: officialImageUrl(n.main_picture),
  };
  return projectMangaSummary(fields);
}
