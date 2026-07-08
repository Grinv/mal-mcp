# AGENTS.md

Single source of truth for working on this repository — for **any** model or
agent. `CLAUDE.md` only links here (`@AGENTS.md`); keep all shared guidance in
this file, not in CLAUDE.md. (For end-user/runtime docs, see [README.md](README.md).)

## Project shape

A TypeScript MCP server. Hybrid backend: read tools call the public Jikan API
(no auth); personal-list tools call the official MyAnimeList API (user token).

> **Why reads go through Jikan, not the official MAL API.** The official API can
> serve public data without OAuth via an `X-MAL-CLIENT-ID` header, but that still
> requires a registered MAL application (a Client ID). Our read tools must work
> with **zero credentials**, so they use Jikan, which needs none. Don't "upgrade"
> reads to the official API — it would gate credential-free use behind a Client
> ID. Also: the official MAL character/people endpoints are explicitly
> undocumented and off-limits ("don't use them"), which is another reason those
> reads come from Jikan. The official API is used **only** for personal-list
> reads/writes that genuinely require a user's OAuth Bearer token.

Upstream API docs (rate limits, endpoints, OAuth, audit notes) are collected in
[docs/api-references.md](docs/api-references.md) — check there before changing a
client.

```
src/
  index.ts        # bin entry — calls start()
  server.ts       # buildServer() + start(); registers everything
  config.ts       # env → validated Config (zod)
  lib/            # http, rateLimit, cache, tokenStore, oauthLogin, errors, logger, result, format
  clients/        # jikan.ts (reads), mal.ts (personal list + token refresh + login)
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
- Runtime floor is **Node ≥ 18** (global `fetch`); tsup targets `node18`. Tests
  may run on newer Node but must not raise the runtime floor.
- Log to **stderr only** — stdout is the MCP protocol channel. Use the logger;
  it redacts credentials.
- Tool failures return `{ isError: true }` results (via `guard()` / `result.ts`),
  never thrown — the agent should get an actionable message.
- Write tool `description`s and per-field `.describe()` text for the calling
  model: explain when to use a tool and what each parameter means.
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
Update `CHANGELOG.md` (Unreleased section).

## Releasing

`package.json` is the **single source of truth** for the version. The npm
`version` lifecycle hook runs `scripts/sync-version.mjs`, which propagates it to
`src/version.ts`, `manifest.json` and `server.json` (incl. the `.mcpb` release-asset
URL); `version.test.ts` guards that they never drift. So a release is:

```sh
# 1. land your changes; move CHANGELOG.md's [Unreleased] notes under a new
#    [X.Y.Z] - YYYY-MM-DD heading and commit.
npm version <patch|minor|major>   # bumps + syncs every file + commits "release: vX.Y.Z" + tags vX.Y.Z
git push --follow-tags            # pushing the tag triggers .github/workflows/release.yml
```

The tag push (`v*`) runs the **Release** workflow: `check:api` gate → build → test
→ pack `.mcpb` → GitHub Release → `npm publish` (OIDC trusted publishing, with
provenance — no token) → **publish to the official MCP Registry** (`mcp-publisher`,
GitHub OIDC). Never hand-edit the version in the derived files; bump `package.json`
via `npm version` and let the hook sync the rest.

### MCP Registry

The server is listed at `registry.modelcontextprotocol.io` as
`io.github.Grinv/mal-mcp` (`server.json`), exposing **both** packages: the npm
package (`mal-mcp`, run via `npx`) and the `.mcpb` GitHub-release bundle.
Ownership is verified per package type:

- **npm** → the `mcpName` field in `package.json` must equal `server.json`'s `name`
  (guarded by `version.test.ts`). It ships in the published package, so it is
  set once and every release just works.
- **mcpb** → `server.json` needs the artifact's `fileSha256`. Because `.mcpb`
  (a zip) isn't byte-reproducible, the release workflow recomputes it from the
  just-packed bundle and injects it before `mcp-publisher publish` — no committed
  value is kept. The asset URL must contain "mcp" (it does).

The namespace `io.github.Grinv/*` is authorized by GitHub OIDC from this repo, so
no registry token/secret is needed. To publish manually instead:
`mcp-publisher login github && mcp-publisher publish`.

**Keep config in three places in sync.** A user-facing env var is declared in
`config.ts` (the source of truth), `manifest.json` `user_config` (the `.mcpb`
install form), and `server.json` `packages[].environmentVariables` (the registry
entry). When you add/rename/remove one in `config.ts`, update the other two —
`version.test.ts` guards that `manifest.json` and `server.json` agree, but it
can't see `config.ts`, so the `config.ts` → descriptors step is on you. Keep
`server.json` descriptions ≤ 100 chars (registry schema cap). Purely internal
tunables (timeouts, cache, rate limits, `LOG_LEVEL`) stay env-only — they don't
belong in the install form or registry entry.

## Reuse / shared architecture

This server follows a reusable shape: a generic carcass (`src/lib/` + build
tooling, tests infra, CI) and a thin domain layer (`config.ts`, `clients/`,
domain `tools/`, `prompts.ts`, `check-api.mjs`). New MCP servers (e.g. TMDB,
Steam) start from the **`mcp-server-template`** repository, which extracts that
carcass; only the domain layer is rewritten. Extract `lib/` into a shared npm
package only once cross-server duplication actually hurts (YAGNI) — not before.
