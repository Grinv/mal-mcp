# mal-mcp

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

| Tool                                                                     | Backend | Auth  |
| ------------------------------------------------------------------------ | ------- | ----- |
| `search_anime`, `search_manga`                                           | Jikan   | none  |
| `get_anime`, `get_manga`                                                 | Jikan   | none  |
| `get_anime_characters`, `get_anime_recommendations`, `get_anime_reviews` | Jikan   | none  |
| `get_top_anime`, `get_top_manga`                                         | Jikan   | none  |
| `get_seasonal_anime`, `get_anime_schedule`                               | Jikan   | none  |
| `get_user_profile`, `get_user_favorites`                                 | Jikan   | none  |
| `get_my_user_info`, `get_my_anime_list`, `get_my_manga_list`             | MAL     | token |
| `update_my_anime_status`, `update_my_manga_status`                       | MAL     | token |
| `delete_my_anime_list_item`, `delete_my_manga_list_item`                 | MAL     | token |

Prompts: `recommend_similar`, `seasonal_overview`.

## Install

### As an `.mcpb` bundle (one-click, e.g. Claude Desktop)

Download `mal-mcp.mcpb` from the [latest release](https://github.com/Grinv/mal-mcp/releases)
and open it with your MCP client. The client will prompt for the optional token
fields.

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
Cline, …). Use the absolute path to the built `dist/index.js`:

```json
{
  "mcpServers": {
    "mal": {
      "command": "node",
      "args": ["/absolute/path/to/mal-mcp/dist/index.js"],
      "env": {
        "MAL_CLIENT_ID": "...",
        "MAL_CLIENT_SECRET": "...",
        "MAL_REFRESH_TOKEN": "..."
      }
    }
  }
}
```

Or with the Claude Code CLI:

```sh
claude mcp add mal \
  -e MAL_CLIENT_ID=... -e MAL_CLIENT_SECRET=... -e MAL_REFRESH_TOKEN=... \
  -- node /absolute/path/to/mal-mcp/dist/index.js
```

The `env` block is **optional** — omit it to use only the credential-free read
tools (search, details, rankings, …); the personal-list tools will return a clear
error until a token is configured. The server does not read a `.env` file, so pass
credentials via this `env` block (or your shell environment). See
[docs/auth.md](docs/auth.md) for obtaining the token values and
[docs/clients.md](docs/clients.md) for more clients.

## Configuration

The server reads configuration from environment variables. All are optional;
without a token the read tools still work.

| Variable                                                  | Purpose                                                              |
| --------------------------------------------------------- | -------------------------------------------------------------------- |
| `MAL_ACCESS_TOKEN`                                        | User token for personal-list tools.                                  |
| `MAL_CLIENT_ID`, `MAL_CLIENT_SECRET`, `MAL_REFRESH_TOKEN` | Enable silent token refresh (recommended — avoids monthly re-auth).  |
| `MAL_TOKEN_STORE`                                         | Override the token cache path (default: OS config dir).              |
| `LOG_LEVEL`                                               | `debug` \| `info` \| `warn` \| `error` \| `silent` (default `info`). |

The server only reads `MAL_ACCESS_TOKEN` (and friends) — it does not care how you
populate them. For example, on macOS you can keep the token in the Keychain and
export it from your shell:

```sh
export MAL_ACCESS_TOKEN="$(security find-generic-password -s mal-access-token -w)"
```

See [docs/auth.md](docs/auth.md) for how to obtain a token, and
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
