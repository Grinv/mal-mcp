// Zod schemas describing the exact return shape of each shaper in ./format.ts
// (and, where the shape is shared, ./formatOfficial.ts). Used two ways: as a
// tool's `outputSchema` (MCP structured content, SEP-2106), and — schema-first —
// by the paired shaper itself, which builds its result and runs it through
// `<name>Schema.parse()` before returning. A shaper that drifts from its schema
// throws immediately at the source instead of silently disagreeing with two
// independently-maintained files.
//
// Every object is `z.strictObject(...)` (zod v4's replacement for the legacy
// `z.object({...}).strict()` chain — identical behavior/JSON Schema, `.strict()` is just
// flagged "legacy, consider z.strictObject() instead"): a shaper that starts returning a field
// this file doesn't know about must fail validation instead of silently dropping the extra key.
// `.extend()` on a strictObject-derived schema stays strict automatically, so a `.extend({...})`
// chain (animeDetailSchema, mangaDetailSchema, producerDetailSchema below) needs no trailing
// `.strict()`/`z.strictObject()` of its own: `.extend()` on a strictObject
// still rejects any key its shape doesn't declare.
// `.optional()` marks a field that can be a genuinely absent key —
// either because format.ts's `clean()` dropped an undefined/empty-array value,
// or because the raw upstream field itself was never guaranteed present.
import { z } from "zod";

// ---- shared sub-shapes -------------------------------------------------------

// {mal_id, title, votes, url}, used by summarizeRecommendations and
// summarizeOfficialRecommendations — a ref plus its vote count. mal_id required — see
// characterEntrySchema's comment below; these entries exist to be chained into get_anime/get_manga.
export const recommendationEntrySchema = z.strictObject({
  mal_id: z.int().positive(),
  title: z.string().optional(),
  votes: z.int().nonnegative().optional(),
  url: z.string().optional(),
});

// A {relation, entries} group, as produced by both Tenrai's grouped `relations`
// and the official-API fallback's groupRelations().
const relationSchema = z.strictObject({
  relation: z.string().optional(),
  entries: z.array(z.string()).optional(),
});

// ---- pageInfo() ---------------------------------------------------------------

// Also covers officialReads.ts's own inline `{ has_next_page }` page object —
// every field here is optional, so that subset satisfies this schema too.
export const pageSchema = z.strictObject({
  current_page: z.int().positive().optional(),
  has_next_page: z.boolean().optional(),
  last_visible_page: z.int().positive().optional(),
  total: z.int().nonnegative().optional(),
});

/** The `outputSchema` for any tool whose client wraps a list as `{results, page}`. */
export function listPageSchema<T extends z.ZodTypeAny>(item: T) {
  return z.strictObject({
    results: z.array(item),
    page: pageSchema,
  });
}

// ---- summarizeAnime / summarizeManga (+ official-fallback equivalents) -------

export const animeSummarySchema = z.strictObject({
  mal_id: z.int().positive(),
  title: z.string().optional(),
  title_english: z.string().optional(),
  type: z.string().optional(),
  episodes: z.int().nonnegative().optional(),
  status: z.string().optional(),
  airing: z.boolean().optional(),
  score: z.number().optional(),
  rank: z.int().positive().optional(),
  popularity: z.int().positive().optional(),
  members: z.int().nonnegative().optional(),
  year: z.int().min(1900).max(2100).optional(),
  season: z.string().optional(),
  rating: z.string().optional(),
  // A free-form display string ("Apr 3, 1998 to Apr 24, 1999"), not an ISO datetime — this
  // maps DateRange's own pre-formatted `.string` field. Contrast episodeEntrySchema's `aired`
  // below, which is a real ISO datetime straight off the raw episode record.
  aired: z.string().optional(),
  genres: z.array(z.string()).optional(),
  themes: z.array(z.string()).optional(),
  demographics: z.array(z.string()).optional(),
  studios: z.array(z.string()).optional(),
  synopsis: z.string().optional(),
  url: z.string().optional(),
  image_url: z.string().optional(),
  broadcast: z.string().optional(),
});

// {name, url} — used for both streaming-service links and external (official site, social
// media) links; Tenrai returns the exact same shape for each.
const namedLinkSchema = z.strictObject({ name: z.string().optional(), url: z.string().optional() });

// summarizeAnime(detailed: true) and summarizeOfficialAnimeDetailed both build
// this shape — the official fallback simply never populates the fields it has
// no upstream equivalent for (producers/licensors/streaming/themes/trailer/
// favorites — see formatOfficial.ts's comment), which this schema's optionality
// already allows.
export const animeDetailSchema = animeSummarySchema.extend({
  title_japanese: z.string().optional(),
  source: z.string().optional(),
  duration: z.string().optional(),
  scored_by: z.int().nonnegative().optional(),
  favorites: z.int().nonnegative().optional(),
  background: z.string().optional(),
  producers: z.array(z.string()).optional(),
  licensors: z.array(z.string()).optional(),
  streaming: z.array(namedLinkSchema).optional(),
  opening_themes: z.array(z.string()).optional(),
  ending_themes: z.array(z.string()).optional(),
  trailer: z.string().optional(),
  relations: z.array(relationSchema).optional(),
  moreinfo: z.string().optional(),
  explicit_genres: z.array(z.string()).optional(),
  title_synonyms: z.array(z.string()).optional(),
  external: z.array(namedLinkSchema).optional(),
});

export const mangaSummarySchema = z.strictObject({
  mal_id: z.int().positive(),
  title: z.string().optional(),
  title_english: z.string().optional(),
  type: z.string().optional(),
  chapters: z.int().nonnegative().optional(),
  volumes: z.int().nonnegative().optional(),
  status: z.string().optional(),
  score: z.number().optional(),
  rank: z.int().positive().optional(),
  popularity: z.int().positive().optional(),
  members: z.int().nonnegative().optional(),
  published: z.string().optional(),
  genres: z.array(z.string()).optional(),
  themes: z.array(z.string()).optional(),
  demographics: z.array(z.string()).optional(),
  authors: z.array(z.string()).optional(),
  synopsis: z.string().optional(),
  url: z.string().optional(),
  image_url: z.string().optional(),
});

// summarizeManga(detailed: true) and summarizeOfficialMangaDetailed both build
// this shape — see animeDetailSchema's comment for the same official-fallback
// field-coverage caveat (here: no serializations-equivalent gap, but the same
// "absent rather than approximated" principle).
export const mangaDetailSchema = mangaSummarySchema.extend({
  title_japanese: z.string().optional(),
  publishing: z.boolean().optional(),
  scored_by: z.int().nonnegative().optional(),
  favorites: z.int().nonnegative().optional(),
  background: z.string().optional(),
  serializations: z.array(z.string()).optional(),
  relations: z.array(relationSchema).optional(),
  explicit_genres: z.array(z.string()).optional(),
  title_synonyms: z.array(z.string()).optional(),
  external: z.array(namedLinkSchema).optional(),
});

// ---- summarizeCharacters -------------------------------------------------------

// mal_id required — get_character's own description points here ("Obtain the mal_id from
// search_characters or get_anime_characters"). This is the first of several schemas in this
// file requiring mal_id/year for the same reason: the value is the real MAL id (or, for
// get_seasons_list, year) of an existing record, and every one of these entries exists
// specifically so a caller can chain it into another tool (get_anime/get_manga/get_character/
// get_person/get_seasonal_anime) — a shaper that ever drops it should fail loudly, not silently
// ship an unusable entry (see the mal_id-required note in ../__tests__/format.test.ts). Every
// "see characterEntrySchema's comment above/below" reference in this file points back here.
export const characterEntrySchema = z.strictObject({
  mal_id: z.int().positive(),
  name: z.string().optional(),
  role: z.string().optional(),
  url: z.string().optional(),
  voice_actors: z.array(z.string()).optional(),
});

export const charactersSchema = z.strictObject({ characters: z.array(characterEntrySchema) });

// ---- summarizeRecommendations (+ summarizeOfficialRecommendations) -----------

export const recommendationsSchema = z.strictObject({
  recommendations: z.array(recommendationEntrySchema),
});

// ---- summarizeRecentRecommendations -----------------------------------------

// mal_id required on each paired entry — see characterEntrySchema's comment above; the
// containing row has no chainable id of its own (Tenrai's own id there is a composite
// "1-30"-style pair id), so only these two entries are exposed.
const recentRecommendationEntitySchema = z.strictObject({
  mal_id: z.int().positive(),
  title: z.string().optional(),
  url: z.string().optional(),
  image_url: z.string().optional(),
});

export const recentRecommendationEntrySchema = z.strictObject({
  entries: z.array(recentRecommendationEntitySchema),
  content: z.string().optional(),
  date: z.iso.datetime({ offset: true }).optional(),
  user: z.string().optional(),
});

export const recentRecommendationsSchema = listPageSchema(recentRecommendationEntrySchema);

// ---- summarizeReviews -----------------------------------------------------------

export const reviewEntrySchema = z.strictObject({
  user: z.string().optional(),
  // MAL review scores are always a whole 1-10 star rating (unlike the anime/manga entity's
  // own decimal average `score`, e.g. 8.75).
  score: z.int().min(1).max(10).optional(),
  tags: z.array(z.string()),
  date: z.iso.datetime({ offset: true }).optional(),
  review: z.string().optional(),
  url: z.string().optional(),
  is_spoiler: z.boolean().optional(),
  is_preliminary: z.boolean().optional(),
  episodes_watched: z.int().nonnegative().optional(),
  chapters_read: z.int().nonnegative().optional(),
  reactions: z.record(z.string(), z.int().nonnegative()).optional(),
});

export const reviewsSchema = z.strictObject({ reviews: z.array(reviewEntrySchema) });

// ---- summarizeEpisodes -----------------------------------------------------------

export const episodeEntrySchema = z.strictObject({
  mal_id: z.int().positive().optional(),
  title: z.string().optional(),
  title_japanese: z.string().optional(),
  aired: z.iso.datetime({ offset: true }).optional(),
  score: z.number().optional(),
  filler: z.boolean().optional(),
  recap: z.boolean().optional(),
});

export const episodesSchema = z.strictObject({
  episodes: z.array(episodeEntrySchema),
  page: pageSchema,
});

// ---- summarizeGenres -----------------------------------------------------------

// mal_id required — this is exactly the numeric ID search_anime/search_manga's own `genres`
// param expects (validated there against \d+(,\d+)* — see tools/read.ts's genreIds()); see
// characterEntrySchema's comment above.
export const genreEntrySchema = z.strictObject({
  mal_id: z.int().positive(),
  name: z.string().optional(),
  count: z.int().nonnegative().optional(),
  url: z.string().optional(),
});

export const genresSchema = z.strictObject({ genres: z.array(genreEntrySchema) });

// ---- summarizeCharacter / summarizePerson -------------------------------------

// mal_id required — an anime/manga a character/person appears in, meant to chain into
// get_anime/get_manga; see characterEntrySchema's comment above.
export const creditEntrySchema = z.strictObject({
  role: z.string().optional(),
  position: z.string().optional(),
  mal_id: z.int().positive(),
  title: z.string().optional(),
});

// mal_id required — this is exactly what get_person's description points to as the mal_id
// source for get_anime_characters' names-only voice_actors; see characterEntrySchema's comment above.
export const voiceActorEntrySchema = z.strictObject({
  language: z.string().optional(),
  mal_id: z.int().positive(),
  name: z.string().optional(),
});

// mal_id required — it's this entity's own get_character lookup key; see characterEntrySchema's
// comment above.
export const characterEntitySchema = z.strictObject({
  mal_id: z.int().positive(),
  name: z.string().optional(),
  name_kanji: z.string().optional(),
  nicknames: z.array(z.string()).optional(),
  favorites: z.int().nonnegative().optional(),
  about: z.string().optional(),
  url: z.string().optional(),
  image_url: z.string().optional(),
  anime: z.array(creditEntrySchema).optional(),
  manga: z.array(creditEntrySchema).optional(),
  voice_actors: z.array(voiceActorEntrySchema).optional(),
});

const voiceRoleEntrySchema = z.strictObject({
  role: z.string().optional(),
  character: z.string().optional(),
  anime: z.string().optional(),
});

// mal_id required — it's this entity's own get_person lookup key; see characterEntrySchema's
// comment above.
export const personEntitySchema = z.strictObject({
  mal_id: z.int().positive(),
  name: z.string().optional(),
  given_name: z.string().optional(),
  family_name: z.string().optional(),
  alternate_names: z.array(z.string()).optional(),
  birthday: z.string().optional(),
  favorites: z.int().nonnegative().optional(),
  about: z.string().optional(),
  url: z.string().optional(),
  image_url: z.string().optional(),
  anime: z.array(creditEntrySchema).optional(),
  manga: z.array(creditEntrySchema).optional(),
  voice_roles: z.array(voiceRoleEntrySchema).optional(),
});

// ---- summarizeStaff -----------------------------------------------------------

// mal_id required — meant to chain into get_person; see characterEntrySchema's comment above.
export const staffEntrySchema = z.strictObject({
  mal_id: z.int().positive(),
  name: z.string().optional(),
  positions: z.array(z.string()).optional(),
  url: z.string().optional(),
});

export const staffSchema = z.strictObject({ staff: z.array(staffEntrySchema) });

// ---- summarizeStatistics (+ summarizeOfficialAnimeStatistics) -----------------

const scoreEntrySchema = z.strictObject({
  // The score bucket (1-10), not a decimal average — see reviewEntrySchema's comment above.
  score: z.int().min(1).max(10).optional(),
  votes: z.int().nonnegative().optional(),
  percentage: z.number().optional(),
});

// The official-API fallback only ever populates watching/completed/on_hold/
// dropped/plan_to_watch/total (see summarizeOfficialAnimeStatistics) — a subset
// of what Tenrai can return, which this schema's optionality already allows.
export const statisticsSchema = z.strictObject({
  watching: z.int().nonnegative().optional(),
  completed: z.int().nonnegative().optional(),
  on_hold: z.int().nonnegative().optional(),
  dropped: z.int().nonnegative().optional(),
  plan_to_watch: z.int().nonnegative().optional(),
  reading: z.int().nonnegative().optional(),
  plan_to_read: z.int().nonnegative().optional(),
  total: z.int().nonnegative().optional(),
  scores: z.array(scoreEntrySchema).optional(),
});

// ---- summarizeProducer -----------------------------------------------------------

// mal_id required — the studio/producer's own canonical MAL producer ID; see characterEntrySchema's
// comment above.
export const producerSchema = z.strictObject({
  mal_id: z.int().positive(),
  name: z.string().optional(),
  count: z.int().nonnegative().optional(),
  favorites: z.int().nonnegative().optional(),
  established: z.iso.datetime({ offset: true }).optional(),
  url: z.string().optional(),
  image_url: z.string().optional(),
});

// summarizeProducer(detailed: true) builds this shape — get_producer (single-producer lookup,
// /producers/{id}/full) vs. get_producers (list/search, /producers, which has no about/external).
export const producerDetailSchema = producerSchema.extend({
  about: z.string().optional(),
  external: z.array(namedLinkSchema).optional(),
});

// ---- summarizeMagazine -----------------------------------------------------------

// mal_id required — the magazine's own canonical MAL ID; see characterEntrySchema's comment
// above. Unlike producerSchema, magazines have no titles/images/favorites/established fields —
// Tenrai's own response shape for this endpoint is simply {mal_id, name, url, count}.
export const magazineSchema = z.strictObject({
  mal_id: z.int().positive(),
  name: z.string().optional(),
  count: z.int().nonnegative().optional(),
  url: z.string().optional(),
});

// ---- summarizeAnimeVideos -----------------------------------------------------------

const videoClipEntrySchema = z.strictObject({
  title: z.string().optional(),
  url: z.string().optional(),
  image_url: z.string().optional(),
  views: z.int().nonnegative().optional(),
  likes: z.int().nonnegative().optional(),
});

const episodePreviewEntrySchema = z.strictObject({
  mal_id: z.int().positive().optional(),
  title: z.string().optional(),
  episode: z.string().optional(),
  url: z.string().optional(),
  image_url: z.string().optional(),
});

export const animeVideosSchema = z.strictObject({
  promo: z.array(videoClipEntrySchema),
  episodes: z.array(episodePreviewEntrySchema),
  music_videos: z.array(videoClipEntrySchema),
});

// ---- summarizeSeasonsList -----------------------------------------------------------

// year required — get_seasons_list's own description says its whole purpose is picking a
// valid `year` argument for get_seasonal_anime; an entry missing it can't serve that purpose.
// Same reasoning as mal_id in the entity schemas above.
export const seasonEntrySchema = z.strictObject({
  year: z.int().min(1900).max(2100),
  seasons: z.array(z.string()),
});

export const seasonsListSchema = z.strictObject({ seasons: z.array(seasonEntrySchema) });

// ---- summarizeNewsItem -----------------------------------------------------------

export const newsItemSchema = z.strictObject({
  mal_id: z.int().positive().optional(),
  title: z.string().optional(),
  date: z.iso.datetime({ offset: true }).optional(),
  author: z.string().optional(),
  comments: z.int().nonnegative().optional(),
  excerpt: z.string().optional(),
  url: z.string().optional(),
});

// ---- clients/mal.ts's trimList()/deleteMy*ListItem() outputs -----------------
//
// Unlike MyUserInfoSchema/MalListResponseSchema/ListStatusUpdateResponseSchema (which stay in
// clients/mal.ts and are deliberately z.looseObject() — they validate raw upstream responses
// forwarded near-verbatim), these describe already-shaped/client-synthesized output, so — same
// rule as every other schema in this file — they're z.strictObject() and live here, not in mal.ts.

// mal_id required — it's the anime_id/manga_id update_my_anime_status/update_my_manga_status
// and delete_my_anime_list_item/delete_my_manga_list_item expect; see characterEntrySchema's
// comment above.
export const myListItemSchema = z.strictObject({
  mal_id: z.int().positive(),
  title: z.string().optional(),
  // Loose on purpose: anime and manga list_status differ (num_episodes_watched vs
  // num_chapters_read/num_volumes_read, is_rewatching vs is_rereading, …) and MAL may add
  // fields later — this only confirms it's an object, not a bare array/string/null.
  list_status: z.record(z.string(), z.unknown()).optional(),
});

/** The outputSchema for get_my_anime_list / get_my_manga_list (clients/mal.ts's trimList()). */
export const myListSchema = z.strictObject({
  items: z.array(myListItemSchema),
  has_next_page: z.boolean(),
});

/** The outputSchema for delete_my_anime_list_item / delete_my_manga_list_item. */
export const deleteAnimeItemSchema = z.strictObject({
  deleted: z.literal(true),
  anime_id: z.int().positive(),
});
export const deleteMangaItemSchema = z.strictObject({
  deleted: z.literal(true),
  manga_id: z.int().positive(),
});
