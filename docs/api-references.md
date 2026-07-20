# Upstream API references

Authoritative documentation for the two upstream APIs this server uses. Verify
behaviour against these before changing the clients. The pages render via
JavaScript, so a plain HTTP fetch returns only the title — open them in a browser
(or a headless browser tool).

## Jikan — read backend (`src/clients/jikan.ts`)

- **API reference + "Information" section** — <https://docs.api.jikan.moe/>
  - **Rate limiting:** 3 requests/second **and** 60 requests/minute (daily
    unlimited). Enforced client-side by the sliding-window `RateLimiter`.
  - **HTTP responses:** `200`, `304 Not Modified` (ETag cache validation), `400`,
    `404`, `405`, `429`, `500` (may include `report_url`), `503`.
  - **Error body:** `{ status, type, message, error, report_url }` — `http.ts`
    surfaces `message` (+ `report_url`).
  - **Caching:** responses cached 24h upstream; `ETag` + `If-None-Match` supported
    (we use a local TTL cache instead).

## MyAnimeList official API

Two separate clients use this API, for two unrelated concerns:
`src/clients/mal.ts` (`MalClient`) for OAuth-authenticated personal-list
reads/writes, and `src/clients/officialReads.ts` (`OfficialReadsClient`) for
anonymous Client-ID-only public reads — the search/top/seasonal fallback for
when Jikan's live pass-through to MAL is degraded (see
[../notes/jikan-reliability.md](../notes/jikan-reliability.md), gitignored).
See [auth.md](auth.md) for the three credential tiers (none / Client ID /
OAuth token) and exactly what each one unlocks.

> **Why reads default to Jikan, not this API.** This API can serve public data
> without OAuth via an `X-MAL-CLIENT-ID` header, but that still requires a
> registered MAL application (a Client ID) — our read tools must work with
> **zero credentials**, so Jikan (which needs none) is the default. Also, the
> official character/people endpoints are explicitly undocumented and
> off-limits ("don't use them"), so that data comes from Jikan regardless.
> `OfficialReadsClient` is additive, not a default change: with no
> `MAL_CLIENT_ID` configured, every read tool behaves exactly as if it didn't
> exist. It covers six tools — `search_anime`, `search_manga`,
> `get_top_anime`, `get_top_manga`, `get_seasonal_anime`, `get_upcoming_season`
> — because those are Jikan's own live pass-through calls to MAL (not served
> from Jikan's cached DB), so they're the ones exposed to MAL-side flakiness
> (see [../notes/jikan-reliability.md](../notes/jikan-reliability.md)), plus
> `get_anime_recommendations`/`get_manga_recommendations`: not a pass-through,
> but the official API happens to expose the same data as a `recommendations`
> field on `GET /anime/{anime_id}` / `GET /manga/{manga_id}` (`client_auth: -`
> — Client-ID-only, same tier as the other six; items are
> `{node: {id,title,main_picture}, num_recommendations}`, verified live
> against myanimelist.net/apiconfig/references/api/v2). It's fetched as a
> single extra field on the details endpoint, not a separate ranked
> collection, so ordering/ties vs. Jikan's own vote count aren't guaranteed
> to match exactly. `get_anime`/`get_manga` also fall back onto that same
> `GET /anime|manga/{id}` endpoint with a wider `fields` list — the official
> API covers most of Jikan's `detailed: true` extras (title_japanese, source,
> duration, broadcast, background, relations, scored_by) but has **no**
> equivalent at all for `producers`/`licensors`/`streaming`/
> `opening_themes`/`ending_themes`/`trailer`/`favorites`, which are simply
> absent during that fallback (see `summarizeOfficialAnimeDetailed`/
> `summarizeOfficialMangaDetailed` in `lib/formatOfficial.ts`). `get_anime_statistics`
> falls back too — `AnimeForDetails.statistics` (`fields=statistics` on the same
> endpoint) gives the watch-status counts (`watching`/`completed`/`on_hold`/
> `dropped`/`plan_to_watch`/`num_list_users`), but has **no** score-distribution
> histogram at all, so `scores` is simply absent during that fallback.
> `get_manga_statistics` has no equivalent whatsoever — `MangaForDetails` carries
> no `statistics` property — so it stays fully Jikan-only. Every other read tool
> (reviews, user profiles, schedule, producers, news, episodes, genres, random
> picks, everything character/people) has **no** official-API equivalent at
> all — verified live, not assumed — so there's nothing to fall back to there
> regardless of Client ID.

- **API v2 reference** (endpoints, `fields` param, `my_list_status` update/delete) —
  <https://myanimelist.net/apiconfig/references/api/v2>
  - Update accepts `PATCH` (the curl examples use `PUT`; both work).
  - Response field is `num_episodes_watched`; the update param is
    `num_watched_episodes` (intentionally different).
  - **`ranking_type` enums** (for `officialReads.ts`'s top-anime/top-manga
    fallback): anime — `all, airing, upcoming, tv, ova, movie, special,
bypopularity, favorite` (no `ona`/`music`, unlike Jikan's `type` filter);
    manga — `all, manga, novels, oneshots, doujin, manhwa, manhua,
bypopularity, favorite`. Both `client_auth (-)` — no OAuth scope needed,
    just the Client ID header.
  - **Season endpoint** (`GET /anime/season/{year}/{season}`) groups months as
    winter=Jan-Mar, spring=Apr-Jun, summer=Jul-Sep, fall=Oct-Dec — matches
    Jikan's own grouping. There is no "current"/"upcoming" shortcut like
    Jikan's `seasons/now`/`seasons/upcoming`; the caller computes year+season
    (see `currentSeason`/`nextSeason` in `src/clients/jikan.ts`).
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
    use them") — that data comes from Jikan instead.
- **Forum — public data without OAuth** — <https://myanimelist.net/forum/?topicid=1973077>
  - Public endpoints work with just an `X-MAL-CLIENT-ID` header. We still use Jikan
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
    like Jikan has). Pagination is `limit`/`offset` (not Jikan's `page`).
  - **No server-side content filter at all** — no query param excludes NSFW
    results, and no genre/status/order_by/sort filter exists either (verified
    against the v2 reference — search/ranking/season take only `q`/
    `ranking_type`/`fields`/`limit`/`offset`, nothing else). For `sfw`
    specifically, each anime/manga node carries an `nsfw` field
    (`white`/`gray`/`black`, verified live) that `officialReads.ts` requests
    and filters on client-side (fail-closed: keep only `"white"`) when
    `sfw: true` was requested — the one Jikan filter the fallback can
    approximate. `genres`/`status`/`order_by`/`sort` have no equivalent at
    all, client-side or otherwise, and are simply unavailable during a
    fallback (see `notes/jikan-reliability.md`).
- **Official sample OAuth2 PKCE flow (Python)** — <https://gitlab.com/-/snippets/2039434>
  - Matches the manual token steps in [auth.md](auth.md).
