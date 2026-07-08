# mal-mcp

[![npm version](https://img.shields.io/npm/v/mal-mcp.svg)](https://www.npmjs.com/package/mal-mcp)
[![CI](https://github.com/Grinv/mal-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Grinv/mal-mcp/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/npm/l/mal-mcp.svg)](LICENSE)

An [MCP](https://modelcontextprotocol.io) server for **MyAnimeList**. It works with
any MCP-compatible client or agent (Claude Desktop/Code, Cursor, VS Code, Cline,
Continue, and others) — the server speaks the standard MCP stdio protocol.

## What it does

It uses a hybrid backend:

- **Reads → [Jikan](https://jikan.moe) (unofficial MAL API).** Search, details,
  rankings, seasons, characters, recommendations, reviews and public profiles.
  No credentials required.
- **Your personal list → official [MyAnimeList API](https://myanimelist.net/apiconfig/references/api/v2).**
  Read, update and delete entries on your own anime/manga list. Requires a user
  token (see [docs/auth.md](docs/auth.md)).

If no token is configured, the personal-list tools return a clear, actionable
error and everything else keeps working.

## Tools

| Tool                                                                                  | Backend | Auth  |
| ------------------------------------------------------------------------------------- | ------- | ----- |
| `search_anime`, `search_manga`                                                        | Jikan   | none  |
| `get_anime`, `get_manga`                                                              | Jikan   | none  |
| `get_anime_characters`, `get_anime_recommendations`, `get_anime_reviews`              | Jikan   | none  |
| `get_manga_characters`, `get_manga_recommendations`, `get_manga_reviews`              | Jikan   | none  |
| `get_anime_episodes`                                                                  | Jikan   | none  |
| `get_anime_genres`, `get_manga_genres`                                                | Jikan   | none  |
| `search_characters`, `get_character`                                                  | Jikan   | none  |
| `search_people`, `get_person`, `get_anime_staff`                                      | Jikan   | none  |
| `get_anime_statistics`, `get_manga_statistics`                                        | Jikan   | none  |
| `get_random_anime`, `get_random_manga`, `get_random_character`, `get_random_person`   | Jikan   | none  |
| `get_anime_news`                                                                      | Jikan   | none  |
| `get_top_anime`, `get_top_manga`                                                      | Jikan   | none  |
| `get_top_people`, `get_top_characters`                                                | Jikan   | none  |
| `get_seasonal_anime`, `get_upcoming_season`, `get_seasons_list`, `get_anime_schedule` | Jikan   | none  |
| `get_producers`                                                                       | Jikan   | none  |
| `get_user_profile`, `get_user_favorites`                                              | Jikan   | none  |
| `get_my_user_info`, `get_my_anime_list`, `get_my_manga_list`                          | MAL     | token |
| `update_my_anime_status`, `update_my_manga_status`                                    | MAL     | token |
| `delete_my_anime_list_item`, `delete_my_manga_list_item`                              | MAL     | token |
| `login_mal`, `submit_mal_redirect`                                                    | MAL     | login |

`token` = needs a MyAnimeList login (run `login_mal` once). Prompts:
`recommend_similar`, `seasonal_overview`.

## Install

### As an `.mcpb` bundle (one-click, e.g. Claude Desktop)

Download `mal-mcp.mcpb` from the [latest release](https://github.com/Grinv/mal-mcp/releases)
and open it with your MCP client. It prompts for an optional MyAnimeList **Client
ID** — set it and run the `login_mal` tool to enable the personal-list tools (see
[Connect your MyAnimeList account](#connect-your-myanimelist-account-for-the-personal-list-tools)).
Leave it blank to use just the credential-free read tools.

### From source

```sh
git clone https://github.com/Grinv/mal-mcp
cd mal-mcp
npm ci
npm run build
```

This produces a self-contained `dist/index.js`. Point your client at it (see below).

## Connect it to an MCP client

Add the server to your client's MCP config (Claude Desktop/Code, Cursor, VS Code,
Cline, …). The simplest option is `npx` — no clone, no build:

```json
{
  "mcpServers": {
    "mal": {
      "command": "npx",
      "args": ["-y", "mal-mcp"],
      "env": {
        "MAL_CLIENT_ID": "..."
      }
    }
  }
}
```

Or with the Claude Code CLI:

```sh
claude mcp add mal -e MAL_CLIENT_ID=... -- npx -y mal-mcp
```

If you built from source instead, replace `"command": "npx", "args": ["-y", "mal-mcp"]`
with `"command": "node", "args": ["/absolute/path/to/mal-mcp/dist/index.js"]`.

The `env` block is **optional** — omit it to use only the credential-free read
tools (search, details, rankings, …); the personal-list tools will return a clear
error until you log in. To enable them, set `MAL_CLIENT_ID` and run the
**`login_mal`** tool once (a one-time browser authorization; the token is then
stored and refreshed automatically). The server does not read a `.env` file, so
pass config via this `env` block (or your shell environment). See
[docs/auth.md](docs/auth.md) for the full login walkthrough and
[docs/clients.md](docs/clients.md) for more clients.

## Connect your MyAnimeList account (for the personal-list tools)

The search/browse tools work with **no setup**. To use the personal-list tools
(`get_my_*`, `update_my_*`, `delete_my_*`), authorize your account once. It takes
about two minutes. There is **no client secret** — mal-mcp uses the modern
public-client flow (PKCE), so you only need a Client ID.

**Step 1 — Register a MyAnimeList app (one minute).**

1. Go to <https://myanimelist.net/apiconfig> and click **Create ID**.
2. **App Type:** choose **`other`**. _(Not `web` — that type forces a client
   secret this server doesn't use.)_
3. **App Redirect URL:** enter exactly
   ```
   http://localhost:8080/callback
   ```
   _(If port 8080 is already used on your machine, pick another port here and set
   `MAL_OAUTH_PORT` to the same number — see [Configuration](#configuration).)_
4. Fill the remaining required fields with anything reasonable, accept the terms,
   and **Submit**.
5. Open your new app and copy its **Client ID**.

**Step 2 — Give the Client ID to the server.**

Add it to your MCP client config (or paste it into the Claude Desktop install
form). Nothing else is needed here:

```json
"env": { "MAL_CLIENT_ID": "paste-your-client-id-here" }
```

Restart the server/client so it picks up the value.

**Step 3 — Log in (one click).**

In your assistant, run the **`login_mal`** tool (or just say _"log in to
MyAnimeList"_). It replies with a link. Open the link, sign in to MAL, and click
**Allow**.

- **Running locally** (Claude Desktop, or Claude Code on your own machine):
  login finishes **automatically** the moment you click Allow. Confirm with
  _"show my MAL profile"_ (`get_my_user_info`).
- **Running on a remote/SSH/headless host:** after clicking Allow your browser
  lands on a page that won't load — that's expected. **Copy the full address
  from the browser's address bar** (it contains `?code=…`) and give it to the
  **`submit_mal_redirect`** tool to finish.

That's it. The token is saved locally (`~/.config/mal-mcp/tokens.json`, `0600`)
and refreshed automatically from now on — you won't need to log in again.

> **Prefer no interactive step?** You can instead pre-set `MAL_REFRESH_TOKEN`
> (with `MAL_CLIENT_ID`) or a standalone `MAL_ACCESS_TOKEN`. See
> [docs/auth.md](docs/auth.md) for how to obtain them by hand.

## Configuration

All configuration is via environment variables, all optional — without credentials
the read tools still work. For the personal-list tools, set `MAL_CLIENT_ID` and run
the `login_mal` tool once; the access token is then fetched and refreshed
automatically. (mal-mcp is a public PKCE client — there is **no client secret**.)

| Variable            | Purpose                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| `MAL_CLIENT_ID`     | Your MAL app (type `other`) Client ID. Then run `login_mal`. See [docs/auth.md](docs/auth.md).    |
| `MAL_REFRESH_TOKEN` | _Advanced/optional._ Pre-supply a refresh token instead of running `login_mal`.                   |
| `MAL_ACCESS_TOKEN`  | _Advanced/optional._ A standalone token; works ~30 days, no refresh.                              |
| `MAL_TOKEN_STORE`   | Override the token cache path (default: OS config dir).                                           |
| `MAL_OAUTH_PORT`    | Localhost port for the `login_mal` callback (default `8080`); must match your app's Redirect URI. |
| `LOG_LEVEL`         | `debug` \| `info` \| `warn` \| `error` \| `silent` (default `info`).                              |

### Tuning (rarely needed)

These have sensible defaults; change them only if you self-host Jikan or need
different timing.

| Variable                                               | Purpose                                                                                                                                                                            |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JIKAN_MIN_INTERVAL_MS`                                | Min spacing between Jikan calls (default `400`). On top of this the client enforces Jikan's published 3/s **and** 60/min limits; set to `0` to disable all client-side throttling. |
| `CACHE_TTL_MS`                                         | TTL for the in-memory read cache (default `300000` = 5 min).                                                                                                                       |
| `HTTP_TIMEOUT_MS`, `HTTP_RETRIES`                      | Per-request timeout (default `15000`) and retry attempts for transient failures (default `2`).                                                                                     |
| `JIKAN_BASE_URL`, `MAL_BASE_URL`, `MAL_OAUTH_BASE_URL` | Override upstream base URLs (e.g. a self-hosted Jikan instance).                                                                                                                   |

Provide these in your MCP client config's `env` block (the server does **not**
read a `.env` file). See [docs/auth.md](docs/auth.md) for how to obtain the
credentials, and
[docs/clients.md](docs/clients.md) for client configuration snippets.

## NSFW content

NSFW (adult) results are **not** filtered by default — the server returns whatever
the upstream API provides. Search tools accept an optional `sfw` parameter; set
`sfw: true` to exclude adult entries via Jikan.

## Development

```sh
npm run build        # type-check + bundle to dist/
npm test             # node:test suite (mocked, offline)
npm run test:coverage
npm run lint
npm run format
npm run check:api    # live health-check of upstream endpoints
npm run inspector    # run under the MCP Inspector
```

Runtime requires Node ≥ 18 (global `fetch`). See [AGENTS.md](AGENTS.md) for
contributor/agent guidance.

## Updating

To be notified of new versions, click **Watch → Releases** on GitHub.

- **`.mcpb` bundle:** download the new `mal-mcp.mcpb` from the
  [releases page](https://github.com/Grinv/mal-mcp/releases) and reinstall it in
  your client (it replaces the old version).
- **From source:** `git pull && npm ci && npm run build`.
- **npx (after npm publish):** unpinned `npx -y mal-mcp` fetches the latest on
  the next run; if you pinned a version, bump it.

See the [CHANGELOG](CHANGELOG.md) for what changed in each release.

## Attribution and terms

This is an **unofficial** project and is not affiliated with or endorsed by
MyAnimeList. Read data is provided by [Jikan](https://jikan.moe), an unofficial
MAL API; please respect its rate limits. Personal-list operations use the official
[MyAnimeList API](https://myanimelist.net/apiconfig/references/api/v2) under your
own account and token. Use is subject to the
[MyAnimeList Terms of Service](https://myanimelist.net/about/terms_of_use).

## License

[MIT](LICENSE) © Grinv
