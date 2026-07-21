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
                  # format.schemas.ts: Zod schemas mirroring every format.ts/formatOfficial.ts
                  # shaper, PLUS clients/mal.ts's trimList()/deleteMy*ListItem() outputs
                  # (myListSchema, deleteAnimeItemSchema, deleteMangaItemSchema — shaped/
                  # client-synthesized output, not raw upstream passthrough, so they live
                  # here rather than in mal.ts); each tool's outputSchema, AND (schema-first)
                  # the paired shaper itself calls schema.parse() on its own result before
                  # returning
  clients/        # jikan.ts (reads) + jikanFallback.ts (retry policy), mal.ts
                  # (personal list + token refresh + login — MyUserInfoSchema/
                  # MalListResponseSchema/ListStatusUpdateResponseSchema stay here as
                  # .passthrough(), see below), officialReads.ts (Client-ID-only public
                  # reads, the fallback's data source), httpClients.ts (shared HttpClient
                  # factory for the official API, + withThrottle(), the rate-limit wiring
                  # shared with jikan.ts too)
  tools/          # read.ts, mylist.ts, login.ts (login_mal), guard.ts
  prompts.ts      # registerPrompts(server, jikan) — clients get threaded in as needed,
                  # e.g. for completable() autocomplete on recommend_similar's title
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
  it redacts credentials. MCP protocol revision 2026-07-28 deprecated
  server→client log notifications in favor of stderr (SEP-2577); `createLogger()`
  intentionally has no sink parameter — don't reintroduce client-push logging.
- Tool failures return `{ isError: true }` results (via `guard()` / `result.ts`),
  never thrown — the agent should get an actionable message.
- Every tool declares an `outputSchema` (SEP-2106, MCP structured content) — add
  or reuse a schema in `format.schemas.ts` (or the matching client's passthrough
  schema, e.g. in `clients/mal.ts`) for any new tool.
- Schemas in `format.schemas.ts` are `.strict()` (they describe shaped/summarized
  output — an unexpected field means the shaper and schema have drifted).
  Schemas in `clients/mal.ts` (`MyUserInfoSchema`, `MalListResponseSchema`,
  `ListStatusUpdateResponseSchema`) are deliberately `.passthrough()` instead —
  they validate raw upstream responses forwarded near-verbatim (MAL may extend
  them later). Don't unify the two styles.
- Write tool `description`s and per-field `.describe()` text for the calling
  model: explain when to use a tool and what each parameter means. Check new
  or edited descriptions against [docs/tool-descriptions.md](docs/tool-descriptions.md)
  (Glama's TDQS rubric) before committing.
- Tests must never depend on the real on-disk token store. `connectServer()` in
  `__tests__/helpers.ts` defaults `MAL_TOKEN_STORE` to a fresh per-call temp
  path — a new test that calls `buildServer()` directly (bypassing the helper)
  must do the same, or it will pick up the maintainer's real
  `~/.config/mal-mcp/tokens.json` on any machine that has run `login_mal`.
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
