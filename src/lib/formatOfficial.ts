// Shapes the official MAL API's search/ranking/season responses into the same
// agent-facing keys as format.ts's summarizeAnime/summarizeManga (non-detailed
// output). Used only by clients/officialReads.ts, the fallback for when Jikan's
// live pass-through to MAL is degraded (see notes/jikan-reliability.md) — the
// official API uses entirely different field names/shapes than Jikan, so this
// keeps search_anime/search_manga/get_top_anime/get_top_manga/get_seasonal_anime/
// get_upcoming_season returning a consistent shape regardless of which upstream
// actually answered.
import type { z } from "zod";
import {
  names,
  score,
  trimSynopsis,
  clean,
  projectAnimeSummary,
  projectMangaSummary,
  type AnimeSummaryFields,
  type MangaSummaryFields,
} from "./format.js";
import {
  animeDetailSchema,
  mangaDetailSchema,
  recommendationsSchema,
  statisticsSchema,
} from "./format.schemas.js";

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

// MAL's `source` enum (snake_case) mapped to Jikan's own display text, so get_anime's fallback
// reads the same regardless of which upstream answered. Falls back to the raw value for any
// enum member not covered here rather than dropping the field.
const OFFICIAL_SOURCE_LABELS: Record<string, string> = {
  other: "Other",
  original: "Original",
  manga: "Manga",
  "4_koma_manga": "4-koma manga",
  web_manga: "Web manga",
  digital_manga: "Digital manga",
  novel: "Novel",
  light_novel: "Light novel",
  visual_novel: "Visual novel",
  game: "Game",
  card_game: "Card game",
  book: "Book",
  picture_book: "Picture book",
  radio: "Radio",
  music: "Music",
  web_novel: "Web novel",
  mixed_media: "Mixed media",
  doujinshi: "Doujinshi",
};

function officialSource(s: string | null | undefined): string | undefined {
  if (!s) return undefined;
  return OFFICIAL_SOURCE_LABELS[s] ?? s;
}

// The official API gives episode duration in seconds; Jikan's own `duration` field is already
// a human string ("24 min per ep", "1 hr 30 min per ep") — mirror that format here.
function formatDuration(seconds: number | null | undefined): string | undefined {
  if (!seconds) return undefined;
  const totalMin = Math.round(seconds / 60);
  const hr = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (hr === 0) return `${totalMin} min per ep`;
  return min === 0 ? `${hr} hr per ep` : `${hr} hr ${min} min per ep`;
}

interface OfficialBroadcast {
  day_of_the_week?: string;
  start_time?: string;
}

// MAL broadcast times are always JST — matches Jikan's own `broadcast.string` convention
// (e.g. "Fridays at 23:00 (JST)"), so the fallback reads the same as the primary source.
function formatBroadcast(b: OfficialBroadcast | undefined): string | undefined {
  if (!b?.day_of_the_week || !b?.start_time) return undefined;
  const day = b.day_of_the_week.charAt(0).toUpperCase() + b.day_of_the_week.slice(1);
  return `${day}s at ${b.start_time} (JST)`;
}

interface OfficialRelationEdge {
  node?: { title?: string };
  relation_type_formatted?: string;
}

// The official API returns related_anime/related_manga as flat per-title edges; Jikan groups
// them by relation type instead. Merge both lists (an anime can relate to manga and vice versa)
// into the same {relation, entries} shape Jikan uses, so get_anime/get_manga's `relations` field
// looks identical regardless of which upstream answered.
function groupRelations(
  ...edgeLists: (OfficialRelationEdge[] | undefined)[]
): { relation: string; entries: string[] }[] {
  const byRelation = new Map<string, string[]>();
  for (const edges of edgeLists) {
    for (const e of edges ?? []) {
      if (!e.relation_type_formatted || !e.node?.title) continue;
      const list = byRelation.get(e.relation_type_formatted) ?? [];
      list.push(e.node.title);
      byRelation.set(e.relation_type_formatted, list);
    }
  }
  return [...byRelation.entries()].map(([relation, entries]) => ({ relation, entries }));
}

export interface OfficialAnimeNode {
  id: number;
  title?: string;
  // Bare `alternative_titles` (no nested-field syntax) already returns en/ja/synonyms —
  // verified live, see docs/api-references.md.
  alternative_titles?: { en?: string | null; ja?: string | null };
  main_picture?: OfficialPicture;
  start_date?: string | null;
  start_season?: { year?: number; season?: string };
  synopsis?: string | null;
  mean?: number | null;
  rank?: number | null;
  popularity?: number | null;
  num_list_users?: number | null;
  num_scoring_users?: number | null;
  media_type?: string | null;
  status?: string | null;
  genres?: OfficialGenre[];
  num_episodes?: number | null;
  rating?: string | null;
  studios?: OfficialGenre[];
  source?: string | null;
  average_episode_duration?: number | null;
  background?: string | null;
  broadcast?: OfficialBroadcast;
  related_anime?: OfficialRelationEdge[];
  related_manga?: OfficialRelationEdge[];
  // Not surfaced in the summarized output — used by officialReads.ts's #list to honor an
  // explicit `sfw: true` client-side (the official API has no server-side nsfw filter).
  nsfw?: string | null;
}

export function summarizeOfficialAnime(
  n: OfficialAnimeNode,
): ReturnType<typeof projectAnimeSummary> {
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

// Detail-mode fallback for get_anime: the official API covers most of Jikan's `detailed: true`
// extras (title_japanese, source, duration, broadcast, background, relations, scored_by), but
// producers/licensors/streaming/opening+ending themes/trailer/favorites have no official-API
// equivalent at all and are simply absent during a fallback — a degraded-mode trade-off, same
// spirit as the search/season fallback's dropped filters.
export function summarizeOfficialAnimeDetailed(
  n: OfficialAnimeNode,
): z.infer<typeof animeDetailSchema> {
  const base = summarizeOfficialAnime(n);
  return animeDetailSchema.parse(
    clean({
      ...base,
      synopsis: trimSynopsis(n.synopsis, true),
      title_japanese: n.alternative_titles?.ja ?? undefined,
      source: officialSource(n.source),
      duration: formatDuration(n.average_episode_duration),
      broadcast: formatBroadcast(n.broadcast),
      scored_by: n.num_scoring_users ?? undefined,
      background: n.background ?? undefined,
      relations: groupRelations(n.related_anime, n.related_manga),
    }),
  );
}

export interface OfficialMangaNode {
  id: number;
  title?: string;
  alternative_titles?: { en?: string | null; ja?: string | null };
  main_picture?: OfficialPicture;
  start_date?: string | null;
  synopsis?: string | null;
  mean?: number | null;
  rank?: number | null;
  popularity?: number | null;
  num_list_users?: number | null;
  num_scoring_users?: number | null;
  media_type?: string | null;
  status?: string | null;
  genres?: OfficialGenre[];
  num_chapters?: number | null;
  num_volumes?: number | null;
  authors?: { node?: { first_name?: string; last_name?: string } }[];
  background?: string | null;
  related_anime?: OfficialRelationEdge[];
  related_manga?: OfficialRelationEdge[];
  serialization?: { node?: { name?: string } }[];
  // Not surfaced in the summarized output — used by officialReads.ts's #list to honor an
  // explicit `sfw: true` client-side (the official API has no server-side nsfw filter).
  nsfw?: string | null;
}

// The official API's recommendations field is a summary edge (node + a raw vote count), not the
// richer entry Jikan returns — shaped here into the same {mal_id,title,votes,url} keys as
// format.ts's summarizeRecommendations so get_anime_recommendations/get_manga_recommendations
// return a consistent shape regardless of which upstream answered.
export interface OfficialRecommendationEdge {
  node?: { id: number; title?: string };
  num_recommendations?: number;
}

export function summarizeOfficialRecommendations(
  kind: "anime" | "manga",
  edges: OfficialRecommendationEdge[],
): z.infer<typeof recommendationsSchema> {
  return recommendationsSchema.parse({
    recommendations: edges.slice(0, 25).map((e) => ({
      mal_id: e.node?.id,
      title: e.node?.title,
      votes: e.num_recommendations,
      url: e.node?.id ? `https://myanimelist.net/${kind}/${e.node.id}` : undefined,
    })),
  });
}

// Anime-only: MangaForDetails has no `statistics` property at all (verified against the schema
// at myanimelist.net/apiconfig/references/api/v2) — get_manga_statistics stays fully Jikan-only.
export interface OfficialAnimeStatistics {
  num_list_users?: number;
  // The official API sends these as numeric strings (e.g. "190892"), unlike
  // num_list_users which is a real number — verified live against
  // /v2/anime/{id}?fields=statistics. Coerced to number below.
  status?: {
    watching?: string;
    completed?: string;
    on_hold?: string;
    dropped?: string;
    plan_to_watch?: string;
  };
}

// Covers Jikan's watch-status counts, but the official API has no score-distribution histogram
// at all — `scores` is simply absent during this fallback, not approximated.
export function summarizeOfficialAnimeStatistics(
  s: OfficialAnimeStatistics | undefined,
): z.infer<typeof statisticsSchema> {
  const toNumber = (v: string | undefined): number | undefined =>
    v === undefined ? undefined : Number(v);
  return statisticsSchema.parse(
    clean({
      watching: toNumber(s?.status?.watching),
      completed: toNumber(s?.status?.completed),
      on_hold: toNumber(s?.status?.on_hold),
      dropped: toNumber(s?.status?.dropped),
      plan_to_watch: toNumber(s?.status?.plan_to_watch),
      total: s?.num_list_users,
    }),
  );
}

export function summarizeOfficialManga(
  n: OfficialMangaNode,
): ReturnType<typeof projectMangaSummary> {
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

// Detail-mode fallback for get_manga — see summarizeOfficialAnimeDetailed's comment for the
// scope of what the official API can and can't reproduce from Jikan's `detailed: true` output.
export function summarizeOfficialMangaDetailed(
  n: OfficialMangaNode,
): z.infer<typeof mangaDetailSchema> {
  const base = summarizeOfficialManga(n);
  return mangaDetailSchema.parse(
    clean({
      ...base,
      synopsis: trimSynopsis(n.synopsis, true),
      title_japanese: n.alternative_titles?.ja ?? undefined,
      publishing: n.status === "currently_publishing",
      scored_by: n.num_scoring_users ?? undefined,
      background: n.background ?? undefined,
      serializations: (n.serialization ?? [])
        .map((s) => s.node?.name)
        .filter((name): name is string => Boolean(name)),
      relations: groupRelations(n.related_anime, n.related_manga),
    }),
  );
}
