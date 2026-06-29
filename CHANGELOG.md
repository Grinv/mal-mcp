# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Tool results now serialize their text mirror as compact JSON (no pretty-print
  indentation), reducing tokens for clients that feed the text into the model.
- Every id-based read tool now states where to obtain the `mal_id` (via
  `search_anime`/`search_manga`), so calling agents don't have to guess.
- The Jikan rate limiter now enforces sliding-window limits (3 req/s **and**
  60 req/min, per the API docs) instead of only a minimum interval, so sustained
  traffic stays under the published per-minute ceiling. `JIKAN_MIN_INTERVAL_MS`
  still applies as a floor; set it to `0` to disable client-side throttling.
- A Jikan `score` of `0` (which the API uses to mean "no score yet") is now
  surfaced as absent instead of a literal `0`, so it is not mistaken for a 0/10
  rating.
- Upstream HTTP errors now surface Jikan's structured `message` (and `report_url`
  when present) instead of a raw body slice; status `304`/`405` are mapped to
  explicit error codes.

### Added

- New read tools (Jikan): `get_anime_genres` / `get_manga_genres` (discover the
  genre IDs that `search_*` expect), `get_anime_episodes` (titles, air dates,
  filler/recap flags), and manga parity with anime — `get_manga_characters`,
  `get_manga_recommendations`, `get_manga_reviews`.
- Character & people surface: `search_characters` / `get_character`,
  `search_people` / `get_person`, and `get_anime_staff` — so the IDs returned by
  character/voice-actor fields are now navigable.
- Discovery & stats: `get_random_anime` / `get_random_manga`,
  `get_upcoming_season`, `get_anime_statistics` / `get_manga_statistics`.
- Broader surface: `get_producers`, `get_top_people` / `get_top_characters`.
- Curated extras: `get_seasons_list` (valid args for get_seasonal_anime),
  `get_random_character` / `get_random_person`, and `get_anime_news`.
- `update_my_anime_status` / `update_my_manga_status` now accept the remaining
  MyAnimeList list fields: `priority`, `tags`, and rewatch/reread counts
  (`num_times_rewatched`/`rewatch_value`, `num_times_reread`/`reread_value`).

## [0.1.2] - 2026-06-28

### Fixed

- Add the `repository` field to `package.json` so npm provenance (Trusted
  Publishing) validates. The 0.1.1 CI publish to npm failed with `E422`
  (provenance could not match an empty `repository.url`); 0.1.2 supersedes it on
  npm. (The 0.1.1 GitHub Release and `.mcpb` were unaffected.)

## [0.1.1] - 2026-06-28

### Changed

- Clearer credential setup: docs, the `manifest.json` config fields, and the
  "not configured" error message now lead with `MAL_CLIENT_ID` +
  `MAL_CLIENT_SECRET` + `MAL_REFRESH_TOKEN` (the access token is managed
  automatically); `MAL_ACCESS_TOKEN` is demoted to an advanced/optional override.
- `npx -y mal-mcp` documented as the primary way to connect (no clone/build).
- The pre-deploy API health check now distinguishes contract drift (blocks the
  release) from transient upstream outages such as 5xx/429/timeout (warn only),
  so a brief Jikan outage no longer blocks a release.

## [0.1.0] - 2026-06-28

### Added

- Initial release of the MyAnimeList MCP server.
- Read tools backed by the public Jikan API (no credentials required):
  `search_anime`, `search_manga`, `get_anime`, `get_manga`,
  `get_anime_characters`, `get_anime_recommendations`, `get_anime_reviews`,
  `get_top_anime`, `get_top_manga`, `get_seasonal_anime`, `get_anime_schedule`,
  `get_user_profile`, `get_user_favorites`.
- Personal-list tools backed by the official MyAnimeList API (require a user token):
  `get_my_user_info`, `get_my_anime_list`, `get_my_manga_list`,
  `update_my_anime_status`, `update_my_manga_status`,
  `delete_my_anime_list_item`, `delete_my_manga_list_item`.
- Prompts: `recommend_similar`, `seasonal_overview`.
- Silent OAuth token refresh with on-disk persistence of the rotated refresh token.
- In-memory TTL caching, polite Jikan rate limiting, retries with backoff.
- `.mcpb` bundle packaging and `server.json` metadata for the MCP Registry.

[Unreleased]: https://github.com/Grinv/mal-mcp/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/Grinv/mal-mcp/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Grinv/mal-mcp/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Grinv/mal-mcp/releases/tag/v0.1.0
