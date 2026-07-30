# Security

`mal-mcp` is **not** a read-only server: alongside credential-less public
reads, it exposes OAuth-authenticated tools that read and modify a
connected user's real MyAnimeList list.

## What it does and doesn't do

- **Two distinct tool tiers.** Public reads — `search_anime`/`search_manga`,
  `get_anime`/`get_manga`, rankings, seasons, characters, staff, reviews,
  and more — call the free [Tenrai](https://tenrai.org) API (or, for eleven
  of them, fall back to the official MyAnimeList API using just a Client
  ID) and need no credential. Personal-list tools —
  `get_my_user_info`, `get_my_anime_list`, `get_my_manga_list`,
  `update_my_anime_status`, `update_my_manga_status`,
  `delete_my_anime_list_item`, `delete_my_manga_list_item` — act on the
  authenticated user's own MyAnimeList account via the official API and
  require a user token (obtained via `login_mal`/`submit_mal_redirect`, or a
  pre-supplied `MAL_REFRESH_TOKEN`/`MAL_ACCESS_TOKEN`); without one they
  return an actionable error instead of running.
- **Write-tool blast radius.** `update_my_anime_status`/
  `update_my_manga_status` can set arbitrary status/score/progress/dates/
  tags/comments on an entry in the user's real list — creating it if absent,
  leaving omitted fields unchanged if it already exists. `delete_my_anime_list_item`/
  `delete_my_manga_list_item` **permanently remove** an entry; MAL's delete
  endpoint is idempotent and reports success even when the entry never
  existed, so a successful result isn't proof anything was actually removed.
  Every write tool requires the caller's own OAuth token — there is no
  cross-user write capability, and none of this runs unless the model
  actually invokes one of these tools.
- **Three hosts, fixed at startup.** Requests go to the configured
  `TENRAI_BASE_URL` (default `api.tenrai.org`), `MAL_BASE_URL` (default
  `api.myanimelist.net`), or `MAL_OAUTH_BASE_URL` (default
  `myanimelist.net/v1/oauth2`) — each is only URL-shape validated at startup
  (via `config.ts`'s Zod schema), not allowlisted against a fixed set of
  hosts, and no tool parameter lets a caller redirect a request elsewhere. As
  with every sibling MCP server in this family, this means a compromised
  deployment environment could repoint these at an attacker-controlled host
  — the same risk category as any env-configured base URL, not something
  unique to `mal-mcp`.
- **Token storage.** A successful `login_mal`/refresh writes the access +
  refresh token pair to `~/.config/mal-mcp/tokens.json`
  (`%APPDATA%\mal-mcp\tokens.json` on Windows; overridable via
  `MAL_TOKEN_STORE`), with the directory created `0700` and the file written
  `0600` (`src/lib/tokenStore.ts`). Windows ignores POSIX file modes — the
  file there is protected by the user's own account ACLs on the directory
  instead, not by the `0600` call.
- **Credential redaction.** `src/lib/errors.ts`'s `redact()` strips
  `Bearer <token>` headers and `access_token`/`refresh_token`/`client_secret`/
  `client_id` values in both `key=value` and JSON (`"key":"value"`) shapes
  before a line is logged. Logging goes to **stderr only** — never stdout,
  which is reserved for the MCP protocol channel — and never to a file or
  remote endpoint. `mal-mcp` is a public (secret-less) PKCE OAuth client, so
  no `client_secret` is ever sent in the first place.
- **Typed, validated inputs.** Every tool's parameters are a strict Zod
  schema; unknown or malformed input is rejected before any request is made.

## Reporting a vulnerability

Open a [GitHub issue](https://github.com/Grinv/mal-mcp/issues) or, for
anything sensitive, email the address on the maintainer's GitHub profile
(<https://github.com/Grinv>). Please don't file public issues for
vulnerabilities that could affect other users' MyAnimeList accounts before
there's a fix available.

Not affiliated with MyAnimeList. "MyAnimeList" is a trademark of its
respective owner.
