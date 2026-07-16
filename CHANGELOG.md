# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Raise runtime floor to Node ≥ 20 (was ≥ 18)
  ([45b8954](https://github.com/Grinv/mal-mcp/commit/45b8954)).

### Fixed

- Fix `RateLimiter` assuming `Date.now()` is always far from the `0` epoch,
  which could misfire under a clock near epoch
  ([45b8954](https://github.com/Grinv/mal-mcp/commit/45b8954)).

## [0.3.0] - 2026-07-09

### Added

- Add `login_mal` and `submit_mal_redirect` tools for one-click PKCE OAuth
  login (register a MAL app as type `other`, set `MAL_CLIENT_ID`, run
  `login_mal`), replacing the manual OAuth/`curl` dance
  ([3fd2bbf](https://github.com/Grinv/mal-mcp/commit/3fd2bbf)).
- `login_mal` completes automatically via a localhost callback
  (`MAL_OAUTH_PORT`, default 8080) when the browser is on the same machine as
  the server; on remote/headless hosts, paste the redirect URL into
  `submit_mal_redirect` ([3fd2bbf](https://github.com/Grinv/mal-mcp/commit/3fd2bbf)).
- Evaluate auth capability live, so a token obtained mid-session unlocks the
  personal-list tools immediately
  ([3fd2bbf](https://github.com/Grinv/mal-mcp/commit/3fd2bbf)).
- `get_my_anime_list`/`get_my_manga_list` now also return `priority`, `tags`,
  `comments`, `num_times_rewatched`/`rewatch_value`,
  `num_times_reread`/`reread_value`, and manga `start_date`/`finish_date` —
  previously write-only via `update_my_*_status`
  ([3fd2bbf](https://github.com/Grinv/mal-mcp/commit/3fd2bbf)).
- `get_anime`/`get_manga` detail views now include `duration`, `broadcast`,
  `trailer`, `opening_themes`/`ending_themes`, and `licensors`; manga also
  gains `publishing`. List/search results are unchanged
  ([3fd2bbf](https://github.com/Grinv/mal-mcp/commit/3fd2bbf)).
- Declare the MCP `logging` capability and mirror stderr log lines to the
  client as `notifications/message` (gated by `LOG_LEVEL`), starting only
  after the client's `initialized` message so strict clients like Claude
  Desktop don't drop the connection
  ([3fd2bbf](https://github.com/Grinv/mal-mcp/commit/3fd2bbf)).
- Publish to the official MCP Registry (`registry.modelcontextprotocol.io`)
  as `io.github.Grinv/mal-mcp`, listing both the npm package and the `.mcpb`
  bundle ([3fd2bbf](https://github.com/Grinv/mal-mcp/commit/3fd2bbf)).

### Changed

- **BREAKING:** Drop `MAL_CLIENT_SECRET` (no published release used it) —
  register the MAL app as type `other` instead of `web`; PKCE replaces the
  secret's role ([3fd2bbf](https://github.com/Grinv/mal-mcp/commit/3fd2bbf)).
- Personal-list setup is now just `MAL_CLIENT_ID` + `login_mal`;
  `MAL_REFRESH_TOKEN`/`MAL_ACCESS_TOKEN` still work unchanged
  ([3fd2bbf](https://github.com/Grinv/mal-mcp/commit/3fd2bbf)).
- Minify `dist/index.js` with no sourcemap (~620 KB)
  ([3fd2bbf](https://github.com/Grinv/mal-mcp/commit/3fd2bbf)).
- Dedupe concurrent `TtlCache` fetches for the same key into a single
  in-flight request, instead of each caller triggering its own upstream call
  ([3fd2bbf](https://github.com/Grinv/mal-mcp/commit/3fd2bbf)).

### Fixed

- Fix `dist/index.js` crashing standalone with `ERR_MODULE_NOT_FOUND`: tsup
  left `@modelcontextprotocol/sdk`/`zod` external despite `bundle: true`, but
  the `.mcpb` ships no `node_modules`; runtime deps are now inlined via
  `noExternal` ([3fd2bbf](https://github.com/Grinv/mal-mcp/commit/3fd2bbf)).
- Fix blank optional `.mcpb` fields (MAL token/client id/secret) leaking as
  the literal `${user_config.x}` string instead of empty, which made
  `loadConfig` treat them as configured and try to authenticate with garbage;
  placeholders are now treated as unset
  ([3fd2bbf](https://github.com/Grinv/mal-mcp/commit/3fd2bbf)).

## [0.2.0] - 2026-06-30

### Changed

- Enforce Jikan's sliding-window rate limits (3 req/s and 60 req/min) instead
  of only a minimum interval; `JIKAN_MIN_INTERVAL_MS` still applies as a floor
  (set to `0` to disable) ([e64ea45](https://github.com/Grinv/mal-mcp/commit/e64ea45)).
- Surface Jikan's structured `message` (and `report_url` when present) for
  upstream HTTP errors instead of a raw body slice; map status `304`/`405` to
  explicit error codes ([e64ea45](https://github.com/Grinv/mal-mcp/commit/e64ea45)).
- Serialize tool results' text mirror as compact JSON (no pretty-print),
  reducing tokens for clients that feed it into the model
  ([2944223](https://github.com/Grinv/mal-mcp/commit/2944223)).
- Surface a Jikan `score` of `0` (meaning "no score yet") as absent instead of
  a literal `0`, so it isn't mistaken for a 0/10 rating
  ([2944223](https://github.com/Grinv/mal-mcp/commit/2944223)).
- State where to obtain `mal_id` (via `search_anime`/`search_manga`) in every
  id-based read tool's description
  ([2944223](https://github.com/Grinv/mal-mcp/commit/2944223)).

### Added

- Add read tools (Jikan): `get_anime_genres`/`get_manga_genres`,
  `get_anime_episodes` (titles, air dates, filler/recap flags), and manga
  parity with anime (`get_manga_characters`, `get_manga_recommendations`,
  `get_manga_reviews`) ([2944223](https://github.com/Grinv/mal-mcp/commit/2944223)).
- Add character & people tools: `search_characters`/`get_character`,
  `search_people`/`get_person`, `get_anime_staff`
  ([2944223](https://github.com/Grinv/mal-mcp/commit/2944223)).
- Add discovery & stats tools: `get_random_anime`/`get_random_manga`,
  `get_upcoming_season`, `get_anime_statistics`/`get_manga_statistics`
  ([2944223](https://github.com/Grinv/mal-mcp/commit/2944223)).
- Add `get_producers`, `get_top_people`/`get_top_characters`
  ([2944223](https://github.com/Grinv/mal-mcp/commit/2944223)).
- Add `get_seasons_list`, `get_random_character`/`get_random_person`,
  `get_anime_news` ([2944223](https://github.com/Grinv/mal-mcp/commit/2944223)).
- `update_my_anime_status`/`update_my_manga_status` now accept `priority`,
  `tags`, and rewatch/reread counts (`num_times_rewatched`/`rewatch_value`,
  `num_times_reread`/`reread_value`)
  ([2944223](https://github.com/Grinv/mal-mcp/commit/2944223)).

## [0.1.2] - 2026-06-28

### Fixed

- Add `repository` to `package.json` so npm provenance (Trusted Publishing)
  validates; 0.1.1's npm publish failed on this (`E422`) and 0.1.2 supersedes
  it there (the 0.1.1 GitHub Release/`.mcpb` were unaffected)
  ([73b4214](https://github.com/Grinv/mal-mcp/commit/73b4214)).

## [0.1.1] - 2026-06-28

No user-facing changes — docs and release-process updates only.

## [0.1.0] - 2026-06-28

### Added

- Initial release of the MyAnimeList MCP server
  ([494d2c8](https://github.com/Grinv/mal-mcp/commit/494d2c8)).
- Add read tools backed by the public Jikan API (no credentials required):
  `search_anime`, `search_manga`, `get_anime`, `get_manga`,
  `get_anime_characters`, `get_anime_recommendations`, `get_anime_reviews`,
  `get_top_anime`, `get_top_manga`, `get_seasonal_anime`, `get_anime_schedule`,
  `get_user_profile`, `get_user_favorites`
  ([494d2c8](https://github.com/Grinv/mal-mcp/commit/494d2c8)).
- Add personal-list tools backed by the official MyAnimeList API (require a
  user token): `get_my_user_info`, `get_my_anime_list`, `get_my_manga_list`,
  `update_my_anime_status`, `update_my_manga_status`,
  `delete_my_anime_list_item`, `delete_my_manga_list_item`
  ([494d2c8](https://github.com/Grinv/mal-mcp/commit/494d2c8)).
- Add prompts: `recommend_similar`, `seasonal_overview`
  ([494d2c8](https://github.com/Grinv/mal-mcp/commit/494d2c8)).
- Add silent OAuth token refresh with on-disk persistence of the rotated
  refresh token ([494d2c8](https://github.com/Grinv/mal-mcp/commit/494d2c8)).
- Add in-memory TTL caching, polite Jikan rate limiting, and retries with
  backoff ([494d2c8](https://github.com/Grinv/mal-mcp/commit/494d2c8)).
- Add `.mcpb` bundle packaging and `server.json` metadata for the MCP
  Registry ([494d2c8](https://github.com/Grinv/mal-mcp/commit/494d2c8)).

[Unreleased]: https://github.com/Grinv/mal-mcp/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/Grinv/mal-mcp/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Grinv/mal-mcp/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/Grinv/mal-mcp/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Grinv/mal-mcp/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Grinv/mal-mcp/releases/tag/v0.1.0
