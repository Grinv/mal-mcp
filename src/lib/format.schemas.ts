// Zod schemas describing the exact return shape of each shaper in ./format.ts
// (and, where the shape is shared, ./formatOfficial.ts). Used two ways: as a
// tool's `outputSchema` (MCP structured content, SEP-2106), and — schema-first —
// by the paired shaper itself, which builds its result and runs it through
// `<name>Schema.parse()` before returning. A shaper that drifts from its schema
// throws immediately at the source instead of silently disagreeing with two
// independently-maintained files.
//
// Every object is `.strict()`: a shaper that starts returning a field this file
// doesn't know about must fail validation instead of silently dropping the
// extra key. `.optional()` marks a field that can be a genuinely absent key —
// either because format.ts's `clean()` dropped an undefined/empty-array value,
// or because the raw upstream field itself was never guaranteed present.
import { z } from "zod";

// ---- shared sub-shapes -------------------------------------------------------

// {mal_id, title, url} reference triple, used by favorites (no vote count).
// mal_id is required: it's the real MAL id of an existing anime/manga/character/person record,
// and every one of these entries exists specifically so a caller can chain it into get_anime/
// get_manga/get_character/get_person — a shaper that ever drops it should fail loudly, not
// silently ship an unusable entry (see the mal_id-required note in ../__tests__/format.test.ts).
const refEntrySchema = z
  .object({
    mal_id: z.number(),
    title: z.string().optional(),
    url: z.string().optional(),
  })
  .strict();

// {mal_id, title, votes, url}, used by summarizeRecommendations and
// summarizeOfficialRecommendations — a ref plus its vote count. mal_id required — see
// refEntrySchema's comment above; these entries exist to be chained into get_anime/get_manga.
export const recommendationEntrySchema = z
  .object({
    mal_id: z.number(),
    title: z.string().optional(),
    votes: z.number().optional(),
    url: z.string().optional(),
  })
  .strict();

// A {relation, entries} group, as produced by both Jikan's grouped `relations`
// and the official-API fallback's groupRelations().
const relationSchema = z
  .object({
    relation: z.string().optional(),
    entries: z.array(z.string()).optional(),
  })
  .strict();

// ---- pageInfo() ---------------------------------------------------------------

// Also covers officialReads.ts's own inline `{ has_next_page }` page object —
// every field here is optional, so that subset satisfies this schema too.
export const pageSchema = z
  .object({
    current_page: z.number().optional(),
    has_next_page: z.boolean().optional(),
    last_visible_page: z.number().optional(),
    total: z.number().optional(),
  })
  .strict();

/** The `outputSchema` for any tool whose client wraps a list as `{results, page}`. */
export function listPageSchema<T extends z.ZodTypeAny>(item: T) {
  return z
    .object({
      results: z.array(item),
      page: pageSchema,
    })
    .strict();
}

// ---- summarizeAnime / summarizeManga (+ official-fallback equivalents) -------

export const animeSummarySchema = z
  .object({
    mal_id: z.number(),
    title: z.string().optional(),
    title_english: z.string().optional(),
    type: z.string().optional(),
    episodes: z.number().optional(),
    status: z.string().optional(),
    airing: z.boolean().optional(),
    score: z.number().optional(),
    rank: z.number().optional(),
    popularity: z.number().optional(),
    members: z.number().optional(),
    year: z.number().optional(),
    season: z.string().optional(),
    rating: z.string().optional(),
    aired: z.string().optional(),
    genres: z.array(z.string()).optional(),
    themes: z.array(z.string()).optional(),
    demographics: z.array(z.string()).optional(),
    studios: z.array(z.string()).optional(),
    synopsis: z.string().optional(),
    url: z.string().optional(),
    image_url: z.string().optional(),
    broadcast: z.string().optional(),
  })
  .strict();

const streamingEntrySchema = z
  .object({ name: z.string().optional(), url: z.string().optional() })
  .strict();

// summarizeAnime(detailed: true) and summarizeOfficialAnimeDetailed both build
// this shape — the official fallback simply never populates the fields it has
// no upstream equivalent for (producers/licensors/streaming/themes/trailer/
// favorites — see formatOfficial.ts's comment), which this schema's optionality
// already allows.
export const animeDetailSchema = animeSummarySchema
  .extend({
    title_japanese: z.string().optional(),
    source: z.string().optional(),
    duration: z.string().optional(),
    scored_by: z.number().optional(),
    favorites: z.number().optional(),
    background: z.string().optional(),
    producers: z.array(z.string()).optional(),
    licensors: z.array(z.string()).optional(),
    streaming: z.array(streamingEntrySchema).optional(),
    opening_themes: z.array(z.string()).optional(),
    ending_themes: z.array(z.string()).optional(),
    trailer: z.string().optional(),
    relations: z.array(relationSchema).optional(),
  })
  .strict();

export const mangaSummarySchema = z
  .object({
    mal_id: z.number(),
    title: z.string().optional(),
    title_english: z.string().optional(),
    type: z.string().optional(),
    chapters: z.number().optional(),
    volumes: z.number().optional(),
    status: z.string().optional(),
    score: z.number().optional(),
    rank: z.number().optional(),
    popularity: z.number().optional(),
    members: z.number().optional(),
    published: z.string().optional(),
    genres: z.array(z.string()).optional(),
    themes: z.array(z.string()).optional(),
    demographics: z.array(z.string()).optional(),
    authors: z.array(z.string()).optional(),
    synopsis: z.string().optional(),
    url: z.string().optional(),
    image_url: z.string().optional(),
  })
  .strict();

// summarizeManga(detailed: true) and summarizeOfficialMangaDetailed both build
// this shape — see animeDetailSchema's comment for the same official-fallback
// field-coverage caveat (here: no serializations-equivalent gap, but the same
// "absent rather than approximated" principle).
export const mangaDetailSchema = mangaSummarySchema
  .extend({
    title_japanese: z.string().optional(),
    publishing: z.boolean().optional(),
    scored_by: z.number().optional(),
    favorites: z.number().optional(),
    background: z.string().optional(),
    serializations: z.array(z.string()).optional(),
    relations: z.array(relationSchema).optional(),
  })
  .strict();

// ---- summarizeCharacters -------------------------------------------------------

// mal_id required — get_character's own description points here ("Obtain the mal_id from
// search_characters or get_anime_characters"); see refEntrySchema's comment above.
export const characterEntrySchema = z
  .object({
    mal_id: z.number(),
    name: z.string().optional(),
    role: z.string().optional(),
    url: z.string().optional(),
    voice_actors: z.array(z.string()).optional(),
  })
  .strict();

export const charactersSchema = z.object({ characters: z.array(characterEntrySchema) }).strict();

// ---- summarizeRecommendations (+ summarizeOfficialRecommendations) -----------

export const recommendationsSchema = z
  .object({ recommendations: z.array(recommendationEntrySchema) })
  .strict();

// ---- summarizeReviews -----------------------------------------------------------

const reviewEntrySchema = z
  .object({
    user: z.string().optional(),
    score: z.number().optional(),
    tags: z.array(z.string()),
    date: z.string().optional(),
    review: z.string().optional(),
    url: z.string().optional(),
  })
  .strict();

export const reviewsSchema = z.object({ reviews: z.array(reviewEntrySchema) }).strict();

// ---- summarizeEpisodes -----------------------------------------------------------

const episodeEntrySchema = z
  .object({
    mal_id: z.number().optional(),
    title: z.string().optional(),
    title_japanese: z.string().optional(),
    aired: z.string().optional(),
    score: z.number().optional(),
    filler: z.boolean().optional(),
    recap: z.boolean().optional(),
  })
  .strict();

export const episodesSchema = z
  .object({ episodes: z.array(episodeEntrySchema), page: pageSchema })
  .strict();

// ---- summarizeGenres -----------------------------------------------------------

// mal_id required — this is exactly the numeric ID search_anime/search_manga's own `genres`
// param expects (validated there against \d+(,\d+)* — see tools/read.ts's genreIds()); see
// refEntrySchema's comment above.
const genreEntrySchema = z
  .object({
    mal_id: z.number(),
    name: z.string().optional(),
    count: z.number().optional(),
    url: z.string().optional(),
  })
  .strict();

export const genresSchema = z.object({ genres: z.array(genreEntrySchema) }).strict();

// ---- summarizeUser -----------------------------------------------------------

export const userSchema = z
  .object({
    username: z.string().optional(),
    url: z.string().optional(),
    joined: z.string().optional(),
    location: z.string().optional(),
    gender: z.string().optional(),
    last_online: z.string().optional(),
    about: z.string().optional(),
    // Jikan's own statistics blob is deliberately left unmodeled (see RawUser) —
    // a large, rarely-consumed nested object not worth mirroring field-by-field.
    statistics: z.unknown().optional(),
  })
  .strict();

// ---- summarizeFavorites -----------------------------------------------------------

export const favoritesSchema = z
  .object({
    anime: z.array(refEntrySchema),
    manga: z.array(refEntrySchema),
    characters: z.array(refEntrySchema),
    people: z.array(refEntrySchema),
  })
  .strict();

// ---- summarizeCharacter / summarizePerson -------------------------------------

// mal_id required — an anime/manga a character/person appears in, meant to chain into
// get_anime/get_manga; see refEntrySchema's comment above.
export const creditEntrySchema = z
  .object({
    role: z.string().optional(),
    position: z.string().optional(),
    mal_id: z.number(),
    title: z.string().optional(),
  })
  .strict();

// mal_id required — this is exactly what get_person's description points to as the mal_id
// source for get_anime_characters' names-only voice_actors; see refEntrySchema's comment above.
export const voiceActorEntrySchema = z
  .object({
    language: z.string().optional(),
    mal_id: z.number(),
    name: z.string().optional(),
  })
  .strict();

// mal_id required — it's this entity's own get_character lookup key; see refEntrySchema's
// comment above.
export const characterEntitySchema = z
  .object({
    mal_id: z.number(),
    name: z.string().optional(),
    name_kanji: z.string().optional(),
    nicknames: z.array(z.string()).optional(),
    favorites: z.number().optional(),
    about: z.string().optional(),
    url: z.string().optional(),
    image_url: z.string().optional(),
    anime: z.array(creditEntrySchema).optional(),
    manga: z.array(creditEntrySchema).optional(),
    voice_actors: z.array(voiceActorEntrySchema).optional(),
  })
  .strict();

const voiceRoleEntrySchema = z
  .object({
    role: z.string().optional(),
    character: z.string().optional(),
    anime: z.string().optional(),
  })
  .strict();

// mal_id required — it's this entity's own get_person lookup key; see refEntrySchema's
// comment above.
export const personEntitySchema = z
  .object({
    mal_id: z.number(),
    name: z.string().optional(),
    given_name: z.string().optional(),
    family_name: z.string().optional(),
    alternate_names: z.array(z.string()).optional(),
    birthday: z.string().optional(),
    favorites: z.number().optional(),
    about: z.string().optional(),
    url: z.string().optional(),
    image_url: z.string().optional(),
    anime: z.array(creditEntrySchema).optional(),
    manga: z.array(creditEntrySchema).optional(),
    voice_roles: z.array(voiceRoleEntrySchema).optional(),
  })
  .strict();

// ---- summarizeStaff -----------------------------------------------------------

// mal_id required — meant to chain into get_person; see refEntrySchema's comment above.
export const staffEntrySchema = z
  .object({
    mal_id: z.number(),
    name: z.string().optional(),
    positions: z.array(z.string()).optional(),
    url: z.string().optional(),
  })
  .strict();

export const staffSchema = z.object({ staff: z.array(staffEntrySchema) }).strict();

// ---- summarizeStatistics (+ summarizeOfficialAnimeStatistics) -----------------

const scoreEntrySchema = z
  .object({
    score: z.number().optional(),
    votes: z.number().optional(),
    percentage: z.number().optional(),
  })
  .strict();

// The official-API fallback only ever populates watching/completed/on_hold/
// dropped/plan_to_watch/total (see summarizeOfficialAnimeStatistics) — a subset
// of what Jikan can return, which this schema's optionality already allows.
export const statisticsSchema = z
  .object({
    watching: z.number().optional(),
    completed: z.number().optional(),
    on_hold: z.number().optional(),
    dropped: z.number().optional(),
    plan_to_watch: z.number().optional(),
    reading: z.number().optional(),
    plan_to_read: z.number().optional(),
    total: z.number().optional(),
    scores: z.array(scoreEntrySchema).optional(),
  })
  .strict();

// ---- summarizeProducer -----------------------------------------------------------

// mal_id required — the studio/producer's own canonical Jikan ID; see refEntrySchema's
// comment above.
export const producerSchema = z
  .object({
    mal_id: z.number(),
    name: z.string().optional(),
    count: z.number().optional(),
    favorites: z.number().optional(),
    established: z.string().optional(),
    url: z.string().optional(),
    image_url: z.string().optional(),
  })
  .strict();

// ---- summarizeSeasonsList -----------------------------------------------------------

// year required — get_seasons_list's own description says its whole purpose is picking a
// valid `year` argument for get_seasonal_anime; an entry missing it can't serve that purpose.
// Same reasoning as mal_id in the entity schemas above.
export const seasonEntrySchema = z
  .object({ year: z.number(), seasons: z.array(z.string()) })
  .strict();

export const seasonsListSchema = z.object({ seasons: z.array(seasonEntrySchema) }).strict();

// ---- summarizeNewsItem -----------------------------------------------------------

export const newsItemSchema = z
  .object({
    mal_id: z.number().optional(),
    title: z.string().optional(),
    date: z.string().optional(),
    author: z.string().optional(),
    comments: z.number().optional(),
    excerpt: z.string().optional(),
    url: z.string().optional(),
  })
  .strict();

// ---- clients/mal.ts's trimList()/deleteMy*ListItem() outputs -----------------
//
// Unlike MyUserInfoSchema/MalListResponseSchema/ListStatusUpdateResponseSchema (which stay in
// clients/mal.ts and are deliberately .passthrough() — they validate raw upstream responses
// forwarded near-verbatim), these describe already-shaped/client-synthesized output, so — same
// rule as every other schema in this file — they're .strict() and live here, not in mal.ts.

// mal_id required — it's the anime_id/manga_id update_my_anime_status/update_my_manga_status
// and delete_my_anime_list_item/delete_my_manga_list_item expect; see refEntrySchema's
// comment above.
export const myListItemSchema = z
  .object({
    mal_id: z.number(),
    title: z.string().optional(),
    // Loose on purpose: anime and manga list_status differ (num_episodes_watched vs
    // num_chapters_read/num_volumes_read, is_rewatching vs is_rereading, …) and MAL may add
    // fields later — this only confirms it's an object, not a bare array/string/null.
    list_status: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

/** The outputSchema for get_my_anime_list / get_my_manga_list (clients/mal.ts's trimList()). */
export const myListSchema = z
  .object({ items: z.array(myListItemSchema), has_next_page: z.boolean() })
  .strict();

/** The outputSchema for delete_my_anime_list_item / delete_my_manga_list_item. */
export const deleteAnimeItemSchema = z
  .object({ deleted: z.literal(true), anime_id: z.number() })
  .strict();
export const deleteMangaItemSchema = z
  .object({ deleted: z.literal(true), manga_id: z.number() })
  .strict();
