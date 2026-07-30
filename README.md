# MAL MCP Server

[![npm version](https://img.shields.io/npm/v/mal-mcp.svg)](https://www.npmjs.com/package/mal-mcp)
[![CI](https://github.com/Grinv/mal-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Grinv/mal-mcp/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/npm/l/mal-mcp.svg)](LICENSE)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-io.github.Grinv%2Fmal--mcp-blue)](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.Grinv/mal-mcp&version=latest)
[![mal-mcp MCP server](https://glama.ai/mcp/servers/Grinv/mal-mcp/badges/score.svg)](https://glama.ai/mcp/servers/Grinv/mal-mcp)

An [MCP](https://modelcontextprotocol.io) server for **MyAnimeList**. It works with
any MCP-compatible client or agent (Claude Desktop/Code, Cursor, VS Code, Cline,
Continue, and others) — the server speaks the standard MCP stdio protocol.

## What it does

It uses a hybrid backend:

- **Reads → [Tenrai](https://tenrai.org) (free, unofficial MAL API).** Search,
  details, rankings, seasons, characters, recommendations and reviews. No
  credentials required.
- **Your personal list → official [MyAnimeList API](https://myanimelist.net/apiconfig/references/api/v2).**
  Read, update and delete entries on your own anime/manga list. Requires a
  one-time login (see below).

## What you need (and what it gets you)

Nothing is required to get started — you can skip straight to
[Install](#install). Everything below is optional, and each step just adds
more:

| You set...                                                                                                                                            | You get...                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| _(nothing)_                                                                                                                                           | Search, details, rankings, seasons, characters, reviews, and more — works immediately, no signup.                                                                                 |
| A MyAnimeList **Client ID** ([2 minutes, free →](#connect-your-myanimelist-account-for-the-personal-list-tools))                                      | Same as above, plus: 11 read tools (search, rankings, seasons, recommendations, details, statistics) keep working smoothly even during a MyAnimeList hiccup. Still no login step. |
| The Client ID above, **plus** running the `login_mal` tool once ([same walkthrough →](#connect-your-myanimelist-account-for-the-personal-list-tools)) | Everything above, plus your **own MyAnimeList list**: view it, add/update entries, mark things watched, remove entries.                                                           |

Without a login, the personal-list tools reply with a clear message telling
you how to get one — everything else keeps working regardless.

## Example queries

Once it's connected, just ask your agent in natural language.

**No credentials needed** (search, details, rankings, seasons, characters, …):

```
"Search for the anime Frieren and show its score, studio and synopsis."
"What are the top 10 anime of all time?"
"What's airing this season? Sort by popularity."
"Recommend anime similar to Steins;Gate."
"What are people saying in reviews of Chainsaw Man?"
"Show the main characters and Japanese voice actors of Cowboy Bebop."
"When does the next episode of One Piece air?"
"Give me the top manga in the Romance genre."
"What's on the upcoming season's schedule?"
"Pick a random highly-rated anime for me."
```

**With your MyAnimeList account** (after a one-time `login_mal`; see
[Connect your MyAnimeList account](#connect-your-myanimelist-account-for-the-personal-list-tools)):

```
"Show my MAL profile and watching stats."
"What's on my anime list that I marked as watching?"
"Add Frieren to my plan-to-watch list."
"Set Cowboy Bebop to completed with a score of 9."
"Bump my episode count for One Piece to 1095."
"Remove Bleach from my manga list."
```

## Tools

| Tool                                                                                  | Backend | Auth  |
| ------------------------------------------------------------------------------------- | ------- | ----- |
| `search_anime`, `search_manga`                                                        | Tenrai  | none  |
| `get_anime`, `get_manga`                                                              | Tenrai  | none  |
| `get_anime_characters`, `get_anime_recommendations`, `get_anime_reviews`              | Tenrai  | none  |
| `get_manga_characters`, `get_manga_recommendations`, `get_manga_reviews`              | Tenrai  | none  |
| `get_recent_anime_recommendations`, `get_recent_manga_recommendations`                | Tenrai  | none  |
| `get_anime_episodes`, `get_anime_videos`                                              | Tenrai  | none  |
| `get_anime_genres`, `get_manga_genres`                                                | Tenrai  | none  |
| `search_characters`, `get_character`                                                  | Tenrai  | none  |
| `search_people`, `get_person`, `get_anime_staff`                                      | Tenrai  | none  |
| `get_anime_statistics`, `get_manga_statistics`                                        | Tenrai  | none  |
| `get_random_anime`, `get_random_manga`, `get_random_character`, `get_random_person`   | Tenrai  | none  |
| `get_anime_news`, `get_news`                                                          | Tenrai  | none  |
| `get_top_anime`, `get_top_manga`                                                      | Tenrai  | none  |
| `get_top_people`, `get_top_characters`                                                | Tenrai  | none  |
| `get_seasonal_anime`, `get_upcoming_season`, `get_seasons_list`, `get_anime_schedule` | Tenrai  | none  |
| `get_producers`, `get_producer`, `get_magazines`                                      | Tenrai  | none  |
| `get_my_user_info`, `get_my_anime_list`, `get_my_manga_list`                          | MAL     | token |
| `update_my_anime_status`, `update_my_manga_status`                                    | MAL     | token |
| `delete_my_anime_list_item`, `delete_my_manga_list_item`                              | MAL     | token |
| `login_mal`, `submit_mal_redirect`                                                    | MAL     | login |

`token` = needs a MyAnimeList login (run `login_mal` once). Prompts:
`recommend_similar`, `seasonal_overview`, `hidden_gems`. `recommend_similar`'s
title is optional — omit it and it'll ask which anime you mean; clients that
support prompt-argument completion get live title suggestions as you type.

## Install

### As an `.mcpb` bundle (one-click, e.g. Claude Desktop)

Download [**`mal-mcp.mcpb`**](https://github.com/Grinv/mal-mcp/releases/latest/download/mal-mcp.mcpb)
(always the latest release) and open it with your MCP client. It prompts for an optional
MyAnimeList **Client ID** — set it and run the `login_mal` tool to enable the personal-list
tools (see [Connect your MyAnimeList account](#connect-your-myanimelist-account-for-the-personal-list-tools)).
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
[docs/auth.md](https://github.com/Grinv/mal-mcp/blob/main/docs/auth.md) for the full login walkthrough and
[docs/clients.md](https://github.com/Grinv/mal-mcp/blob/main/docs/clients.md) for more clients.

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
> [docs/auth.md](https://github.com/Grinv/mal-mcp/blob/main/docs/auth.md) for how to obtain them by hand.

## Configuration

All configuration is via environment variables, all optional — without credentials
the read tools still work. For the personal-list tools, set `MAL_CLIENT_ID` and run
the `login_mal` tool once; the access token is then fetched and refreshed
automatically. (mal-mcp is a public PKCE client — there is **no client secret**.)

| Variable            | Purpose                                                                                                                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MAL_CLIENT_ID`     | Your MyAnimeList Client ID — see [Connect your MyAnimeList account](#connect-your-myanimelist-account-for-the-personal-list-tools) for how to get one (it's free, ~2 minutes, no coding involved).                   |
| `MAL_REFRESH_TOKEN` | _Advanced, optional._ Skips the interactive `login_mal` step by pre-supplying a token directly. Most people won't need this — see [docs/auth.md](https://github.com/Grinv/mal-mcp/blob/main/docs/auth.md) if you do. |
| `MAL_ACCESS_TOKEN`  | _Advanced, optional._ A standalone token that works ~30 days without refreshing. See [docs/auth.md](https://github.com/Grinv/mal-mcp/blob/main/docs/auth.md).                                                        |

### Tuning (rarely needed)

These have sensible defaults; change them only if you need different timing,
a different upstream base URL, or want to override where/how the server logs
or stores its token.

| Variable                                                | Purpose                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MAL_TOKEN_STORE`                                       | Override where the login token is saved on disk (default: your OS's config folder).                                                                                                                                                                                     |
| `MAL_OAUTH_PORT`                                        | Only needed if port `8080` is already in use on your machine — see step 1 of the [account walkthrough](#connect-your-myanimelist-account-for-the-personal-list-tools).                                                                                                  |
| `LOG_LEVEL`                                             | How much the server logs: `debug` \| `info` \| `warn` \| `error` \| `silent` (default `info`). Logs go to stderr only — there's no MCP-level log capability, so a client can't fetch or filter them via `logging/setLevel`; check the server process's stderr directly. |
| `TENRAI_MIN_INTERVAL_MS`                                | Min spacing between Tenrai calls (default `300`). On top of this the client enforces Tenrai's published 4/s **and** 120/min public limits; set to `0` to disable all client-side throttling.                                                                            |
| `CACHE_TTL_MS`                                          | TTL for the in-memory read cache (default `300000` = 5 min).                                                                                                                                                                                                            |
| `HTTP_TIMEOUT_MS`, `HTTP_RETRIES`                       | Per-request timeout (default `15000`) and retry attempts for transient failures (default `2`).                                                                                                                                                                          |
| `TENRAI_BASE_URL`, `MAL_BASE_URL`, `MAL_OAUTH_BASE_URL` | Override upstream base URLs.                                                                                                                                                                                                                                            |

Provide these in your MCP client config's `env` block (the server does **not**
read a `.env` file). See [docs/auth.md](https://github.com/Grinv/mal-mcp/blob/main/docs/auth.md) for how to obtain the
credentials, and
[docs/clients.md](https://github.com/Grinv/mal-mcp/blob/main/docs/clients.md) for client configuration snippets.

## NSFW content

NSFW (adult) results are **not** filtered by default — the server returns whatever
the upstream API provides. Most read tools (`search_anime`, `search_manga`,
`get_seasonal_anime`, `get_upcoming_season`, `get_anime_schedule`, `get_top_anime`,
`get_top_manga`, `get_random_anime`, `get_random_manga`) accept two filter levels:

- `sfw: true` — excludes adult/explicit-rated entries (R+ Mild Nudity and up).
- `sfw_strict: true` — also excludes anything tagged with the Ecchi genre, even
  otherwise mainstream, safely-rated shows that `sfw` alone still lets through
  (e.g. _No Game No Life_, _Kill la Kill_).

`search_anime` and `get_top_anime`/`get_seasonal_anime`/`get_upcoming_season` also
accept a `rating` filter for finer-grained control — target one or more specific
MAL content ratings (e.g. `pg13`, `r17`) directly instead of a blanket adult-content
cutoff.

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

Runtime requires Node ≥ 20.11 (global `fetch`, `AbortSignal.any`). See
[AGENTS.md](AGENTS.md) for contributor/agent guidance.

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
MyAnimeList. Read data is provided by [Tenrai](https://tenrai.org), a free,
unofficial MAL API; please respect its rate limits. Personal-list operations use the official
[MyAnimeList API](https://myanimelist.net/apiconfig/references/api/v2) under your
own account and token. Use is subject to the
[MyAnimeList Terms of Service](https://myanimelist.net/about/terms_of_use).

## Privacy Policy

`mal-mcp` runs locally on your machine and has no telemetry of its own — see
[PRIVACY.md](PRIVACY.md) for exactly what data it handles (including what the
personal-list tools can read and change on your real MyAnimeList account),
what it sends to Tenrai/MyAnimeList, and what (if anything) it stores on disk.

## Security

See [SECURITY.md](SECURITY.md) for the read/write tool distinction, token
storage, credential redaction, and how to report a vulnerability.

## License

[MIT](LICENSE) © Grinv
