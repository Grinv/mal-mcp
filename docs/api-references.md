# Upstream API references

Authoritative documentation for the two upstream APIs this server uses. Verify
behaviour against these before changing the clients. The pages render via
JavaScript, so a plain HTTP fetch returns only the title — open them in a browser
(or a headless browser tool).

## Tenrai — read backend (`src/clients/tenrai.ts`)

- **API reference** — <https://tenrai.org/documentation> (interactive Scalar
  docs); a machine-readable summary lives at <https://api.tenrai.org/llms.txt>.
  The full OpenAPI 3.0.3 spec is served at
  <https://api.tenrai.org/documentation/openapi.json> (v1.0.24, 101 paths as of 2026-10-21);
  a copy is cached locally at `notes/tenrai-openapi-spec.json` (gitignored, not
  committed — see `notes/tenrai-reliability.md` for the same local-notes
  convention) for fast programmatic lookup (e.g. `python3 -c "import json;
json.load(open('notes/tenrai-openapi-spec.json'))..."`) instead of re-fetching
  the JS-rendered docs page every time. It's a point-in-time snapshot (the local copy
  was fetched 2026-07-30 at v1.0.19 — re-download it from the URL above) — Tenrai describes `/v1` as an interim design with a `/v2` planned,
  so re-fetch and refresh this file before trusting it against a claim it
  doesn't already back up in this doc.
  - **Rate limiting:** 4 requests/second **and** 120 requests/minute for
    public (unauthenticated) access; llms.txt now lists the daily cap as unlimited (it
    was 40,000/day). `304 Not Modified` responses count toward the limit, and a
    persistent `403` means Tenrai's anti-abuse block tripped (clears within 24h).
    Enforced client-side by the
    sliding-window `RateLimiter`. An optional `X-Server-Key` (Patreon-gated)
    raises this to 5 req/s / 300 req/min with its own separate cache — not
    currently used by mal-mcp.
  - **HTTP responses:** `200`, `404`, `429` (with a `Retry-After` header —
    verified live), `5xx` for a genuine outage.
  - **Error body:** `{ status, type, message, error, path }` — `http.ts`
    surfaces `message`.
  - **Schema compatibility:** Tenrai's `/v1/*` routes return a response shape
    (top-level `data`/`pagination`, nested `{mal_id,url,images,...}` entities)
    that already matched every `Raw*` interface in `format.ts` field-for-field
    (verified live 2026-07-30 across anime/manga search and detail,
    characters, people, producers, genres, seasons, schedules,
    recommendations, reviews, statistics, news, and random) — this server's
    shapers required zero changes when the read backend moved onto Tenrai.
  - **Two distinct content filters, not one:** `sfw` excludes adult/explicit-
    rated entries (R+ Mild Nudity, Rx); `sfw-strict` (hyphenated query param —
    `tenrai.ts` maps our `sfw_strict` field onto it) additionally excludes
    anything tagged with the Ecchi genre. Verified live 2026-07-30: querying
    the Ecchi genre (id 9) with `sfw=true` still returned mainstream,
    safely-rated titles (_No Game No Life_, _Kill la Kill_, _Shokugeki no
    Souma_); the same query with `sfw-strict=true` returned zero results.
    `sfw`/`sfw-strict` are documented as plain `type: string` in Tenrai's
    OpenAPI spec (no enum) — sent as the literal strings `"true"`/`"false"`.
  - **`sfw`/`sfw-strict` also filter nested lists on by-id lookups**, not just
    top-level search results (verified live 2026-07-31). The requested entity
    itself is always returned; NSFW/Ecchi entries are dropped from its nested
    lists. `get_anime`/`get_manga` drop the whole `relations` key (High School
    DxD's `relations` vanished under `sfw_strict`); `get_character`/`get_person`
    drop the `anime`/`manga` appearance/credit lists (Rias Gremory's appearances
    vanished; Youko Hikasa's anime credits fell 55→36 under `sfw_strict`);
    `get_anime_news`/`get_manga_news` cut the article list down but not to zero
    (DxD 8→3 news, its manga 24→3 under `sfw`). Note the earlier "sfw empties an
    NSFW anime's news entirely" reading was wrong: a hentai-rated title (e.g.
    Bible Black) simply has no news to begin with, so the empty result was
    baseline-empty, not filter-emptied. The filter works per article.
  - **`/anime/{id}/episodes` pages at 100 per page** (verified live 2026-08-01):
    One Piece (id 21) returned exactly 100 episodes on page 1 with
    `has_next_page: true` and `last_visible_page: 12`. This backs
    `get_anime_episodes`'s "~100 per page" description; the client itself sets no
    per-page limit (it only forwards `page`), so the size is Tenrai's own.
  - **No user-data endpoints** (confirmed via `api.tenrai.org/llms.txt`): no
    `/users`, `/watch`, or `/clubs` routes exist — the operators state all
    data is pre-cached from MAL's public catalogue, which rules out
    per-request user-profile lookups. This is why `get_user_profile`/
    `get_user_favorites` were removed rather than migrated when the backend
    changed — there is no replacement, official-API or otherwise (the
    official API's own "Get my user information" only covers `@me` via
    OAuth).
  - **Beta status, self-declared**: the operators describe `/v1` as an
    interim bridge toward a `/v2` design, with occasional downtime expected.
  - **Full query-param audit (2026-07-30)**, cross-checked against the maintainer's local
    OpenAPI spec (then v1.0.17, 86 paths; now v1.0.19, 92 paths) and `api.tenrai.org/llms.txt`:
    `type` and `rating` on `/anime`, `/manga`, `/top/anime`, `/top/manga` and the seasonal
    (`filter`) endpoints are OpenAPI `array` params with `style: form, explode: false` — sent as
    one comma-joined query value (`type=tv,movie`), not repeated keys; `mal-mcp` previously
    exposed only a single value for several of these (fixed). `/anime|manga/{id}/reviews`
    (unlike the paginated collection routes) has real `sort`/`preliminary`/`spoilers`/
    `sentiment` params — `preliminary`/`spoilers` are tri-state (`true`/`false`/`only`), not
    plain booleans. Manga reviews carry `chapters_read`, anime reviews carry
    `episodes_watched` — never both on the same item, despite sharing one response schema.
    Every comma-separated ID list (`genres`, `genres_exclude`, `producers`, `magazines`) caps
    at 25 IDs per Tenrai's own docs.
  - **Interest Stacks (2026-08-24)**, against the v1.0.19 spec: `/stacks`, `/stacks/{id}` and
    `/anime|manga/{id}/stacks` (new in Tenrai 1.0.18) are exposed as
    `get_interest_stacks`/`get_interest_stack`/`get_anime_interest_stacks`/
    `get_manga_interest_stacks`. These are the one MAL data source that is human-curated rather
    than vote- or score-derived, which is why they earned tools while the other 1.0.16-1.0.19
    additions (featured articles, entity picture galleries, the episode forum, `/top/reviews`,
    the deleted-entry lists) did not yet. Field set follows the spec rather than a sample
    response: the entry shape includes `volumes`/`published_from_year` for manga stacks alongside
    `episodes`/`aired_from_year` for anime ones. Verified live 2026-08-24 end-to-end through the
    MCP protocol. No official-API equivalent exists, so none of the four falls back.
  - **Recovered fields (2026-08-24)**: `relations` used to be flattened to bare titles, so an
    agent could see that a franchise entry existed but not open it — the entries now carry
    `mal_id`/`type`/`media_type`, and the official-API fallback's `groupRelations()` was widened
    to match. `get_manga`'s `moreinfo` (added upstream in the 1.0.19 spec), `favorites` on
    manga character entries, `duration`/`synopsis`/`replies`/`image_url` on episodes (Tenrai
    1.0.10 and 1.0.16), and `duration`/`published_at`/`comment_count` on video clips (1.0.12)
    were all being returned by Tenrai and dropped on the floor here. `dislikes`,
    `privacy_status`, `embeddable` and `region_restriction` are deliberately still dropped:
    YouTube no longer publishes dislike counts meaningfully, and the rest describe playback
    policy rather than the video.
  - **Endpoint-coverage sweep (2026-07-30)**, against the same local spec: `get_magazines`,
    `get_producer` (single-producer detail — `/producers/{id}/full`'s `about`/`external` fields
    had no tool at all before), `get_anime_videos` (`/anime/{id}/videos`), the site-wide
    `get_recent_anime_recommendations`/`get_recent_manga_recommendations`
    (`/recommendations/anime|manga`), and `get_news` (`/news`) were added to close real gaps —
    endpoints Tenrai documents that this server didn't expose any tool for. Verified live
    2026-07-30 against the real API (a fresh build, not the pre-session stdio process): all five
    return real data end-to-end, and `get_anime`/`get_manga`'s new `external`/`title_synonyms`
    fields are populated live too — `moreinfo` specifically reproduced the exact "Suggested Order
    of Viewing" text for Cowboy Bebop (mal_id 1) that the OpenAPI spec's own example shows.
    `explicit_genres` stayed empty on every title tried (including one MAL tags "Ecchi" in its
    plain `genres`, not `explicit_genres`) — plausibly a real, rarely-populated field rather than
    a mapping bug, but not independently confirmed non-empty on any title. `get_news`'s `q` param
    genuinely filters (a nonsense query returns 0 results) but matches more than the visible
    headline — a query like "Dragon Ball" returns articles whose titles don't contain the phrase.
  - **Limits and filters as of v1.0.24 (verified live 2026-10-21)**:
    - `page` is capped at **20000 on every route**, top lists included (`page=20001` → 400
      "Page must be 20000 or lower"; `/producers?page=1001` → 200). This replaced the old
      1000-page ceiling and the top lists' former "no ceiling", so `read.ts` has one `page`
      constant (1-20000).
    - `limit` is capped at **100 on every `limit`-taking list route** (`limit=101` → 400), up
      from 50. Checked on `/anime`, `/manga`, `/characters`, `/people`, `/top/*`, `/seasons/*`,
      `/schedules`, `/producers`, `/news`, `/stacks`, `/anime/{id}/stacks` and
      `/recommendations/anime`. `read.ts` has one `limit` constant (1-100).
    - Routes with **no `limit` at all**, where any cap has to be applied client-side:
      `/{anime|manga}/{id}/reviews` (fixed 20 per page — `get_*_reviews` caps its own `limit`
      at 20 and returns Tenrai's `page` info for that 20-review page), `/anime/{id}/episodes` (100 per page), `/anime/{id}/news` (30 per page),
      `/{anime|manga}/{id}/recommendations` (all entries, unpaginated — 166 for id 1),
      `/{anime|manga}/{id}/characters` (no language filter either: `language=Japanese` is
      ignored), `/people/{id}/full` and `/people/{id}/voices` (the latter ignores `limit`/`page`,
      512 roles for id 118). These are why `format.ts` still trims recommendations, voice
      roles and staff credits itself.
    - `letter` **cannot be combined with `q`** on `/anime`/`/manga` (400 "The letter query
      parameter cannot be combined with q"); on `/characters`/`/people` the two combine fine.
      `search_anime`/`search_manga` therefore make `q` optional and reject `q`+`letter`.
    - `q` is capped at 300 characters on every route (301 → 400); every `q`
      field in `read.ts` carries `.max(300)`.
    - `sort` only applies together with `order_by` — on its own it's ignored (identical order
      for `sort=asc`/`desc`).
    - `unapproved` is tri-state `true`/`false`/`only` on `/anime`, `/manga`, `/seasons/*`,
      `/schedules` (`only` → exclusively `approved: false` entries).
    - `start_date`/`end_date` accept `YYYY` and `YYYY-MM` as well as `YYYY-MM-DD`.
    - `sfw`/`sfw-strict` now also apply to `/news` (16001 → 14627 → 13985 items) and
      `/genres/anime|manga` (78 → 76 → 75 anime genres).
    - Review `spoilers`/`preliminary` and stack `spoilers`/`challenges`/`official` are
      **excluded by default** — `true` widens the set (`/stacks` 19761 → 22466 with
      `spoilers=true`).
      One exception (verified live 2026-10-22): under `official=only`, challenge stacks
      are still included unless `challenges=false` is sent too (77 vs 59 results), so the
      stack tools send `challenges=false` when it's omitted. `official` is left unset:
      every challenge stack is also official, so defaulting it to `false` would empty
      `challenges=only` (18 vs 0).
    - Endpoints added since v1.0.19 and not wrapped yet: `/seasons/previous`, `/manga/adapted`,
      `/{anime|manga}/{id}/statistics/history`, `/manga/{id}/forum`, and the
      `/{anime|manga}/unapproved|denied` moderation queues. Still unwrapped from earlier
      releases: site-wide `/reviews/anime|manga`, `/top/reviews`, articles, `/news/tags`.
    - Every response carries an `ETag` and `If-None-Match` is honored (not used by mal-mcp).

## MyAnimeList official API

Two separate clients use this API, for two unrelated concerns:
`src/clients/mal.ts` (`MalClient`) for OAuth-authenticated personal-list
reads/writes, and `src/clients/officialReads.ts` (`OfficialReadsClient`) for
anonymous Client-ID-only public reads — the fallback for when a Tenrai call
fails with a genuine upstream fault (5xx, timeout, connection error, 429,
invalid JSON, or a 200 with no `data`; a real 404/400 is an answer, not an outage, and is never
retried here). See [auth.md](auth.md) for the three credential tiers (none / Client
ID / OAuth token) and exactly what each one unlocks.

> **Why reads default to Tenrai, not this API.** This API can serve public
> data without OAuth via an `X-MAL-CLIENT-ID` header, but that still requires
> a registered MAL application (a Client ID) — our read tools must work with
> **zero credentials**, so Tenrai (which needs none) is the default. Also, the
> official character/people endpoints are explicitly undocumented and
> off-limits ("don't use them"), so that data comes from Tenrai regardless.
> `OfficialReadsClient` is additive, not a default change: with no
> `MAL_CLIENT_ID` configured, every read tool behaves exactly as if it didn't
> exist. It covers eleven tools, gated purely by what the official API
> happens to expose an equivalent for, not by anything Tenrai-specific:
> `search_anime`, `search_manga`, `get_top_anime`, `get_top_manga`,
> `get_seasonal_anime`, `get_upcoming_season` map onto the official search/
> ranking/season endpoints; `get_anime_recommendations`/
> `get_manga_recommendations` map onto a `recommendations` field on
> `GET /anime/{anime_id}` / `GET /manga/{manga_id}` (`client_auth: -` —
> Client-ID-only, same tier as the other six; items are
> `{node: {id,title,main_picture}, num_recommendations}`, verified live
> against myanimelist.net/apiconfig/references/api/v2). It's fetched as a
> single extra field on the details endpoint, not a separate ranked
> collection, so ordering/ties vs. Tenrai's own vote count aren't guaranteed
> to match exactly. `get_anime`/`get_manga` also fall back onto that same
> `GET /anime|manga/{id}` endpoint with a wider `fields` list — the official
> API covers most of Tenrai's `detailed: true` extras (title_japanese, source,
> duration, broadcast, background, relations, scored_by) but has **no**
> equivalent at all for `producers`/`licensors`/`streaming`/
> `opening_themes`/`ending_themes`/`trailer`/`favorites`/`moreinfo` (anime-only
> to begin with)/`explicit_genres`/`external`, which are simply absent during
> that fallback (see `summarizeOfficialAnimeDetailed`/
> `summarizeOfficialMangaDetailed` in `lib/formatOfficial.ts`). `title_synonyms`
> IS covered during a fallback — the bare `alternative_titles` field already
> returns `synonyms` alongside `en`/`ja` with no extra `fields=` cost (verified
> live). `get_anime_statistics`
> falls back too — `AnimeForDetails.statistics` (`fields=statistics` on the same
> endpoint) gives the watch-status counts (`watching`/`completed`/`on_hold`/
> `dropped`/`plan_to_watch`/`num_list_users`), but has **no** score-distribution
> histogram at all, so `scores` is simply absent during that fallback.
> Two gaps apply to **every** fallback-eligible anime/manga tool, list and
> detail alike: the official API returns one flat `genres` array with no
> themes/demographics split, so `themes` and `demographics` always come back
> empty (`ANIME_LIST_FALLBACK_GAPS`/`MANGA_LIST_FALLBACK_GAPS`, folded into
> `*_DETAIL_FALLBACK_GAPS_FULL` for the detail tools). `broadcast` differs by
> mode: absent from a list fallback, which never requests it, but present in
> `get_anime`'s detail fallback, which asks for it explicitly.
> The fields both backends do carry are reshaped to read like Tenrai's:
> `media_type`/`rating` map onto Tenrai's labels (`tv` → `TV`, `r` →
> `R - 17+ (violence & profanity)`; MAL's `unknown` placeholder is omitted), and
> `aired`/`published` are rebuilt from `start_date`/`end_date` in Tenrai's
> format (`Apr 3, 1998 to Apr 24, 1999`; `X to ?` with no end date; a single
> date when the end equals the start, or for a one-episode anime or a one-shot).
> `get_manga_statistics` has no equivalent whatsoever — `MangaForDetails` carries
> no `statistics` property — so it stays fully Tenrai-only. Every other read tool
> (reviews, schedule, producers, news, episodes, genres, random
> picks, everything character/people) has **no** official-API equivalent at
> all — verified live, not assumed — so there's nothing to fall back to there
> regardless of Client ID.

- **API v2 reference** (endpoints, `fields` param, `my_list_status` update/delete) —
  <https://myanimelist.net/apiconfig/references/api/v2>
  - Update accepts `PATCH` (the curl examples use `PUT`; both work).
  - Response field is `num_episodes_watched`; the update param is
    `num_watched_episodes` (intentionally different).
  - **`DELETE .../my_list_status` is idempotent regardless of prior
    existence** (verified live 2026-07-27, both anime and manga): calling
    delete on an id that was never on the list returns the same success as
    deleting a real entry — no 404, no distinguishing signal either way.
    `deleteMyAnimeListItem`/`deleteMyMangaListItem` (`clients/mal.ts`)
    return `{deleted: true}` unconditionally once MAL accepts the request,
    so that field is not proof something existed — disclosed in
    `delete_my_anime_list_item`/`delete_my_manga_list_item`'s descriptions.
  - **`ranking_type` enums** (for `officialReads.ts`'s top-anime/top-manga
    fallback): anime — `all, airing, upcoming, tv, ova, movie, special,
bypopularity, favorite` (no `ona`/`music`, unlike Tenrai's `type` filter);
    manga — `all, manga, novels, oneshots, doujin, manhwa, manhua,
bypopularity, favorite`. Both `client_auth (-)` — no OAuth scope needed,
    just the Client ID header.
  - **Season endpoint** (`GET /anime/season/{year}/{season}`) groups months as
    winter=Jan-Mar, spring=Apr-Jun, summer=Jul-Sep, fall=Oct-Dec — matches
    Tenrai's own grouping. There is no "current"/"upcoming" shortcut like
    Tenrai's `seasons/now`/`seasons/upcoming`; the caller computes year+season
    (see `currentSeason`/`nextSeason` in `src/clients/readFallback.ts`).
- **Authorization** (OAuth2 PKCE, token exchange, refresh, lifetimes) —
  <https://myanimelist.net/apiconfig/references/authorization>
  - PKCE uses the **`plain`** method (`code_challenge` == `code_verifier`).
  - We register the app as type **`other`** → a **public (secret-less) client**.
    MAL allows this (docs: "if your client doesn't have a client secret,
    `client_secret` will be empty"), so we send **no `client_secret`** in the
    authorization-code exchange or refresh — verified live 2026-07-09. `web`-type
    apps are confidential and would require the secret; we deliberately don't use
    that model (see [AGENTS.md](../AGENTS.md)).
  - `http://localhost:<port>/callback` is accepted as a Redirect URI (verified
    live), which is what the `login_mal` local callback relies on.
  - Refresh: `grant_type=refresh_token` with `client_id` + `refresh_token` in the
    body (no secret). Refresh tokens rotate and last ~1 month; access tokens ~1
    month in practice (the docs table says "1 hour", but the example `expires_in`
    is ~28d).
- **Forum — getting started / capabilities** — <https://myanimelist.net/forum/?topicid=1973141>
  - The character & people endpoints are **undocumented and off-limits** ("don't
    use them") — that data comes from Tenrai instead.
- **Forum — public data without OAuth** — <https://myanimelist.net/forum/?topicid=1973077>
  - Public endpoints work with just an `X-MAL-CLIENT-ID` header. We still use Tenrai
    for reads so they need **zero** credentials (see the note in
    [AGENTS.md](../AGENTS.md)) — except the `officialReads.ts` fallback below,
    which is opt-in via `MAL_CLIENT_ID`.
  - **Fallback fields** (verified live against `GET /v2/anime` and
    `/v2/manga` with just the Client ID header, no OAuth): only `id`, `title`,
    `main_picture` come back by default — everything else needs an explicit
    `fields=` param. Nested sub-object fields use `field{subfield,subfield}`
    syntax, e.g. `authors{first_name,last_name}` (manga has no author _names_
    without this — the bare `authors` field returns only `{node:{id},role}`).
    `start_season{year,season}` is the only way to get an anime's season/year
    from a search response (there's no separate `season`/`year` top-level field
    like Tenrai has). Pagination is `limit`/`offset` (not Tenrai's `page`).
  - **Filters, ordering and limits (verified live 2026-10-22)**:
    - **`nsfw` param**: search, season _and the user's own list_ return only
      `"white"` entries unless `nsfw=true` is sent ("kanojo" search 57 → 90,
      2024 spring 298 → 345, a real `@me` anime list 118 → 121 — MAL hid three
      gray titles from the owner's own list). `"black"` never showed up even
      with `nsfw=true`. Ranking ignores the param and always includes gray.
      So `officialReads.ts` sends `nsfw=true` unless `sfw` is set and keeps its
      client-side `"white"` check only as a backstop (it still matters for
      ranking); `mal.ts` always sends `nsfw=true` for `@me` lists.
    - **Season `sort`**: only `anime_num_list_users` takes effect (descending);
      `anime_score` returns the same order as no sort, and an unknown value is
      silently ignored. The fallback maps Tenrai's default members-descending
      order onto it; score/start_date/ascending stay unsorted.
    - **List sort**: `anime_id`/`manga_id` (listed as "Under Development" in the
      reference) is rejected with 400 "invalid sort order", so it's not exposed.
    - **`limit` ceilings**: season and ranking 500 (`501` → 400), `@me` lists
      1000 (`1001` → 400 — `get_my_*_list` allows up to 1000); search accepted
      `limit=200` without complaint. mal-mcp's read tools stop at Tenrai's 100.
    - **Search input limits**: `q` must be at least 3 characters (`q=ab` → 400
      "invalid q"), and `offset + limit` must not exceed 100000 (400 past it —
      i.e. beyond page 1000 at `limit=100` during a fallback). Ranking and
      season just return an empty page past their end. `search_*` skip the
      fallback for a missing or 1-2 character `q`.
    - No genre/status/rating/type filter exists on search/ranking/season, so
      those Tenrai filters stay unavailable during a fallback.
    - **Recommendations** (the `recommendations` detail field) come back capped
      at 10 by MAL itself; `recommendations.limit(n)` is ignored. Ranking also
      ignores `nsfw=false`, which is why the client-side `"white"` check stays.
  - **No-match search doesn't return empty** (verified live 2026-07-27, both
    through the fallback and directly against `GET /v2/anime?q=...`): a query
    with no real title match (e.g. a random unmatchable string) comes back
    with a full page of unrelated anime instead of an empty `data` array —
    the same behavior, byte-for-byte identical result set, on repeated calls.
    Not a mal-mcp bug (reproduced with a raw, direct call using only the
    Client ID header, no mal-mcp code involved) — just a real quirk of the
    official search endpoint's own relevance ranking, worth knowing before
    treating a nonsense-query result as a false match.
- **Official sample OAuth2 PKCE flow (Python)** — <https://gitlab.com/-/snippets/2039434>
  - Matches the manual token steps in [auth.md](auth.md).
