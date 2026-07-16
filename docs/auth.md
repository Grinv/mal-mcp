# Logging in to MyAnimeList

mal-mcp has three credential tiers, each unlocking more than the last:

| Tier                        | What you set                                                                                    | What it unlocks                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Nothing                  | —                                                                                               | All read tools (search, details, rankings, seasons, characters, reviews, profiles, …) via Jikan. Personal-list tools return an actionable "log in first" error.                                                                                                                                                                                                                                                                                            |
| 2. Client ID only           | `MAL_CLIENT_ID`                                                                                 | Everything in tier 1, **plus**: six read tools (`search_anime`, `search_manga`, `get_top_anime`, `get_top_manga`, `get_seasonal_anime`, `get_upcoming_season`) get more resilient — they automatically retry via the official MAL API (still no OAuth, just the Client ID) if Jikan's own live call to MAL fails. No login step needed for this. See [api-references.md](api-references.md) for why only these six. Personal-list tools still need tier 3. |
| 3. Client ID + a user token | `MAL_CLIENT_ID` + running `login_mal` (or pre-supplying `MAL_REFRESH_TOKEN`/`MAL_ACCESS_TOKEN`) | Everything above, **plus** the personal-list tools (`get_my_*`, `update_my_*`, `delete_my_*`) — these act on your own MAL account.                                                                                                                                                                                                                                                                                                                         |

So: setting just `MAL_CLIENT_ID` is worth doing even if you never plan to use
the personal-list tools — it's a free reliability upgrade for six read tools,
no login required. The rest of this doc covers reaching **tier 3** (the
one-time OAuth login) — steps 1-2 below also happen to be all that's needed
for tier 2, since both start with registering an app and setting the Client ID.

> mal-mcp is a **public OAuth client** — it runs on your machine and is
> distributed to everyone, so it has **no client secret** (a secret shipped in a
> public package wouldn't be secret). It uses PKCE instead. You only need a
> **Client ID**.

## 1. Register an API application (one minute)

1. Go to <https://myanimelist.net/apiconfig> → **Create ID**.
2. **App Type: `other`.** (This is the public-client type — no secret. Do _not_
   pick `web`, which forces a client secret this server doesn't use.)
3. **App Redirect URL:** `http://localhost:8080/callback`
   - It must match exactly. If port 8080 is taken on your machine, pick another
     port here and set `MAL_OAUTH_PORT` to the same value in the server env.
   - Nothing needs to be reachable there for remote setups — see step 3b.
4. Fill the other required fields however you like, agree, and save.
5. Copy the **Client ID**.

## 2. Configure the Client ID

Set `MAL_CLIENT_ID` in your MCP client config's `env` block (see
[clients.md](clients.md)), or the `.mcpb` install form in Claude Desktop. The
server does **not** read a `.env` file.

```json
"env": { "MAL_CLIENT_ID": "..." }
```

At this point you're at **tier 2** — restart the server/client and the six
resilience-fallback read tools are already active, no further steps needed.
Continue below only if you also want the personal-list tools (tier 3).

## 3. Run `login_mal`

Ask your assistant to run the **`login_mal`** tool (or just "log in to
MyAnimeList"). It returns an authorization URL. Open it, log in, click **Allow**.

**a. Local (server and browser on the same machine — Claude Desktop, local
Claude Code):** login completes automatically — the server catches the redirect
on `http://localhost:8080/callback`. Then call any personal-list tool (e.g.
`get_my_user_info`) to confirm.

**b. Remote/headless (server over SSH, in a container, or on another host):**
`localhost:8080` on the server isn't reachable from your browser, so after
clicking Allow you'll land on a page that fails to load. **Copy the full URL from
your browser's address bar** (it contains `?code=...`) and pass it to the
**`submit_mal_redirect`** tool. That completes the login.

The token is stored at `~/.config/mal-mcp/tokens.json`
(`%APPDATA%\mal-mcp\tokens.json` on Windows; override with `MAL_TOKEN_STORE`),
with `0600` permissions, and refreshed automatically from then on. MAL rotates the
refresh token on each refresh; the rotated one is written back.

## Advanced: skip `login_mal`

You can pre-supply tokens instead of running `login_mal`:

- **`MAL_REFRESH_TOKEN`** (+ `MAL_CLIENT_ID`) — enables the same silent
  auto-refresh without the interactive step.
- **`MAL_ACCESS_TOKEN`** — a standalone access token; works ~30 days with no
  refresh. Only useful for a quick throwaway test.

To obtain these by hand (PKCE `plain`, no secret):

```sh
CLIENT_ID="<your client id>"
REDIRECT_URI="http://localhost:8080/callback"
VERIFIER="$(node -e "console.log(require('crypto').randomBytes(64).toString('base64url'))")"

# Open this, click Allow, then copy the `code` from the redirected URL:
echo "https://myanimelist.net/v1/oauth2/authorize?response_type=code&client_id=${CLIENT_ID}&code_challenge=${VERIFIER}&code_challenge_method=plain&redirect_uri=${REDIRECT_URI}"

CODE="<code from the redirect>"
curl -s -X POST https://myanimelist.net/v1/oauth2/token \
  -d "client_id=${CLIENT_ID}" \
  -d "grant_type=authorization_code" \
  -d "code=${CODE}" \
  -d "code_verifier=${VERIFIER}" \
  -d "redirect_uri=${REDIRECT_URI}"
```

The response contains `access_token` and `refresh_token`.
