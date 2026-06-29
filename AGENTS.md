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
  lib/            # http, rateLimit, cache, tokenStore, errors, logger, result, format
  clients/        # jikan.ts (reads), mal.ts (personal list + token refresh)
  tools/          # read.ts, mylist.ts, guard.ts
  prompts.ts
  __tests__/      # node:test (*.test.ts) + helpers.ts
scripts/          # build-tests.mjs, run-tests.mjs, check-api.mjs
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
- **Never commit secrets.** Tokens come from env vars / OS keychain only.
- Cross-platform: macOS, Linux and Windows. Avoid POSIX-only shell in npm
  scripts (use the Node helper scripts).
- **Commits:** author/committer `Grinv <4070730+Grinv@users.noreply.github.com>`;
  do **not** add a `Co-Authored-By` trailer.

## Before opening a PR

Run `npm run build && npm test && npm run lint && npm run format:check`.
Update `CHANGELOG.md` (Unreleased section).

## Reuse / shared architecture

This server follows a reusable shape: a generic carcass (`src/lib/` + build
tooling, tests infra, CI) and a thin domain layer (`config.ts`, `clients/`,
domain `tools/`, `prompts.ts`, `check-api.mjs`). New MCP servers (e.g. TMDB,
Steam) start from the **`mcp-server-template`** repository, which extracts that
carcass; only the domain layer is rewritten. Extract `lib/` into a shared npm
package only once cross-server duplication actually hurts (YAGNI) — not before.
