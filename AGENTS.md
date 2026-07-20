# AGENTS.md

Single source of truth for working on this repository — for **any** model or
agent. `CLAUDE.md` only links here (`@AGENTS.md`); keep all shared guidance in
this file, not in CLAUDE.md. (For end-user/runtime docs, see [README.md](README.md).)

## Project shape

A TypeScript MCP server. Hybrid backend: read tools call the public Jikan API
(no auth); personal-list tools call the official MyAnimeList API (user token).
Eleven read tools (search/top/seasonal/recommendations/details/anime
statistics) additionally fall back to the official API via just a Client ID —
see `JikanFallback` in `clients/jikanFallback.ts` and the rationale/scope in
[docs/api-references.md](docs/api-references.md) before changing a client. [docs/auth.md](docs/auth.md) lays out what each
credential tier (none / Client ID / OAuth token) unlocks — read that before
changing auth-gating logic or docs that describe it.

Upstream API docs (rate limits, endpoints, OAuth, audit notes) are collected in
[docs/api-references.md](docs/api-references.md) — check there before changing a
client.

```
src/
  index.ts        # bin entry — calls start()
  server.ts       # buildServer() + start(); registers everything
  config.ts       # env → validated Config (zod)
  lib/            # http, rateLimit, cache, tokenStore, oauthLogin, errors, logger,
                  # result, format(+formatOfficial for the fallback's response shaping)
  clients/        # jikan.ts (reads) + jikanFallback.ts (retry policy), mal.ts
                  # (personal list + token refresh + login), officialReads.ts
                  # (Client-ID-only public reads, the fallback's data source),
                  # httpClients.ts (shared HttpClient factory for the official API,
                  # + withThrottle(), the rate-limit wiring shared with jikan.ts too)
  tools/          # read.ts, mylist.ts, login.ts (login_mal), guard.ts
  prompts.ts
  __tests__/      # node:test (*.test.ts) + helpers.ts
scripts/          # build-tests.mjs, run-tests.mjs, check-api.mjs, sync-version.mjs
```

## Commands

```sh
npm run build          # tsc --noEmit + tsup → dist/index.js (single ESM bundle)
npm test               # build tests with esbuild, run with node:test
npm run test:coverage  # same, with coverage (gate: ~80%)
npm run lint           # eslint
npm run format         # prettier --write
npm run check:api      # live upstream health-check (network)
```

## Conventions

- **Docs and in-code text are English** (README, docs, comments, tool
  descriptions, error messages).
- Runtime floor is **Node ≥ 20.3** (global `fetch`, `AbortSignal.any` in
  `lib/http.ts`); tsup targets `node20`. Tests may run on newer Node but must
  not raise the runtime floor.
- Log to **stderr only** — stdout is the MCP protocol channel. Use the logger;
  it redacts credentials.
- Tool failures return `{ isError: true }` results (via `guard()` / `result.ts`),
  never thrown — the agent should get an actionable message.
- Write tool `description`s and per-field `.describe()` text for the calling
  model: explain when to use a tool and what each parameter means. Check new
  or edited descriptions against [docs/tool-descriptions.md](docs/tool-descriptions.md)
  (Glama's TDQS rubric) before committing.
- Keep dependencies minimal. New deps need a clear justification (supply-chain).
- **Never commit secrets.** Credentials come from env vars, the `login_mal`
  OAuth flow, or the on-disk token store (`tokenStore.ts`, `0600`) — never
  hardcoded or committed. mal-mcp is a public PKCE client: there is **no client
  secret** (see the OAuth note in [docs/api-references.md](docs/api-references.md)).
- Cross-platform: macOS, Linux and Windows. Avoid POSIX-only shell in npm
  scripts (use the Node helper scripts).
- **Commits:** author/committer `Grinv <4070730+Grinv@users.noreply.github.com>`;
  do **not** add a `Co-Authored-By` trailer.

## Before opening a PR

Run `npm run build && npm test && npm run lint && npm run format:check`.
Update `CHANGELOG.md` (Unreleased section) — see
[docs/changelog-style.md](docs/changelog-style.md) for entry style.

## Releasing

`package.json` is the single source of truth for the version; `npm version`
bumps + syncs every derived file + tags the release. See
[docs/releasing.md](docs/releasing.md) for the full steps and MCP Registry details.

## Reuse / shared architecture

This server follows a reusable shape: a generic carcass (`src/lib/` + build
tooling, tests infra, CI) and a thin domain layer (`config.ts`, `clients/`,
domain `tools/`, `prompts.ts`, `check-api.mjs`). New MCP servers (e.g. TMDB,
Steam) start from the **`mcp-server-template`** repository, which extracts that
carcass; only the domain layer is rewritten. Extract `lib/` into a shared npm
package only once cross-server duplication actually hurts (YAGNI) — not before.
