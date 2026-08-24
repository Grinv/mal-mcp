// Trims verbose Tenrai payloads down to the fields agents actually need, to
// keep responses token-efficient. Summaries are used for list endpoints;
// `summarizeAnime`/`summarizeManga` with `detailed: true` keep the long fields
// (full synopsis, relations, streaming) for single-item lookups.
//
// Schema-first: each shaper below builds its result then runs it through the
// matching Zod schema of the same name (+ `Schema`) from ./format.schemas.ts
// via `.parse()` — the same schema used as the tool's `outputSchema` (MCP
// structured content, SEP-2106). A shaper that starts returning a field its
// schema doesn't know about (or drops one it promised) throws immediately,
// right here, instead of only surfacing as silent drift between two
// independently-maintained files.
import type { z } from "zod";
import {
  animeDetailSchema,
  animeSummarySchema,
  charactersSchema,
  characterEntitySchema,
  characterEntrySchema,
  creditEntrySchema,
  episodesSchema,
  episodeEntrySchema,
  genresSchema,
  genreEntrySchema,
  magazineSchema,
  mangaDetailSchema,
  mangaSummarySchema,
  newsItemSchema,
  pageSchema,
  personEntitySchema,
  producerSchema,
  producerDetailSchema,
  animeVideosSchema,
  videoClipEntrySchema,
  episodePreviewEntrySchema,
  recommendationEntrySchema,
  recommendationsSchema,
  recentRecommendationEntrySchema,
  recentRecommendationsSchema,
  reviewsSchema,
  reviewEntrySchema,
  seasonEntrySchema,
  seasonsListSchema,
  staffEntrySchema,
  staffSchema,
  statisticsSchema,
  voiceActorEntrySchema,
  stackSummarySchema,
  stackEntrySchema,
  stackDetailSchema,
  stacksSchema,
} from "./format.schemas.js";

interface NamedRef {
  mal_id?: number;
  type?: string;
  name?: string;
  url?: string;
}

// A related-entry ref carries one extra field over NamedRef: the specific media type of the
// related work ("Light Novel", "TV", "Movie"), which `type` alone ("anime"/"manga") doesn't say.
interface RelationRef extends NamedRef {
  media_type?: string;
}

/** Related entries, keeping the ids and types a caller needs to actually follow the relation.
 *  Entries with no resolvable mal_id are dropped rather than emitted unfollowable. */
function relationEntries(entry: RelationRef[] | undefined): Record<string, unknown>[] {
  return (entry ?? [])
    .filter((e) => typeof e.mal_id === "number")
    .map((e) =>
      clean({
        mal_id: e.mal_id,
        type: e.type,
        name: e.name,
        url: e.url,
        media_type: e.media_type,
      }),
    );
}

interface RawImages {
  jpg?: { image_url?: string; large_image_url?: string };
}

interface DateRange {
  string?: string | null;
}

// Fields Tenrai returns for both anime and manga entries alike — verified against what
// summarizeAnime/summarizeManga actually read (not just inherited from how the two were
// originally grouped in comments; that grouping had drifted: `relations` was previously
// filed under "anime-only" even though summarizeManga's detailed branch reads it too, and
// `rating`/`source` were filed as shared even though only summarizeAnime ever reads them).
interface AnimeMangaRawBase {
  mal_id: number;
  url?: string;
  title?: string;
  title_english?: string | null;
  title_japanese?: string | null;
  type?: string | null;
  status?: string | null;
  score?: number | null;
  scored_by?: number | null;
  rank?: number | null;
  popularity?: number | null;
  members?: number | null;
  favorites?: number | null;
  synopsis?: string | null;
  background?: string | null;
  images?: RawImages;
  genres?: NamedRef[];
  themes?: NamedRef[];
  demographics?: NamedRef[];
  explicit_genres?: NamedRef[];
  title_synonyms?: string[];
  external?: { name?: string; url?: string }[];
  relations?: { relation?: string; entry?: RelationRef[] }[];
}

export interface RawAnime extends AnimeMangaRawBase {
  moreinfo?: string | null;
  source?: string | null;
  rating?: string | null;
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
}

export interface RawManga extends AnimeMangaRawBase {
  // Free-text editor note, same field anime has had all along; Tenrai's 1.0.19 spec added it to
  // /manga/{id}/full and it comes back populated (verified live on Berserk).
  moreinfo?: string | null;
  chapters?: number | null;
  volumes?: number | null;
  publishing?: boolean;
  published?: DateRange;
  authors?: NamedRef[];
  serializations?: NamedRef[];
}

export interface RawPagination {
  current_page?: number;
  has_next_page?: boolean;
  last_visible_page?: number;
  items?: { total?: number };
}

const SYNOPSIS_PREVIEW = 350;

export function names(refs: NamedRef[] | undefined): string[] {
  return (refs ?? []).map((r) => r.name).filter((n): n is string => typeof n === "string");
}

function imageUrl(images: RawImages | undefined): string | undefined {
  return images?.jpg?.large_image_url ?? images?.jpg?.image_url;
}

// Tenrai returns score 0 to mean "no score yet" (see docs "JSON Notes"); surface
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
export function clean<T extends object>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

/** Map each item through `build`, validating it against `itemSchema` individually — an item that
 *  fails its own schema (e.g. a genuinely malformed upstream entry missing a now-required field
 *  like mal_id) is dropped instead of failing the whole call. Mirrors `TenraiClient`'s `#list()`
 *  per-item-drop policy for endpoints that return a single top-level item per raw entry; this
 *  covers shapers that instead combine many entries into one outer `.parse()` call, where a lone
 *  bad entry would otherwise take the entire response down with it. */
export function mapLenient<T, S extends z.ZodTypeAny>(
  items: T[],
  itemSchema: S,
  build: (item: T) => unknown,
): z.infer<S>[] {
  const out: z.infer<S>[] = [];
  for (const item of items) {
    const result = itemSchema.safeParse(build(item));
    if (result.success) out.push(result.data);
  }
  return out;
}

// The agent-facing anime/manga summary shape — shared by Tenrai-backed summarizeAnime/summarizeManga
// (below) and the official-API fallback's summarizeOfficialAnime/summarizeOfficialManga
// (formatOfficial.ts). Both sources project their own raw shape into these fields and call
// projectAnimeSummary/projectMangaSummary, so the two summary paths can't drift out of parity —
// adding/removing a field here forces both mapping sites to be updated.
export interface AnimeSummaryFields {
  mal_id: number;
  title?: string;
  title_english?: string;
  type?: string;
  episodes?: number;
  status?: string;
  airing?: boolean;
  score?: number;
  rank?: number;
  popularity?: number;
  members?: number;
  year?: number;
  season?: string;
  rating?: string;
  aired?: string;
  genres: string[];
  themes: string[];
  demographics: string[];
  studios: string[];
  synopsis?: string;
  url?: string;
  image_url?: string;
  broadcast?: string;
}

export function projectAnimeSummary(f: AnimeSummaryFields): z.infer<typeof animeSummarySchema> {
  return animeSummarySchema.parse(clean(f));
}

export interface MangaSummaryFields {
  mal_id: number;
  title?: string;
  title_english?: string;
  type?: string;
  chapters?: number;
  volumes?: number;
  status?: string;
  score?: number;
  rank?: number;
  popularity?: number;
  members?: number;
  published?: string;
  genres: string[];
  themes: string[];
  demographics: string[];
  authors: string[];
  synopsis?: string;
  url?: string;
  image_url?: string;
}

export function projectMangaSummary(f: MangaSummaryFields): z.infer<typeof mangaSummarySchema> {
  return mangaSummarySchema.parse(clean(f));
}

// Compile-time guard, not a runtime check: AnimeSummaryFields/MangaSummaryFields above and
// animeSummarySchema/mangaSummarySchema (format.schemas.ts) are two independently-maintained
// descriptions of the same shape, linked only by the .parse() calls above. A field added to one
// and forgotten on the other would otherwise compile and pass tests cleanly (clean() strips an
// unset field before .strict() ever sees it) and only throw against live upstream data. This
// type fails to compile the moment the two key sets diverge, catching that class of drift at
// `tsc --noEmit` time instead.
type KeysMatch<A, B> = keyof A extends keyof B ? (keyof B extends keyof A ? true : false) : false;
const _animeSummaryFieldsMatchSchema: KeysMatch<
  AnimeSummaryFields,
  z.infer<typeof animeSummarySchema>
> = true;
const _mangaSummaryFieldsMatchSchema: KeysMatch<
  MangaSummaryFields,
  z.infer<typeof mangaSummarySchema>
> = true;

// Overloads narrow the return type on the literal `detailed` argument — plain
// `boolean` alone can't discriminate the union for callers (and tests) that
// pass a literal `true`/`false`.
export function summarizeAnime(a: RawAnime, detailed: true): z.infer<typeof animeDetailSchema>;
export function summarizeAnime(a: RawAnime, detailed?: false): z.infer<typeof animeSummarySchema>;
export function summarizeAnime(
  a: RawAnime,
  detailed = false,
): z.infer<typeof animeSummarySchema> | z.infer<typeof animeDetailSchema> {
  const fields: AnimeSummaryFields = {
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
    // Broadcast slot for currently-airing shows; `.string` is the human form
    // (e.g. "Fridays at 23:00 (JST)"). Only present/meaningful while airing.
    broadcast: a.broadcast?.string ?? undefined,
  };
  const base = projectAnimeSummary(fields);
  if (!detailed) return base;
  return animeDetailSchema.parse(
    clean({
      ...base,
      title_japanese: a.title_japanese ?? undefined,
      source: a.source ?? undefined,
      duration: a.duration ?? undefined,
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
        clean({ relation: r.relation, entries: relationEntries(r.entry) }),
      ),
      moreinfo: a.moreinfo ?? undefined,
      explicit_genres: names(a.explicit_genres),
      title_synonyms: a.title_synonyms ?? undefined,
      external: (a.external ?? []).map((e) => clean({ name: e.name, url: e.url })),
    }),
  );
}

export function summarizeManga(m: RawManga, detailed: true): z.infer<typeof mangaDetailSchema>;
export function summarizeManga(m: RawManga, detailed?: false): z.infer<typeof mangaSummarySchema>;
export function summarizeManga(
  m: RawManga,
  detailed = false,
): z.infer<typeof mangaSummarySchema> | z.infer<typeof mangaDetailSchema> {
  const fields: MangaSummaryFields = {
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
  };
  const base = projectMangaSummary(fields);
  if (!detailed) return base;
  return mangaDetailSchema.parse(
    clean({
      ...base,
      title_japanese: m.title_japanese ?? undefined,
      // Whether the manga is still being published (analogous to anime `airing`).
      publishing: m.publishing,
      scored_by: m.scored_by ?? undefined,
      favorites: m.favorites ?? undefined,
      background: m.background ?? undefined,
      moreinfo: m.moreinfo ?? undefined,
      serializations: names(m.serializations),
      relations: (m.relations ?? []).map((r) =>
        clean({ relation: r.relation, entries: relationEntries(r.entry) }),
      ),
      explicit_genres: names(m.explicit_genres),
      title_synonyms: m.title_synonyms ?? undefined,
      external: (m.external ?? []).map((e) => clean({ name: e.name, url: e.url })),
    }),
  );
}

export function pageInfo(p: RawPagination | undefined): z.infer<typeof pageSchema> {
  return pageSchema.parse(
    clean({
      current_page: p?.current_page,
      has_next_page: p?.has_next_page,
      last_visible_page: p?.last_visible_page,
      total: p?.items?.total,
    }),
  );
}

// ---- Sub-resource raw shapes + summaries ----
// Each summary takes the raw upstream `data` (array or object) and returns the
// trimmed, agent-facing payload. The Tenrai client only fetches + caches and
// delegates the shaping here, so all raw→trim logic lives in one place.

export interface RawCharacter {
  character?: { mal_id?: number; name?: string; url?: string };
  role?: string;
  favorites?: number | null;
  voice_actors?: { language?: string; person?: { name?: string } }[];
}

/** Characters of an anime/manga. Anime keeps Japanese voice actors; manga has none. A character
 *  entry with no resolvable mal_id (a malformed/edge-case upstream record) is dropped rather than
 *  failing the whole list — see `mapLenient`. */
export function summarizeCharacters(
  data: RawCharacter[],
  withVoiceActors: boolean,
): z.infer<typeof charactersSchema> {
  return charactersSchema.parse({
    characters: mapLenient(data, characterEntrySchema, (c) => {
      const base = {
        mal_id: c.character?.mal_id,
        name: c.character?.name,
        role: c.role,
        favorites: c.favorites ?? undefined,
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
  });
}

export interface RawRecommendation {
  entry?: { mal_id?: number; title?: string; url?: string };
  votes?: number;
}

/** A recommendation entry with no resolvable mal_id (a malformed/edge-case upstream record) is
 *  dropped rather than failing the whole list — see `mapLenient`. */
export function summarizeRecommendations(
  data: RawRecommendation[],
): z.infer<typeof recommendationsSchema> {
  return recommendationsSchema.parse({
    recommendations: mapLenient(data.slice(0, 25), recommendationEntrySchema, (r) => ({
      mal_id: r.entry?.mal_id,
      title: r.entry?.title,
      votes: r.votes,
      url: r.entry?.url,
    })),
  });
}

// Site-wide feed of recently-submitted recommendation pairs (e.g. "if you liked X, try Y"),
// distinct from the per-title `entry`/`votes` shape above. The upstream item's own `mal_id` is a
// composite pair id like "1-30" (not a real, chainable MAL id), so it's deliberately not exposed
// — only the two `entry` items' own mal_ids are.
export interface RawRecentRecommendation {
  entry?: { mal_id?: number; title?: string; url?: string; images?: RawImages }[];
  content?: string | null;
  date?: string | null;
  user?: { username?: string };
}

/** A recommendation pair where either side has no resolvable mal_id (a malformed/edge-case
 *  upstream record) is dropped rather than failing the whole list — see `mapLenient`. */
export function summarizeRecentRecommendations(
  data: RawRecentRecommendation[],
  pagination: RawPagination | undefined,
): z.infer<typeof recentRecommendationsSchema> {
  return recentRecommendationsSchema.parse({
    results: mapLenient(data, recentRecommendationEntrySchema, (r) => ({
      entries: (r.entry ?? []).map((e) => ({
        mal_id: e.mal_id,
        title: e.title,
        url: e.url,
        image_url: imageUrl(e.images),
      })),
      content: r.content ?? undefined,
      date: r.date ?? undefined,
      user: r.user?.username,
    })),
    page: pageInfo(pagination),
  });
}

export interface RawReview {
  user?: { username?: string };
  score?: number;
  tags?: string[];
  date?: string;
  review?: string;
  url?: string;
  is_spoiler?: boolean;
  is_preliminary?: boolean;
  // Tenrai names this field differently per media type: anime reviews carry
  // `episodes_watched`, manga reviews carry `chapters_read` — never both on the same item.
  episodes_watched?: number | null;
  chapters_read?: number | null;
  reactions?: Record<string, number>;
}

// A single malformed review (e.g. an unparseable `date`) is dropped rather than failing the
// whole call — see `mapLenient`.
export function summarizeReviews(data: RawReview[]): z.infer<typeof reviewsSchema> {
  return reviewsSchema.parse({
    reviews: mapLenient(data, reviewEntrySchema, (r) => ({
      user: r.user?.username,
      score: r.score,
      tags: r.tags ?? [],
      date: r.date,
      // clip(), not a bare slice: the trailing ellipsis is the only thing telling the agent the
      // review was cut off rather than ending there, and quoting a truncated review as complete
      // misrepresents the reviewer.
      review: typeof r.review === "string" ? clip(r.review, 1200) : undefined,
      url: r.url,
      is_spoiler: r.is_spoiler,
      is_preliminary: r.is_preliminary,
      episodes_watched: r.episodes_watched ?? undefined,
      chapters_read: r.chapters_read ?? undefined,
      reactions: r.reactions,
    })),
  });
}

export interface RawEpisode {
  mal_id?: number;
  title?: string;
  title_japanese?: string | null;
  aired?: string | null;
  score?: number | null;
  filler?: boolean;
  recap?: boolean;
  duration?: number | null;
  synopsis?: string | null;
  replies?: number | null;
  images?: RawImages;
}

// A single malformed episode (e.g. an unparseable `aired`) is dropped rather than failing the
// whole call — see `mapLenient`.
export function summarizeEpisodes(
  data: RawEpisode[],
  pagination: RawPagination | undefined,
): z.infer<typeof episodesSchema> {
  return episodesSchema.parse({
    episodes: mapLenient(data, episodeEntrySchema, (e) => ({
      mal_id: e.mal_id,
      title: e.title,
      title_japanese: e.title_japanese ?? undefined,
      aired: e.aired ?? undefined,
      score: e.score ?? undefined,
      filler: e.filler,
      recap: e.recap,
      duration: e.duration ?? undefined,
      // Per-episode synopses run long and there are hundreds of them on a list endpoint; preview
      // them the same way a list-mode anime synopsis is previewed.
      synopsis: trimSynopsis(e.synopsis, false),
      replies: e.replies ?? undefined,
      image_url: imageUrl(e.images),
    })),
    page: pageInfo(pagination),
  });
}

export interface RawGenre {
  mal_id?: number;
  name?: string;
  count?: number;
  url?: string;
}

// A genre entry missing mal_id (get_anime_genres/get_manga_genres' own lookup key — see
// characterEntrySchema's comment in format.schemas.ts) is dropped rather than failing the whole
// call — see `mapLenient`.
export function summarizeGenres(data: RawGenre[]): z.infer<typeof genresSchema> {
  return genresSchema.parse({
    genres: mapLenient(data, genreEntrySchema, (g) => ({
      mal_id: g.mal_id,
      name: g.name,
      count: g.count,
      url: g.url,
    })),
  });
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
  images?: RawImages;
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
): z.infer<typeof characterEntitySchema> {
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
  if (!detailed) return characterEntitySchema.parse(base);
  // A credit/voice-actor entry with no resolvable mal_id (a malformed/edge-case upstream record,
  // e.g. an unlinked person record) is dropped rather than failing the whole character lookup —
  // see `mapLenient`.
  return characterEntitySchema.parse(
    clean({
      ...base,
      anime: mapLenient(c.anime ?? [], creditEntrySchema, (a) =>
        clean({ role: a.role, mal_id: a.anime?.mal_id, title: a.anime?.title }),
      ),
      manga: mapLenient(c.manga ?? [], creditEntrySchema, (m) =>
        clean({ role: m.role, mal_id: m.manga?.mal_id, title: m.manga?.title }),
      ),
      voice_actors: mapLenient(c.voices ?? [], voiceActorEntrySchema, (v) =>
        clean({ language: v.language, mal_id: v.person?.mal_id, name: v.person?.name }),
      ),
    }),
  );
}

export interface RawPersonEntity {
  mal_id?: number;
  url?: string;
  images?: RawImages;
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

/** Default ceiling on a person's staff-credit lists. Measured against Tenrai before picking it:
 *  over a random sample of 25 people the median is 1 credit and the 90th percentile 23, and even
 *  well-known directors sit far below this (Anno 77, Kanno 62, Watanabe 50). Only the extreme
 *  tail is affected — a sound director like Jin Aketagawa (mal_id 8074) has 534, which is 44 KB
 *  of response on its own. A cap of 50 would instead have truncated exactly the people most
 *  worth asking about. Tenrai has no pagination on any /people/{id}/* route, so this is the only
 *  place such a limit can live. */
const STAFF_CREDIT_CAP = 200;

export function summarizePerson(
  p: RawPersonEntity,
  detailed = false,
  fullCredits = false,
): z.infer<typeof personEntitySchema> {
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
  if (!detailed) return personEntitySchema.parse(base);
  // A credit entry with no resolvable mal_id (a malformed/edge-case upstream record) is dropped
  // rather than failing the whole person lookup — see `mapLenient`. voice_roles has no mal_id
  // field at all (format.schemas.ts's voiceRoleEntrySchema), so it needs no such handling.
  const rawAnime = p.anime ?? [];
  const rawManga = p.manga ?? [];
  const cap = fullCredits ? Infinity : STAFF_CREDIT_CAP;
  const animeCredits = mapLenient(rawAnime.slice(0, cap), creditEntrySchema, (a) =>
    clean({ position: a.position, mal_id: a.anime?.mal_id, title: a.anime?.title }),
  );
  const mangaCredits = mapLenient(rawManga.slice(0, cap), creditEntrySchema, (m) =>
    clean({ position: m.position, mal_id: m.manga?.mal_id, title: m.manga?.title }),
  );
  return personEntitySchema.parse(
    clean({
      ...base,
      anime: animeCredits,
      manga: mangaCredits,
      // Say so when a list was cut, rather than leaving the agent to assume it saw everything.
      credits_truncated: rawAnime.length > cap || rawManga.length > cap ? true : undefined,
      total_anime_credits: rawAnime.length > cap ? rawAnime.length : undefined,
      total_manga_credits: rawManga.length > cap ? rawManga.length : undefined,
      // Voiced roles can be huge for prolific actors; cap to keep the payload sane.
      voice_roles: (p.voices ?? [])
        .slice(0, 50)
        .map((v) => clean({ role: v.role, character: v.character?.name, anime: v.anime?.title })),
    }),
  );
}

export interface RawStaff {
  person?: { mal_id?: number; name?: string; url?: string };
  positions?: string[];
}
/** A staff entry with no resolvable mal_id (a malformed/edge-case upstream record) is dropped
 *  rather than failing the whole list — see `mapLenient`. */
export function summarizeStaff(data: RawStaff[]): z.infer<typeof staffSchema> {
  return staffSchema.parse({
    staff: mapLenient(data, staffEntrySchema, (s) =>
      clean({
        mal_id: s.person?.mal_id,
        name: s.person?.name,
        positions: s.positions ?? [],
        url: s.person?.url,
      }),
    ),
  });
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
export function summarizeStatistics(s: RawStatistics): z.infer<typeof statisticsSchema> {
  return statisticsSchema.parse(
    clean({
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
    }),
  );
}

// ---- Producers (studios) ----
export interface RawProducer {
  mal_id?: number;
  url?: string;
  titles?: { type?: string; title?: string }[];
  images?: RawImages;
  favorites?: number;
  established?: string | null;
  count?: number;
  // Only present on /producers/{id}/full, not the /producers list endpoint.
  about?: string | null;
  external?: { name?: string; url?: string }[];
}
export function summarizeProducer(
  p: RawProducer,
  detailed: true,
): z.infer<typeof producerDetailSchema>;
export function summarizeProducer(p: RawProducer, detailed?: false): z.infer<typeof producerSchema>;
export function summarizeProducer(
  p: RawProducer,
  detailed = false,
): z.infer<typeof producerSchema> | z.infer<typeof producerDetailSchema> {
  const name = (p.titles ?? []).find((t) => t.type === "Default")?.title ?? p.titles?.[0]?.title;
  const base = producerSchema.parse(
    clean({
      mal_id: p.mal_id,
      name,
      count: p.count,
      favorites: p.favorites,
      established: p.established ?? undefined,
      url: p.url,
      image_url: imageUrl(p.images),
    }),
  );
  if (!detailed) return base;
  return producerDetailSchema.parse(
    clean({
      ...base,
      about: p.about ?? undefined,
      external: (p.external ?? []).map((e) => clean({ name: e.name, url: e.url })),
    }),
  );
}

// ---- Magazines (manga serialization publishers) ----
export interface RawMagazine {
  mal_id?: number;
  name?: string;
  url?: string;
  count?: number;
}
export function summarizeMagazine(m: RawMagazine): z.infer<typeof magazineSchema> {
  return magazineSchema.parse(
    clean({
      mal_id: m.mal_id,
      name: m.name,
      count: m.count,
      url: m.url,
    }),
  );
}

// ---- Anime videos (promos, episode previews, music videos) ----
interface RawVideoClip {
  youtube_id?: string | null;
  url?: string | null;
  embed_url?: string | null;
  images?: { image_url?: string | null; large_image_url?: string | null };
  title?: string | null;
  views?: number | null;
  likes?: number | null;
  // Extended YouTube metadata (Tenrai 1.0.12). `dislikes`, `privacy_status`, `embeddable` and
  // `region_restriction` are also returned but deliberately not surfaced: dislikes are no longer
  // meaningful since YouTube stopped publishing them, and the rest describe playback policy
  // rather than the video, which is not something an agent answering about an anime needs.
  duration?: string | null;
  published_at?: string | null;
  comment_count?: number | null;
}
export interface RawAnimeVideos {
  promo?: { title?: string; trailer?: RawVideoClip }[];
  episodes?: {
    mal_id?: number;
    title?: string;
    episode?: string;
    url?: string;
    images?: RawImages;
  }[];
  music_videos?: { title?: string; video?: RawVideoClip }[];
}
function clipUrl(clip: RawVideoClip | undefined): string | undefined {
  return clip?.url ?? clip?.embed_url ?? undefined;
}
function clipImageUrl(clip: RawVideoClip | undefined): string | undefined {
  return clip?.images?.large_image_url ?? clip?.images?.image_url ?? undefined;
}
// A malformed clip/preview entry (e.g. a type violation on views/likes) is dropped rather than
// failing the whole call — see `mapLenient`.
export function summarizeAnimeVideos(v: RawAnimeVideos): z.infer<typeof animeVideosSchema> {
  return animeVideosSchema.parse({
    promo: mapLenient(v.promo ?? [], videoClipEntrySchema, (p) =>
      clean({
        title: p.title,
        url: clipUrl(p.trailer),
        image_url: clipImageUrl(p.trailer),
        views: p.trailer?.views ?? undefined,
        likes: p.trailer?.likes ?? undefined,
        duration: p.trailer?.duration ?? undefined,
        published_at: p.trailer?.published_at ?? undefined,
        comment_count: p.trailer?.comment_count ?? undefined,
      }),
    ),
    episodes: mapLenient(v.episodes ?? [], episodePreviewEntrySchema, (e) =>
      clean({
        mal_id: e.mal_id,
        title: e.title,
        episode: e.episode,
        url: e.url,
        image_url: imageUrl(e.images),
      }),
    ),
    music_videos: mapLenient(v.music_videos ?? [], videoClipEntrySchema, (m) =>
      clean({
        title: m.title,
        url: clipUrl(m.video),
        image_url: clipImageUrl(m.video),
        views: m.video?.views ?? undefined,
        likes: m.video?.likes ?? undefined,
        duration: m.video?.duration ?? undefined,
        published_at: m.video?.published_at ?? undefined,
        comment_count: m.video?.comment_count ?? undefined,
      }),
    ),
  });
}

// ---- Seasons list & news ----
export interface RawSeasonEntry {
  year?: number;
  seasons?: string[];
}
/** A season entry with no resolvable year (a malformed/edge-case upstream record) is dropped
 *  rather than failing the whole list — see `mapLenient`. */
export function summarizeSeasonsList(data: RawSeasonEntry[]): z.infer<typeof seasonsListSchema> {
  return seasonsListSchema.parse({
    seasons: mapLenient(data, seasonEntrySchema, (s) => ({
      year: s.year,
      seasons: s.seasons ?? [],
    })),
  });
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
export function summarizeNewsItem(n: RawNewsItem): z.infer<typeof newsItemSchema> {
  return newsItemSchema.parse(
    clean({
      mal_id: n.mal_id,
      title: n.title,
      date: n.date,
      author: n.author_username,
      comments: n.comments,
      excerpt: clip(n.excerpt, 300),
      url: n.url,
    }),
  );
}

export interface RawStack {
  mal_id: number;
  url?: string;
  stack_type?: string | null;
  title?: string | null;
  description?: string | null;
  author_username?: string | null;
  author_url?: string | null;
  is_official?: boolean;
  is_challenge?: boolean;
  is_spoiler?: boolean;
  restack_count?: number | null;
  entry_count?: number | null;
  created_at?: string | null;
  entries?: RawStackEntry[];
}

export interface RawStackEntry {
  mal_id?: number;
  position?: number;
  title?: string | null;
  title_english?: string | null;
  type?: string | null;
  episodes?: number | null;
  aired_from_year?: number | null;
  volumes?: number | null;
  published_from_year?: number | null;
  author_score?: number | null;
  note?: string | null;
  url?: string;
  images?: RawImages;
}

function stackBase(s: RawStack): Record<string, unknown> {
  return clean({
    mal_id: s.mal_id,
    title: s.title ?? undefined,
    // Stack descriptions are curator blurbs, not essays, but cap them like other free text.
    description: clip(s.description, 500),
    stack_type: s.stack_type ?? undefined,
    author_username: s.author_username ?? undefined,
    entry_count: s.entry_count ?? undefined,
    restack_count: s.restack_count ?? undefined,
    is_official: s.is_official,
    is_challenge: s.is_challenge,
    is_spoiler: s.is_spoiler,
    created_at: s.created_at ?? undefined,
    author_url: s.author_url ?? undefined,
    url: s.url,
  });
}

/** A page of interest stacks. A stack with no mal_id is dropped — see `mapLenient`. */
export function summarizeStacks(
  data: RawStack[],
  pagination: RawPagination | undefined,
): z.infer<typeof stacksSchema> {
  return stacksSchema.parse({
    results: mapLenient(data, stackSummarySchema, stackBase),
    page: pageInfo(pagination),
  });
}

/** One interest stack with its entries in the curator's own order. */
export function summarizeStack(s: RawStack): z.infer<typeof stackDetailSchema> {
  return stackDetailSchema.parse(
    clean({
      ...stackBase(s),
      entries: mapLenient(s.entries ?? [], stackEntrySchema, (e) =>
        clean({
          mal_id: e.mal_id,
          position: e.position,
          title: e.title ?? undefined,
          title_english: e.title_english ?? undefined,
          type: e.type ?? undefined,
          episodes: e.episodes ?? undefined,
          aired_from_year: e.aired_from_year ?? undefined,
          volumes: e.volumes ?? undefined,
          published_from_year: e.published_from_year ?? undefined,
          author_score: e.author_score ?? undefined,
          note: clip(e.note, 300),
          url: e.url,
          image_url: imageUrl(e.images),
        }),
      ),
    }),
  );
}
