# Logging in to MyAnimeList

The read tools need no credentials. The **personal-list tools** (`get_my_*`,
`update_my_*`, `delete_my_*`) act on your own MAL account and need a one-time
authorization. The `login_mal` tool does the whole OAuth dance for you and stores
the token; afterwards it refreshes silently, so this is a one-time step.

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
