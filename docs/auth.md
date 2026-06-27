# Getting a MyAnimeList token

The read tools need no credentials. The **personal-list tools** (`get_my_*`,
`update_my_*`, `delete_my_*`) act on your own MAL account and require an OAuth
access token. This is a one-time manual step.

> The server never performs an interactive browser login. You obtain the token
> once, then provide it via configuration. With the client credentials + refresh
> token set, the server refreshes the access token silently afterwards.

> **Where each value comes from:** the **Client ID** and **Client Secret** are
> shown on the apiconfig page (step 1). The **access token** and **refresh token**
> are _not_ on the website — they are produced by the one-time authorization in
> step 2 (you exchange the `code` from the redirect for them).

## 1. Register an API application

1. Go to <https://myanimelist.net/apiconfig> → **Create ID**.
2. App Type: `web`. Set a **Redirect URI**, e.g. `http://localhost:8080/callback`
   (nothing needs to listen there — it is only where MAL redirects with the code).
3. Note your **Client ID** and **Client Secret**.

## 2. Authorize and exchange for tokens

MAL uses OAuth2 with PKCE (the `plain` method — `code_challenge` equals the
`code_verifier`).

```sh
CLIENT_ID="<your client id>"
CLIENT_SECRET="<your client secret>"
REDIRECT_URI="http://localhost:8080/callback"

# 1. Generate a PKCE code verifier (43-128 chars).
VERIFIER="$(node -e "console.log(require('crypto').randomBytes(64).toString('base64url'))")"

# 2. Open this URL, click "Allow", then copy the `code` query param from the
#    redirected URL in your browser's address bar.
echo "https://myanimelist.net/v1/oauth2/authorize?response_type=code&client_id=${CLIENT_ID}&code_challenge=${VERIFIER}&redirect_uri=${REDIRECT_URI}"

# 3. Exchange the code for tokens.
CODE="<code from the redirect>"
curl -s -X POST https://myanimelist.net/v1/oauth2/token \
  -d "client_id=${CLIENT_ID}" \
  -d "client_secret=${CLIENT_SECRET}" \
  -d "grant_type=authorization_code" \
  -d "code=${CODE}" \
  -d "code_verifier=${VERIFIER}" \
  -d "redirect_uri=${REDIRECT_URI}"
```

The response contains `access_token` (valid ~30 days) and `refresh_token`.

## 3. Configure the server

Recommended (enables silent refresh, so you do this only once):

```sh
export MAL_CLIENT_ID="<client id>"
export MAL_CLIENT_SECRET="<client secret>"
export MAL_REFRESH_TOKEN="<refresh token>"
# Optional: skips one refresh on first use.
export MAL_ACCESS_TOKEN="<access token>"
```

Minimal (token expires in ~30 days, then re-run step 2):

```sh
export MAL_ACCESS_TOKEN="<access token>"
```

### Storing the token securely (macOS example)

```sh
security add-generic-password -s mal-refresh-token -a "$USER" -w '<refresh token>'
export MAL_REFRESH_TOKEN="$(security find-generic-password -s mal-refresh-token -w)"
```

The rotated refresh token is cached at `~/.config/mal-mcp/tokens.json`
(`%APPDATA%\mal-mcp\tokens.json` on Windows). Delete that file to reset, or set
`MAL_TOKEN_STORE` to change its location.
