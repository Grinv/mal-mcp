// Trims verbose Jikan payloads down to the fields agents actually need, to
// keep responses token-efficient. Summaries are used for list endpoints;
// `summarizeAnime`/`summarizeManga` with `detailed: true` keep the long fields
// (full synopsis, relations, streaming) for single-item lookups.

interface NamedRef {
  mal_id?: number;
  type?: string;
  name?: string;
  url?: string;
}

interface JikanImages {
  jpg?: { image_url?: string; large_image_url?: string };
}

interface DateRange {
  string?: string | null;
}

export interface JikanMedia {
  mal_id: number;
  url?: string;
  title?: string;
  title_english?: string | null;
  title_japanese?: string | null;
  type?: string | null;
  source?: string | null;
  status?: string | null;
  score?: number | null;
  scored_by?: number | null;
  rank?: number | null;
  popularity?: number | null;
  members?: number | null;
  favorites?: number | null;
  synopsis?: string | null;
  background?: string | null;
  rating?: string | null;
  images?: JikanImages;
  genres?: NamedRef[];
  themes?: NamedRef[];
  demographics?: NamedRef[];
  // anime-only
  episodes?: number | null;
  airing?: boolean;
  aired?: DateRange;
  season?: string | null;
  year?: number | null;
  studios?: NamedRef[];
  producers?: NamedRef[];
  streaming?: NamedRef[];
  relations?: { relation?: string; entry?: NamedRef[] }[];
  // manga-only
  chapters?: number | null;
  volumes?: number | null;
  published?: DateRange;
  authors?: NamedRef[];
  serializations?: NamedRef[];
}

export interface JikanPagination {
  current_page?: number;
  has_next_page?: boolean;
  last_visible_page?: number;
  items?: { total?: number };
}

const SYNOPSIS_PREVIEW = 350;

function names(refs: NamedRef[] | undefined): string[] {
  return (refs ?? []).map((r) => r.name).filter((n): n is string => typeof n === "string");
}

function imageUrl(images: JikanImages | undefined): string | undefined {
  return images?.jpg?.large_image_url ?? images?.jpg?.image_url;
}

function trimSynopsis(synopsis: string | null | undefined, detailed: boolean): string | undefined {
  if (!synopsis) return undefined;
  if (detailed || synopsis.length <= SYNOPSIS_PREVIEW) return synopsis;
  return synopsis.slice(0, SYNOPSIS_PREVIEW).trimEnd() + "…";
}

/** Drop keys whose value is undefined so structuredContent stays compact. */
function clean<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

export function summarizeAnime(a: JikanMedia, detailed = false): Record<string, unknown> {
  const base = clean({
    mal_id: a.mal_id,
    title: a.title,
    title_english: a.title_english ?? undefined,
    type: a.type ?? undefined,
    episodes: a.episodes ?? undefined,
    status: a.status ?? undefined,
    airing: a.airing,
    score: a.score ?? undefined,
    rank: a.rank ?? undefined,
    popularity: a.popularity ?? undefined,
    members: a.members ?? undefined,
    year: a.year ?? undefined,
    season: a.season ?? undefined,
    rating: a.rating ?? undefined,
    aired: a.aired?.string ?? undefined,
    genres: names(a.genres),
    themes: names(a.themes),
    demographics: names(a.demographics),
    studios: names(a.studios),
    synopsis: trimSynopsis(a.synopsis, detailed),
    url: a.url,
    image_url: imageUrl(a.images),
  });
  if (!detailed) return base;
  return clean({
    ...base,
    title_japanese: a.title_japanese ?? undefined,
    source: a.source ?? undefined,
    scored_by: a.scored_by ?? undefined,
    favorites: a.favorites ?? undefined,
    background: a.background ?? undefined,
    producers: names(a.producers),
    streaming: (a.streaming ?? []).map((s) => clean({ name: s.name, url: s.url })),
    relations: (a.relations ?? []).map((r) =>
      clean({ relation: r.relation, entries: names(r.entry) }),
    ),
  });
}

export function summarizeManga(m: JikanMedia, detailed = false): Record<string, unknown> {
  const base = clean({
    mal_id: m.mal_id,
    title: m.title,
    title_english: m.title_english ?? undefined,
    type: m.type ?? undefined,
    chapters: m.chapters ?? undefined,
    volumes: m.volumes ?? undefined,
    status: m.status ?? undefined,
    score: m.score ?? undefined,
    rank: m.rank ?? undefined,
    popularity: m.popularity ?? undefined,
    members: m.members ?? undefined,
    published: m.published?.string ?? undefined,
    genres: names(m.genres),
    themes: names(m.themes),
    demographics: names(m.demographics),
    authors: names(m.authors),
    synopsis: trimSynopsis(m.synopsis, detailed),
    url: m.url,
    image_url: imageUrl(m.images),
  });
  if (!detailed) return base;
  return clean({
    ...base,
    title_japanese: m.title_japanese ?? undefined,
    scored_by: m.scored_by ?? undefined,
    favorites: m.favorites ?? undefined,
    background: m.background ?? undefined,
    serializations: names(m.serializations),
    relations: (m.relations ?? []).map((r) =>
      clean({ relation: r.relation, entries: names(r.entry) }),
    ),
  });
}

export function pageInfo(p: JikanPagination | undefined): Record<string, unknown> {
  return clean({
    current_page: p?.current_page,
    has_next_page: p?.has_next_page,
    last_visible_page: p?.last_visible_page,
    total: p?.items?.total,
  });
}
