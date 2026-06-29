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

## MyAnimeList official API — personal-list backend (`src/clients/mal.ts`)

- **API v2 reference** (endpoints, `fields` param, `my_list_status` update/delete) —
  <https://myanimelist.net/apiconfig/references/api/v2>
  - Update accepts `PATCH` (the curl examples use `PUT`; both work).
  - Response field is `num_episodes_watched`; the update param is
    `num_watched_episodes` (intentionally different).
- **Authorization** (OAuth2 PKCE, token exchange, refresh, lifetimes) —
  <https://myanimelist.net/apiconfig/references/authorization>
  - PKCE uses the **`plain`** method (`code_challenge` == `code_verifier`).
  - Refresh: `grant_type=refresh_token` with client credentials in the body
    (Scheme 2). Refresh tokens rotate and last ~1 month; access tokens ~1 month in
    practice (the docs table says "1 hour", but the example `expires_in` is ~28d).
- **Forum — getting started / capabilities** — <https://myanimelist.net/forum/?topicid=1973141>
  - The character & people endpoints are **undocumented and off-limits** ("don't
    use them") — that data comes from Jikan instead.
- **Forum — public data without OAuth** — <https://myanimelist.net/forum/?topicid=1973077>
  - Public endpoints work with just an `X-MAL-CLIENT-ID` header. We still use Jikan
    for reads so they need **zero** credentials (see the note in
    [AGENTS.md](../AGENTS.md)).
- **Official sample OAuth2 PKCE flow (Python)** — <https://gitlab.com/-/snippets/2039434>
  - Matches the manual token steps in [auth.md](auth.md).
