# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Send an `Accept-Encoding: gzip, deflate, br` header on Jikan requests, working around an upstream bug (jikan-me/jikan#596) that 504s some routes without it ([91dd067](https://github.com/Grinv/mal-mcp/commit/91dd067)).
- Disclose that `get_manga_statistics` has no official-API fallback, unlike `get_anime_statistics` ([02a5f72](https://github.com/Grinv/mal-mcp/commit/02a5f72)).

## [0.7.1] - 2026-07-22

### Fixed

- Fix `get_anime_statistics`'s official-API fallback throwing a raw validation error instead of a result — the official API sends watch-status counts as numeric strings, which were passed through unconverted.
- `update_my_anime_status`/`update_my_manga_status` now reject a call with only `anime_id`/`manga_id` and no other field, instead of silently creating a `watching`/`reading` entry with MAL's defaults.

## [0.7.0] - 2026-07-22

### Added

- Add machine-readable `outputSchema`/`structuredContent` to every tool's response, alongside the existing text content, so clients can consume results without re-parsing JSON from text.
- The `recommend_similar` prompt now offers live title autocomplete as you type.

### Changed

- The `recommend_similar` prompt's `title` argument is now optional — if omitted, it asks which anime you mean instead of failing the call (some clients, e.g. Claude Code, don't prompt the user for a missing required argument).

### Removed

- Remove the MCP logging capability and `notifications/message` push; server logs are now stderr-only. Clients that called `logging/setLevel` or listened for log notifications will no longer receive them — check the server's stderr instead.

### Fixed

- Drop a single malformed item from a list response (search/top/seasonal/characters/people/producers/news/etc.) instead of failing the whole call, for both the Jikan and official-API-fallback backends.
- Fix `recommend_similar`'s prompt steps, which called `get_anime` optional despite requiring the score/genres only it provides.
- Disclose that `search_anime`/`search_manga`'s official-API fallback also enforces `sfw` client-side (matching the existing seasonal-fallback caveat) — a filtered page can come back shorter than `limit`.

## [0.6.0] - 2026-07-20

### Added

- `get_anime_recommendations`/`get_manga_recommendations` fall back to the official MAL API's own `recommendations` field (via `MAL_CLIENT_ID`, no OAuth needed) when Jikan fails, joining the existing search/top/seasonal fallback.
- `get_anime`/`get_manga` gain the same official-API fallback; it omits `producers`/`licensors`/`streaming`/`opening_themes`/`ending_themes`/`trailer`/`favorites`, which have no official-API equivalent.
- `get_anime_statistics` also falls back (watch-status counts only, no score distribution — the official API has no histogram field); `get_manga_statistics` has no official-API equivalent at all and stays Jikan-only.

### Changed

- Cross-reference `get_my_user_info`/`get_user_profile` and disclose that `get_my_user_info` has no manga statistics at all (the official API has no such field).

## [0.5.0] - 2026-07-18

### Added

- Add a `hidden_gems` prompt — surfaces highly-rated anime/manga that aren't widely known, alongside `recommend_similar`/`seasonal_overview`.

### Fixed

- Fix the `.mcpb` bundle's advertised tool list (`manifest.json`), which was missing 22 of the 45 tools since the v0.2.0/v0.3.0 expansions.
- Validate `get_my_user_info`/`get_my_anime_list`/`get_my_manga_list`/`update_my_anime_status`/`update_my_manga_status` responses against the expected shape, surfacing a clear error instead of forwarding a malformed upstream response as-is.

### Changed

- Disclose undisclosed caps/truncation (recommendations capped at 25, `get_person`'s voice roles capped at 50, reviews truncated to 1200 chars), the `search_anime`/`search_manga` fallback's dropped filters, `get_seasonal_anime`'s partial year/season behavior, and cross-reference `get_top_anime`/`get_top_manga` and `get_anime_characters` from tools they could be confused with.

## [0.4.1] - 2026-07-18

### Fixed

- Remove `get_anime_reviews`' dangling reference to a nonexistent `get_top_reviews` tool ([2041bb1](https://github.com/Grinv/mal-mcp/commit/2041bb1)).

### Changed

- Sharpen several tool descriptions — disclose hidden defaults (review/schedule limits, JST air times), add `get_manga`'s field list, and disambiguate `get_top_anime`/`get_top_manga`, `get_random_person`, `get_top_people`/`get_top_characters` and the five mylist tools from their siblings ([2041bb1](https://github.com/Grinv/mal-mcp/commit/2041bb1)).

## [0.4.0] - 2026-07-17

### Added

- `search_anime`/`search_manga`/`get_top_anime`/`get_top_manga`/`get_seasonal_anime`/`get_upcoming_season` fall back to the official MAL API (via `MAL_CLIENT_ID`, no OAuth needed) when Jikan's live pass-through fails, honoring `sfw` exclusion during the fallback; unchanged with no Client ID configured ([75af91f](https://github.com/Grinv/mal-mcp/commit/75af91f)).

### Changed

- Raise runtime floor to Node ≥ 20.3 (was ≥ 18) ([45b8954](https://github.com/Grinv/mal-mcp/commit/45b8954), [75af91f](https://github.com/Grinv/mal-mcp/commit/75af91f)).
- Surface the redacted upstream error detail (and, for the six fallback-eligible tools, a tip to set `MAL_CLIENT_ID`) in 5xx/network/timeout tool errors instead of a generic message ([75af91f](https://github.com/Grinv/mal-mcp/commit/75af91f)).

### Fixed

- Prevent `RateLimiter` from assuming `Date.now()` is always far from the `0` epoch, which could misfire near epoch ([45b8954](https://github.com/Grinv/mal-mcp/commit/45b8954)).

## [0.3.0] - 2026-07-09

### Added

- Add `login_mal`/`submit_mal_redirect` — one-click PKCE OAuth login, replacing the manual OAuth/`curl` dance ([3fd2bbf](https://github.com/Grinv/mal-mcp/commit/3fd2bbf)).
- `login_mal` completes automatically via a localhost callback; on remote/headless hosts, paste the URL into `submit_mal_redirect` ([3fd2bbf](https://github.com/Grinv/mal-mcp/commit/3fd2bbf)).
- Evaluate auth capability live, so a token obtained mid-session unlocks the personal-list tools immediately ([3fd2bbf](https://github.com/Grinv/mal-mcp/commit/3fd2bbf)).
- `get_my_anime_list`/`get_my_manga_list` now also return `priority`, `tags`, `comments` and rewatch/reread fields ([3fd2bbf](https://github.com/Grinv/mal-mcp/commit/3fd2bbf)).
- `get_anime`/`get_manga` detail views now include `duration`, `broadcast`, `trailer`, theme songs and `licensors` ([3fd2bbf](https://github.com/Grinv/mal-mcp/commit/3fd2bbf)).
- Declare the MCP `logging` capability, mirroring stderr log lines to the client as `notifications/message` ([3fd2bbf](https://github.com/Grinv/mal-mcp/commit/3fd2bbf)).
- Publish to the official MCP Registry as `io.github.Grinv/mal-mcp` (npm + `.mcpb`) ([3fd2bbf](https://github.com/Grinv/mal-mcp/commit/3fd2bbf)).

### Changed

- **BREAKING:** Drop `MAL_CLIENT_SECRET` — register the MAL app as type `other` instead of `web`; PKCE replaces the secret's role ([3fd2bbf](https://github.com/Grinv/mal-mcp/commit/3fd2bbf)).
- Personal-list setup is now just `MAL_CLIENT_ID` + `login_mal` ([3fd2bbf](https://github.com/Grinv/mal-mcp/commit/3fd2bbf)).
- Minify `dist/index.js` with no sourcemap (~620 KB) ([3fd2bbf](https://github.com/Grinv/mal-mcp/commit/3fd2bbf)).
- Dedupe concurrent `TtlCache` fetches for the same key into a single in-flight request ([3fd2bbf](https://github.com/Grinv/mal-mcp/commit/3fd2bbf)).

### Fixed

- Prevent `dist/index.js` from crashing standalone (`ERR_MODULE_NOT_FOUND`) by inlining runtime deps instead of leaving them external ([3fd2bbf](https://github.com/Grinv/mal-mcp/commit/3fd2bbf)).
- Prevent blank optional `.mcpb` fields from leaking as the literal `${user_config.x}` string instead of empty ([3fd2bbf](https://github.com/Grinv/mal-mcp/commit/3fd2bbf)).

## [0.2.0] - 2026-06-30

### Changed

- Enforce Jikan's sliding-window rate limits (3 req/s, 60 req/min) instead of only a minimum interval ([e64ea45](https://github.com/Grinv/mal-mcp/commit/e64ea45)).
- Surface Jikan's structured error `message` instead of a raw body slice; map status `304`/`405` to explicit error codes ([e64ea45](https://github.com/Grinv/mal-mcp/commit/e64ea45)).
- Serialize tool results' text mirror as compact JSON, reducing tokens ([2944223](https://github.com/Grinv/mal-mcp/commit/2944223)).
- Surface a Jikan `score` of `0` ("no score yet") as absent instead of a literal `0` ([2944223](https://github.com/Grinv/mal-mcp/commit/2944223)).
- State where to obtain `mal_id` in every id-based read tool's description ([2944223](https://github.com/Grinv/mal-mcp/commit/2944223)).

### Added

- Add read tools (Jikan): genres, `get_anime_episodes`, and manga parity with anime (characters/recommendations/reviews) ([2944223](https://github.com/Grinv/mal-mcp/commit/2944223)).
- Add character & people tools: `search_characters`/`get_character`, `search_people`/`get_person`, `get_anime_staff` ([2944223](https://github.com/Grinv/mal-mcp/commit/2944223)).
- Add discovery & stats tools: `get_random_anime`/`get_random_manga`, `get_upcoming_season`, anime/manga statistics ([2944223](https://github.com/Grinv/mal-mcp/commit/2944223)).
- Add `get_producers`, `get_top_people`/`get_top_characters` ([2944223](https://github.com/Grinv/mal-mcp/commit/2944223)).
- Add `get_seasons_list`, `get_random_character`/`get_random_person`, `get_anime_news` ([2944223](https://github.com/Grinv/mal-mcp/commit/2944223)).
- `update_my_anime_status`/`update_my_manga_status` now accept `priority`, `tags`, and rewatch/reread counts ([2944223](https://github.com/Grinv/mal-mcp/commit/2944223)).

## [0.1.2] - 2026-06-28

### Fixed

- Fix 0.1.1's failed npm publish (`E422`) by adding `repository` to `package.json`, which npm provenance requires ([73b4214](https://github.com/Grinv/mal-mcp/commit/73b4214)).

## [0.1.1] - 2026-06-28

No user-facing changes — docs and release-process updates only.

## [0.1.0] - 2026-06-28

### Added

- Initial release of the MyAnimeList MCP server ([494d2c8](https://github.com/Grinv/mal-mcp/commit/494d2c8)).
- Add read tools backed by the public Jikan API (no credentials required): search, details, characters, recommendations, reviews, top/seasonal lists, schedule, user profile ([494d2c8](https://github.com/Grinv/mal-mcp/commit/494d2c8)).
- Add personal-list tools backed by the official MyAnimeList API (require a user token): read/update/delete anime and manga list entries ([494d2c8](https://github.com/Grinv/mal-mcp/commit/494d2c8)).
- Add prompts: `recommend_similar`, `seasonal_overview` ([494d2c8](https://github.com/Grinv/mal-mcp/commit/494d2c8)).
- Add silent OAuth token refresh with on-disk persistence of the rotated refresh token ([494d2c8](https://github.com/Grinv/mal-mcp/commit/494d2c8)).
- Add in-memory TTL caching, polite Jikan rate limiting, and retries with backoff ([494d2c8](https://github.com/Grinv/mal-mcp/commit/494d2c8)).
- Add `.mcpb` bundle packaging and `server.json` metadata for the MCP Registry ([494d2c8](https://github.com/Grinv/mal-mcp/commit/494d2c8)).

[Unreleased]: https://github.com/Grinv/mal-mcp/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/Grinv/mal-mcp/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Grinv/mal-mcp/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/Grinv/mal-mcp/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Grinv/mal-mcp/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Grinv/mal-mcp/releases/tag/v0.1.0
