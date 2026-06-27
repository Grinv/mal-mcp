# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/Grinv/mal-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Grinv/mal-mcp/releases/tag/v0.1.0
