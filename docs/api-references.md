# Upstream API references

Authoritative documentation for the two upstream APIs this server uses. Verify
behaviour against these before changing the clients. The pages render via
JavaScript, so a plain HTTP fetch returns only the title — open them in a browser
(or a headless browser tool).

## Tenrai — read backend (`src/clients/tenrai.ts`)

- **API reference** — <https://tenrai.org/documentation> (interactive Scalar
  docs); a machine-readable summary lives at <https://api.tenrai.org/llms.txt>.
  A full OpenAPI 3.0.3 spec (86 paths, every query param/enum/response shape) is
  cached locally at `notes/tenrai-openapi-spec.json` (gitignored, not
  committed — see `notes/tenrai-reliability.md` for the same local-notes
  convention) for fast programmatic lookup (e.g. `python3 -c "import json;
json.load(open('notes/tenrai-openapi-spec.json'))..."`) instead of re-fetching
  the JS-rendered docs page every time. It's a point-in-time snapshot (fetched
  2026-07-30) — Tenrai describes `/v1` as an interim design with a `/v2` planned,
  so re-fetch and refresh this file before trusting it against a claim it
  doesn't already back up in this doc.
  - **Rate limiting:** 4 requests/second **and** 120 requests/minute for
    public (unauthenticated) access, 40,000/day. Enforced client-side by the
    sliding-window `RateLimiter`. An optional `X-Server-Key` (Patreon-gated)
    raises this to 5 req/s / 300 req/min with its own separate cache — not
    currently used by mal-mcp.
  - **HTTP responses:** `200`, `404`, `429` (with a `Retry-After` header —
    verified live), `5xx` for a genuine outage.
  - **Error body:** `{ status, type, message, error, path }` — `http.ts`
    surfaces `message`. (`report_url` isn't populated by Tenrai; the parser
    tolerates its absence.)
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
    OpenAPI spec (`api-1.json`/`api-1.yaml`, v1.0.17, 86 paths) and `api.tenrai.org/llms.txt`:
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

## MyAnimeList official API

Two separate clients use this API, for two unrelated concerns:
`src/clients/mal.ts` (`MalClient`) for OAuth-authenticated personal-list
reads/writes, and `src/clients/officialReads.ts` (`OfficialReadsClient`) for
anonymous Client-ID-only public reads — the fallback for when a Tenrai call
fails. See [auth.md](auth.md) for the three credential tiers (none / Client
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
  - **No server-side content filter at all** — no query param excludes NSFW
    results, and no genre/status/order_by/sort filter exists either (verified
    against the v2 reference — search/ranking/season take only `q`/
    `ranking_type`/`fields`/`limit`/`offset`, nothing else). For `sfw`
    specifically, each anime/manga node carries an `nsfw` field
    (`white`/`gray`/`black`, verified live) that `officialReads.ts` requests
    and filters on client-side (fail-closed: keep only `"white"`) when
    `sfw: true` was requested — the one Tenrai filter the fallback can
    approximate. `genres`/`status`/`order_by`/`sort` have no equivalent at
    all, client-side or otherwise, and are simply unavailable during a
    fallback.
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
