# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Runtime floor raised Node ≥ 18 → ≥ 20.** `tsup`/esbuild test builds now
  target `node20`; CI's test matrix drops Node 18.
- **Carcass hardening ported from the `mcp-server-template` lineage** (via
  steam-games-mcp): `scripts/build-tests.mjs` now clears stale `dist-tests/`
  output before each rebuild (a renamed/deleted test file could otherwise keep
  running from a leftover compiled `.js`); `scripts/run-tests.mjs` forwards
  passthrough CLI args (e.g. `npm test -- --test-name-pattern=foo`) to
  `node --test`; `RateLimiter` no longer relies on `Date.now()` always being far
  from a `0` epoch sentinel (only observable under a mocked clock, e.g. Node 20's
  `t.mock.timers`). Test files also migrated from a manual
  `installFetch()`/`restore()` pattern to Node 20's built-in `t.mock.method` /
  `t.after` (auto-restoring, safe on test failure).

### Added

- **One-click login: `login_mal` + `submit_mal_redirect` tools.** Enabling the
  personal-list tools no longer needs a manual OAuth/`curl` dance. Register a MAL
  app (type `other`), set `MAL_CLIENT_ID`, and run `login_mal`: the server runs
  the PKCE authorization, opens/returns the authorize URL, and stores the token.
  When the browser is on the same machine as the server it completes
  automatically via a localhost callback (`MAL_OAUTH_PORT`, default 8080); on
  remote/SSH/headless hosts, paste the redirected URL into `submit_mal_redirect`.
  Auth capability is now evaluated live, so a token obtained mid-session unlocks
  the tools immediately. Verified end-to-end against the live MAL API.
- **Personal-list reads now round-trip the annotation fields.** `get_my_anime_list`
  / `get_my_manga_list` now return the full `list_status` the update tools can
  write — `priority`, `tags`, `comments` and the rewatch/reread counters
  (`num_times_rewatched` / `rewatch_value`, `num_times_reread` / `reread_value`),
  plus manga `start_date` / `finish_date`. These were previously write-only:
  settable via `update_my_*_status` but absent from the list reads. Verified live
  against the official MAL API.
- **Richer anime/manga detail lookups.** `get_anime`/`get_manga` now surface more
  of the `/full` payload we already fetch (no extra requests): anime gains
  `duration`, `broadcast` (airing day/time), `trailer` URL, `opening_themes` /
  `ending_themes` (OP/ED songs) and `licensors`; manga gains a `publishing`
  boolean (still-running, analogous to anime `airing`). List/search results are
  unchanged — these appear only in the detailed single-item view. Field shapes
  verified against Jikan's OpenAPI spec.
- **MCP logging capability.** The server now declares the `logging` capability
  and mirrors its stderr log lines to the connected client as
  `notifications/message`, so MCP hosts can surface server logs in their UI and
  adjust verbosity at runtime via `logging/setLevel`. stderr logging is
  unchanged; the new channel is best-effort, credential-redacted, gated by the
  same `LOG_LEVEL` threshold, and — to respect the MCP lifecycle — only starts
  mirroring after the client's `initialized` (sending before it made strict
  clients like Claude Desktop drop the connection).
- **MCP Registry publishing.** The server is now published to the official MCP
  Registry (`registry.modelcontextprotocol.io`) as `io.github.Grinv/mal-mcp`,
  listing both the npm package and the `.mcpb` bundle. `package.json` gains an
  `mcpName` marker (npm ownership check) and `server.json` now lists the npm
  package plus a self-describing `environmentVariables` block on both packages;
  the release workflow publishes via `mcp-publisher` with GitHub OIDC (no
  token), injecting the freshly-packed bundle's `fileSha256`.

### Changed

- **BREAKING: dropped `MAL_CLIENT_SECRET`.** mal-mcp is a public OAuth client
  (it runs on each user's machine), so a client secret can't actually be secret
  and provides no security — PKCE covers its role. Register the MAL app as type
  **`other`** (secret-less) instead of `web`. Personal-list setup is now just
  `MAL_CLIENT_ID` + `login_mal`. Migration for anyone who used the old `web`-app
  trio: re-register the app as `other` and drop `MAL_CLIENT_SECRET` from your
  config. (`MAL_REFRESH_TOKEN` / `MAL_ACCESS_TOKEN` still work as before.) No
  published release shipped the secret, so this affects source/dev users only.

### Fixed

- **The built bundle was not self-contained.** Despite `bundle: true`, tsup
  leaves `dependencies` external, so `dist/index.js` still imported
  `@modelcontextprotocol/sdk` and `zod` at runtime — but the `.mcpb` ships no
  `node_modules` (and some `npx` installs don't restore them), so the server
  could crash standalone with `ERR_MODULE_NOT_FOUND`. Added `noExternal` to
  inline all runtime deps; a new `bundle.test.ts` guards that the build stays
  self-contained. The build is now also **minified** with **no sourcemap**
  (`dist/index.js` ~620 KB); we log `err.message`, not raw stacks, so
  diagnostics are unaffected.
- **Unfilled `.mcpb` optional fields leaked as literal `${user_config.x}`.**
  When an optional field (MAL token / client id / secret) is left blank in the
  Claude Desktop install form, `.mcpb` passes the **unsubstituted placeholder
  string** (not "") as the env var. A non-empty placeholder was taken as a real
  value, so `auth.configured` went true and the personal-list tools tried to
  authenticate with garbage. `loadConfig` now treats `${...}` placeholders as
  unset (like empty strings).

### Internal

- Added an **e2e smoke test** that drives the real built bundle the way a client
  does — a spawned `node dist/index.js` over stdio, run from a dir with no
  `node_modules` — asserting it handshakes, registers all tools, and gates the
  personal-list tools. Covers the integration boundary that in-memory unit tests
  never exercise (and where the bundle bug above hid). Ships a
  `{"type":"module"}` package.json in the sandbox so the ESM bundle also runs on
  Node < 20.19.
- **`TtlCache` now shares one in-flight fetch across concurrent callers of the
  same key**, instead of each starting its own — so two reads racing on the same
  cold/expired key trigger a single upstream (rate-limited Jikan) request.
- **Version-sync tooling.** `scripts/sync-version.mjs`, wired into the npm
  `version` lifecycle hook, propagates `package.json`'s version to
  `src/version.ts`, `manifest.json` and `server.json` (incl. the `.mcpb`
  release-asset URL) in one commit; `version.test.ts` now guards that these
  never drift and that `mcpName`/`server.json` name and the manifest/registry
  env-var lists stay in sync. See the new "Releasing" section in AGENTS.md.
- **Local coverage gate.** `npm run test:coverage` now enforces the 80%-lines
  threshold locally (falling back to report-only on Node < 22.8), matching CI so
  regressions are caught before pushing.

## [0.2.0] - 2026-06-30

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
