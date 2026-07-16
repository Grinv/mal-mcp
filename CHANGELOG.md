# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Raise runtime floor from Node ≥ 18 to ≥ 20.
- Clear stale `dist-tests/` output before each rebuild in `scripts/build-tests.mjs`, so a renamed/deleted test file can't keep running from a leftover compiled file.
- Forward passthrough CLI args (e.g. `--test-name-pattern`) from `npm test` to `node --test` in `scripts/run-tests.mjs`.
- Fix `RateLimiter` assuming `Date.now()` is always far from the `0` epoch, a bug only observable under a mocked clock (Node 20's `t.mock.timers`).
- Migrate tests from the manual `installFetch()`/`restore()` pattern to Node 20's built-in `t.mock.method`/`t.after`.

### Added

- Add `login_mal` and `submit_mal_redirect` tools for one-click PKCE OAuth login (register a MAL app as type `other`, set `MAL_CLIENT_ID`, run `login_mal`), replacing the manual OAuth/`curl` dance.
- `login_mal` completes automatically via a localhost callback (`MAL_OAUTH_PORT`, default 8080) when the browser is on the same machine as the server; on remote/headless hosts, paste the redirect URL into `submit_mal_redirect`.
- Evaluate auth capability live, so a token obtained mid-session unlocks the personal-list tools immediately.
- `get_my_anime_list`/`get_my_manga_list` now also return `priority`, `tags`, `comments`, `num_times_rewatched`/`rewatch_value`, `num_times_reread`/`reread_value`, and manga `start_date`/`finish_date` — previously write-only via `update_my_*_status`.
- `get_anime`/`get_manga` detail views now include `duration`, `broadcast`, `trailer`, `opening_themes`/`ending_themes`, and `licensors`; manga also gains `publishing`. List/search results are unchanged.
- Declare the MCP `logging` capability and mirror stderr log lines to the client as `notifications/message` (gated by `LOG_LEVEL`), starting only after the client's `initialized` message so strict clients like Claude Desktop don't drop the connection.
- Publish to the official MCP Registry (`registry.modelcontextprotocol.io`) as `io.github.Grinv/mal-mcp`, listing both the npm package and the `.mcpb` bundle.

### Changed

- **BREAKING:** Drop `MAL_CLIENT_SECRET` (no published release used it) — register the MAL app as type `other` instead of `web`; PKCE replaces the secret's role.
- Personal-list setup is now just `MAL_CLIENT_ID` + `login_mal`; `MAL_REFRESH_TOKEN`/`MAL_ACCESS_TOKEN` still work unchanged.

### Fixed

- Fix `dist/index.js` crashing standalone with `ERR_MODULE_NOT_FOUND`: tsup left `@modelcontextprotocol/sdk`/`zod` external despite `bundle: true`, but the `.mcpb` ships no `node_modules`; runtime deps are now inlined via `noExternal`.
- `dist/index.js` is now minified with no sourcemap (~620 KB).
- Fix blank optional `.mcpb` fields (MAL token/client id/secret) leaking as the literal `${user_config.x}` string instead of empty, which made `loadConfig` treat them as configured and try to authenticate with garbage; placeholders are now treated as unset.

### Internal

- Add an e2e smoke test that spawns the built `dist/index.js` over stdio from a directory with no `node_modules`, asserting it handshakes, registers all tools, and gates the personal-list tools correctly.
- `TtlCache` now dedupes concurrent fetches for the same key into a single in-flight request, instead of each caller triggering its own upstream call.
- Add `scripts/sync-version.mjs` (npm `version` lifecycle hook) to propagate `package.json`'s version to `src/version.ts`, `manifest.json`, and `server.json` in one commit; `version.test.ts` guards they never drift.
- `npm run test:coverage` now enforces an 80%-lines threshold locally (report-only on Node < 22.8), matching CI.

## [0.2.0] - 2026-06-30

### Changed

- Serialize tool results' text mirror as compact JSON (no pretty-print), reducing tokens for clients that feed it into the model.
- State where to obtain `mal_id` (via `search_anime`/`search_manga`) in every id-based read tool's description.
- Enforce Jikan's sliding-window rate limits (3 req/s and 60 req/min) instead of only a minimum interval; `JIKAN_MIN_INTERVAL_MS` still applies as a floor (set to `0` to disable).
- Surface a Jikan `score` of `0` (meaning "no score yet") as absent instead of a literal `0`, so it isn't mistaken for a 0/10 rating.
- Surface Jikan's structured `message` (and `report_url` when present) for upstream HTTP errors instead of a raw body slice; map status `304`/`405` to explicit error codes.

### Added

- Add read tools (Jikan): `get_anime_genres`/`get_manga_genres`, `get_anime_episodes` (titles, air dates, filler/recap flags), and manga parity with anime (`get_manga_characters`, `get_manga_recommendations`, `get_manga_reviews`).
- Add character & people tools: `search_characters`/`get_character`, `search_people`/`get_person`, `get_anime_staff`.
- Add discovery & stats tools: `get_random_anime`/`get_random_manga`, `get_upcoming_season`, `get_anime_statistics`/`get_manga_statistics`.
- Add `get_producers`, `get_top_people`/`get_top_characters`.
- Add `get_seasons_list`, `get_random_character`/`get_random_person`, `get_anime_news`.
- `update_my_anime_status`/`update_my_manga_status` now accept `priority`, `tags`, and rewatch/reread counts (`num_times_rewatched`/`rewatch_value`, `num_times_reread`/`reread_value`).

## [0.1.2] - 2026-06-28

### Fixed

- Add `repository` to `package.json` so npm provenance (Trusted Publishing) validates; 0.1.1's npm publish failed on this (`E422`) and 0.1.2 supersedes it there (the 0.1.1 GitHub Release/`.mcpb` were unaffected).

## [0.1.1] - 2026-06-28

### Changed

- Lead credential docs/config with `MAL_CLIENT_ID` + `MAL_CLIENT_SECRET` + `MAL_REFRESH_TOKEN`; demote `MAL_ACCESS_TOKEN` to an advanced/optional override.
- Document `npx -y mal-mcp` as the primary way to connect (no clone/build).
- Distinguish contract drift (blocks the release) from transient upstream outages (5xx/429/timeout, warn only) in the pre-deploy API health check.

## [0.1.0] - 2026-06-28

### Added

- Initial release of the MyAnimeList MCP server.
- Add read tools backed by the public Jikan API (no credentials required):
  `search_anime`, `search_manga`, `get_anime`, `get_manga`,
  `get_anime_characters`, `get_anime_recommendations`, `get_anime_reviews`,
  `get_top_anime`, `get_top_manga`, `get_seasonal_anime`, `get_anime_schedule`,
  `get_user_profile`, `get_user_favorites`.
- Add personal-list tools backed by the official MyAnimeList API (require a user token):
  `get_my_user_info`, `get_my_anime_list`, `get_my_manga_list`,
  `update_my_anime_status`, `update_my_manga_status`,
  `delete_my_anime_list_item`, `delete_my_manga_list_item`.
- Add prompts: `recommend_similar`, `seasonal_overview`.
- Add silent OAuth token refresh with on-disk persistence of the rotated refresh token.
- Add in-memory TTL caching, polite Jikan rate limiting, and retries with backoff.
- Add `.mcpb` bundle packaging and `server.json` metadata for the MCP Registry.

[Unreleased]: https://github.com/Grinv/mal-mcp/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/Grinv/mal-mcp/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Grinv/mal-mcp/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Grinv/mal-mcp/releases/tag/v0.1.0
