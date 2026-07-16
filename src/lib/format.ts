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
  duration?: string | null;
  broadcast?: {
    day?: string | null;
    time?: string | null;
    timezone?: string | null;
    string?: string | null;
  };
  trailer?: { youtube_id?: string | null; url?: string | null; embed_url?: string | null };
  theme?: { openings?: string[] | null; endings?: string[] | null };
  studios?: NamedRef[];
  producers?: NamedRef[];
  licensors?: NamedRef[];
  streaming?: NamedRef[];
  relations?: { relation?: string; entry?: NamedRef[] }[];
  // manga-only
  chapters?: number | null;
  volumes?: number | null;
  publishing?: boolean;
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

export function names(refs: NamedRef[] | undefined): string[] {
  return (refs ?? []).map((r) => r.name).filter((n): n is string => typeof n === "string");
}

function imageUrl(images: JikanImages | undefined): string | undefined {
  return images?.jpg?.large_image_url ?? images?.jpg?.image_url;
}

// Jikan returns score 0 to mean "no score yet" (see docs "JSON Notes"); surface
// that as absent rather than a literal 0 an agent might read as a 0/10 rating.
export function score(value: number | null | undefined): number | undefined {
  return value ? value : undefined;
}

export function trimSynopsis(
  synopsis: string | null | undefined,
  detailed: boolean,
): string | undefined {
  if (!synopsis) return undefined;
  if (detailed || synopsis.length <= SYNOPSIS_PREVIEW) return synopsis;
  return synopsis.slice(0, SYNOPSIS_PREVIEW).trimEnd() + "…";
}

/** Truncate free text to `max` chars with an ellipsis; drops empty/nullish. */
function clip(text: string | null | undefined, max: number): string | undefined {
  if (!text) return undefined;
  return text.length <= max ? text : text.slice(0, max).trimEnd() + "…";
}

/** Drop keys whose value is undefined so structuredContent stays compact. */
export function clean<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
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
    score: score(a.score),
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
    duration: a.duration ?? undefined,
    // Broadcast slot for currently-airing shows; `.string` is the human form
    // (e.g. "Fridays at 23:00 (JST)"). Only present/meaningful while airing.
    broadcast: a.broadcast?.string ?? undefined,
    scored_by: a.scored_by ?? undefined,
    favorites: a.favorites ?? undefined,
    background: a.background ?? undefined,
    producers: names(a.producers),
    licensors: names(a.licensors),
    streaming: (a.streaming ?? []).map((s) => clean({ name: s.name, url: s.url })),
    // Opening/ending theme songs (already-formatted strings, e.g.
    // `1: "Yuusha" by YOASOBI (eps 1-16)`). Empty arrays are dropped by clean().
    opening_themes: a.theme?.openings ?? undefined,
    ending_themes: a.theme?.endings ?? undefined,
    // Trailer: prefer the watch URL, fall back to the embed URL; both nullable.
    trailer: a.trailer?.url ?? a.trailer?.embed_url ?? undefined,
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
    score: score(m.score),
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
    // Whether the manga is still being published (analogous to anime `airing`).
    publishing: m.publishing,
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

// ---- Sub-resource raw shapes + summaries ----
// Each summary takes the raw upstream `data` (array or object) and returns the
// trimmed, agent-facing payload. The Jikan client only fetches + caches and
// delegates the shaping here, so all raw→trim logic lives in one place.

export interface RawCharacter {
  character?: { mal_id?: number; name?: string; url?: string };
  role?: string;
  voice_actors?: { language?: string; person?: { name?: string } }[];
}

/** Characters of an anime/manga. Anime keeps Japanese voice actors; manga has none. */
export function summarizeCharacters(
  data: RawCharacter[],
  withVoiceActors: boolean,
): Record<string, unknown> {
  return {
    characters: data.map((c) => {
      const base = {
        mal_id: c.character?.mal_id,
        name: c.character?.name,
        role: c.role,
        url: c.character?.url,
      };
      if (!withVoiceActors) return base;
      return {
        ...base,
        voice_actors: (c.voice_actors ?? [])
          .filter((v) => v.language === "Japanese")
          .map((v) => v.person?.name)
          .filter((n): n is string => typeof n === "string"),
      };
    }),
  };
}

export interface RawRecommendation {
  entry?: { mal_id?: number; title?: string; url?: string };
  votes?: number;
}

export function summarizeRecommendations(data: RawRecommendation[]): Record<string, unknown> {
  return {
    recommendations: data.slice(0, 25).map((r) => ({
      mal_id: r.entry?.mal_id,
      title: r.entry?.title,
      votes: r.votes,
      url: r.entry?.url,
    })),
  };
}

export interface RawReview {
  user?: { username?: string };
  score?: number;
  tags?: string[];
  date?: string;
  review?: string;
  url?: string;
}

export function summarizeReviews(data: RawReview[]): Record<string, unknown> {
  return {
    reviews: data.map((r) => ({
      user: r.user?.username,
      score: r.score,
      tags: r.tags ?? [],
      date: r.date,
      review: typeof r.review === "string" ? r.review.slice(0, 1200) : undefined,
      url: r.url,
    })),
  };
}

export interface RawEpisode {
  mal_id?: number;
  title?: string;
  title_japanese?: string | null;
  aired?: string | null;
  score?: number | null;
  filler?: boolean;
  recap?: boolean;
}

export function summarizeEpisodes(
  data: RawEpisode[],
  pagination: JikanPagination | undefined,
): Record<string, unknown> {
  return {
    episodes: data.map((e) => ({
      mal_id: e.mal_id,
      title: e.title,
      title_japanese: e.title_japanese ?? undefined,
      aired: e.aired ?? undefined,
      score: e.score ?? undefined,
      filler: e.filler,
      recap: e.recap,
    })),
    page: pageInfo(pagination),
  };
}

export interface RawGenre {
  mal_id?: number;
  name?: string;
  count?: number;
  url?: string;
}

export function summarizeGenres(data: RawGenre[]): Record<string, unknown> {
  return {
    genres: data.map((g) => ({ mal_id: g.mal_id, name: g.name, count: g.count, url: g.url })),
  };
}

export interface RawUser {
  username?: string;
  url?: string;
  joined?: string;
  location?: string | null;
  gender?: string | null;
  last_online?: string | null;
  about?: string | null;
  statistics?: unknown;
}

export function summarizeUser(u: RawUser): Record<string, unknown> {
  return {
    username: u.username,
    url: u.url,
    joined: u.joined,
    location: u.location ?? undefined,
    gender: u.gender ?? undefined,
    last_online: u.last_online ?? undefined,
    about: typeof u.about === "string" ? u.about.slice(0, 600) : undefined,
    statistics: u.statistics,
  };
}

export interface RawFavEntry {
  mal_id?: number;
  title?: string;
  name?: string;
  url?: string;
}
export interface RawFavorites {
  anime?: RawFavEntry[];
  manga?: RawFavEntry[];
  characters?: RawFavEntry[];
  people?: RawFavEntry[];
}

export function summarizeFavorites(f: RawFavorites): Record<string, unknown> {
  const titles = (items: RawFavEntry[] | undefined): Record<string, unknown>[] =>
    (items ?? []).map((i) => ({ mal_id: i.mal_id, title: i.title ?? i.name, url: i.url }));
  return {
    anime: titles(f.anime),
    manga: titles(f.manga),
    characters: titles(f.characters),
    people: titles(f.people),
  };
}

// ---- Characters & people (entity lookups + search) ----
// A reference to another entry, used across the relation/voice fields below.
interface RawRef {
  mal_id?: number;
  title?: string;
  name?: string;
  url?: string;
}

export interface RawCharacterEntity {
  mal_id?: number;
  url?: string;
  images?: JikanImages;
  name?: string;
  name_kanji?: string | null;
  nicknames?: string[];
  favorites?: number;
  about?: string | null;
  anime?: { role?: string; anime?: RawRef }[];
  manga?: { role?: string; manga?: RawRef }[];
  voices?: { language?: string; person?: RawRef }[];
}

// detailed=false → compact summary for search/top lists; true → full card with
// the character's anime/manga appearances and voice actors.
export function summarizeCharacter(
  c: RawCharacterEntity,
  detailed = false,
): Record<string, unknown> {
  const base = clean({
    mal_id: c.mal_id,
    name: c.name,
    name_kanji: c.name_kanji ?? undefined,
    nicknames: c.nicknames ?? [],
    favorites: c.favorites,
    about: clip(c.about, detailed ? 1500 : 200),
    url: c.url,
    image_url: imageUrl(c.images),
  });
  if (!detailed) return base;
  return clean({
    ...base,
    anime: (c.anime ?? []).map((a) =>
      clean({ role: a.role, mal_id: a.anime?.mal_id, title: a.anime?.title }),
    ),
    manga: (c.manga ?? []).map((m) =>
      clean({ role: m.role, mal_id: m.manga?.mal_id, title: m.manga?.title }),
    ),
    voice_actors: (c.voices ?? []).map((v) =>
      clean({ language: v.language, mal_id: v.person?.mal_id, name: v.person?.name }),
    ),
  });
}

export interface RawPersonEntity {
  mal_id?: number;
  url?: string;
  images?: JikanImages;
  name?: string;
  given_name?: string | null;
  family_name?: string | null;
  alternate_names?: string[];
  birthday?: string | null;
  favorites?: number;
  about?: string | null;
  anime?: { position?: string; anime?: RawRef }[];
  manga?: { position?: string; manga?: RawRef }[];
  voices?: { role?: string; anime?: RawRef; character?: RawRef }[];
}

export function summarizePerson(p: RawPersonEntity, detailed = false): Record<string, unknown> {
  const base = clean({
    mal_id: p.mal_id,
    name: p.name,
    given_name: p.given_name ?? undefined,
    family_name: p.family_name ?? undefined,
    alternate_names: p.alternate_names ?? [],
    birthday: p.birthday ?? undefined,
    favorites: p.favorites,
    about: clip(p.about, detailed ? 1500 : 200),
    url: p.url,
    image_url: imageUrl(p.images),
  });
  if (!detailed) return base;
  return clean({
    ...base,
    anime: (p.anime ?? []).map((a) =>
      clean({ position: a.position, mal_id: a.anime?.mal_id, title: a.anime?.title }),
    ),
    manga: (p.manga ?? []).map((m) =>
      clean({ position: m.position, mal_id: m.manga?.mal_id, title: m.manga?.title }),
    ),
    // Voiced roles can be huge for prolific actors; cap to keep the payload sane.
    voice_roles: (p.voices ?? [])
      .slice(0, 50)
      .map((v) => clean({ role: v.role, character: v.character?.name, anime: v.anime?.title })),
  });
}

export interface RawStaff {
  person?: { mal_id?: number; name?: string; url?: string };
  positions?: string[];
}
export function summarizeStaff(data: RawStaff[]): Record<string, unknown> {
  return {
    staff: data.map((s) =>
      clean({
        mal_id: s.person?.mal_id,
        name: s.person?.name,
        positions: s.positions ?? [],
        url: s.person?.url,
      }),
    ),
  };
}

// ---- Statistics ----
// Anime and manga share one shape; the irrelevant keys are undefined and dropped
// by clean (e.g. `reading`/`plan_to_read` for anime).
export interface RawStatistics {
  watching?: number;
  completed?: number;
  on_hold?: number;
  dropped?: number;
  plan_to_watch?: number;
  reading?: number;
  plan_to_read?: number;
  total?: number;
  scores?: { score?: number; votes?: number; percentage?: number }[];
}
export function summarizeStatistics(s: RawStatistics): Record<string, unknown> {
  return clean({
    watching: s.watching,
    completed: s.completed,
    on_hold: s.on_hold,
    dropped: s.dropped,
    plan_to_watch: s.plan_to_watch,
    reading: s.reading,
    plan_to_read: s.plan_to_read,
    total: s.total,
    scores: (s.scores ?? []).map((x) => ({
      score: x.score,
      votes: x.votes,
      percentage: x.percentage,
    })),
  });
}

// ---- Producers (studios) ----
export interface RawProducer {
  mal_id?: number;
  url?: string;
  titles?: { type?: string; title?: string }[];
  images?: JikanImages;
  favorites?: number;
  established?: string | null;
  count?: number;
}
export function summarizeProducer(p: RawProducer): Record<string, unknown> {
  const name = (p.titles ?? []).find((t) => t.type === "Default")?.title ?? p.titles?.[0]?.title;
  return clean({
    mal_id: p.mal_id,
    name,
    count: p.count,
    favorites: p.favorites,
    established: p.established ?? undefined,
    url: p.url,
    image_url: imageUrl(p.images),
  });
}

// ---- Seasons list & news ----
export interface RawSeasonEntry {
  year?: number;
  seasons?: string[];
}
export function summarizeSeasonsList(data: RawSeasonEntry[]): Record<string, unknown> {
  return { seasons: data.map((s) => ({ year: s.year, seasons: s.seasons ?? [] })) };
}

export interface RawNewsItem {
  mal_id?: number;
  url?: string;
  title?: string;
  date?: string;
  author_username?: string;
  comments?: number;
  excerpt?: string;
}
export function summarizeNewsItem(n: RawNewsItem): Record<string, unknown> {
  return clean({
    mal_id: n.mal_id,
    title: n.title,
    date: n.date,
    author: n.author_username,
    comments: n.comments,
    excerpt: clip(n.excerpt, 300),
    url: n.url,
  });
}
