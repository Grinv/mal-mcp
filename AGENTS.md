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
scripts/          # build-tests.mjs, run-tests.mjs, check-api.mjs, sync-version.mjs,
                  # preversion-check.mjs (npm version gate — see skills/release/SKILL.md),
                  # check-changelog-coverage.mjs (see docs-consistency-check skill),
                  # check-chainable-optional-fields.mjs (see tool-description-check skill)
skills/           # reusable agent workflows for this repo (e.g. live-audit/) —
                  # plain Markdown with a YAML frontmatter name/description,
                  # not tied to any one tool's orchestration features, per
                  # this file's agent-agnostic policy; same skill name/layout
                  # as this project's sibling MCP servers (tmdb-mcp,
                  # steam-games-mcp, anilist-mcp-server) — sync improvements
                  # both ways rather than letting them drift. `.claude/skills`
                  # and `.agents/skills` are symlinks to this directory, so
                  # Claude Code/Codex CLI/Gemini CLI pick up every skill here
                  # without duplicating content per client path.
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
- Runtime floor is **Node ≥ 20.11** (global `fetch`/`AbortSignal.any` in
  `lib/http.ts`, `import.meta.dirname` in `scripts/*.mjs`, the test suite's
  `mock.timers` `'Date'` API). tsup targets `node20`. This floor covers
  `scripts/` too, not just `src/` — CI's `node: 20` matrix entry always
  resolves to the latest 20.x patch, so a script quietly needing a newer
  Node than the declared floor won't fail CI.
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
- `.optional()` in a raw `Raw*` input type (format.ts) is correct defensiveness —
  JSON off the wire is never guaranteed. Don't let that same `.optional()` carry
  through unexamined into the paired **output** schema in `format.schemas.ts`: if
  any tool's description promises a field is chainable ("obtain the mal_id from
  X," "pick a valid argument for Y"), that field must be required there, backed
  by a test that feeds a fully-populated fixture through the shaper. See the
  `tool-description-check` skill's "Reads — behavioral transparency" section for
  the full rationale and the 2026-07-30 `mal_id`/`get_seasons_list` `year`
  incidents that motivated it.
- Known upstream gotcha ([typescript-sdk#2464](https://github.com/modelcontextprotocol/typescript-sdk/issues/2464),
  open as of 2026-07-29): the SDK's Zod-v4-to-JSON-Schema conversion mishandles
  three patterns — raw `z.date()` throws and crashes `tools/list` entirely; a
  `.default()` on an **output** schema field still lists it in the advertised
  `required`, which the SDK's own client then uses to reject a response that
  omitted it in reliance on the default; and a plain (neither `.strict()` nor
  `.passthrough()`) **output** object gets `additionalProperties: false`
  advertised even though a lenient `z.object()` actually tolerates extras at
  parse time. None of these currently reproduce here — we use `z.iso.date()`
  (a string schema) instead of `z.date()`, every `.default()` we use is on an
  **input** field (confirmed unaffected: verified via both a raw
  `z.toJSONSchema` call and a live `tools/list` round-trip that a defaulted
  input field is correctly omitted from `required`), and every output schema
  is consistently `.strict()` or `.passthrough()` per the rule above (no
  lenient output object exists to trigger the third symptom). Re-check this
  note before adding `z.date()` anywhere, or a `.default()` to any schema in
  `format.schemas.ts`/`clients/mal.ts`.
- Write tool `description`s and per-field `.describe()` text for the calling
  model: explain when to use a tool and what each parameter means. Check new
  or edited descriptions against the `tool-description-check` skill (Glama's
  TDQS rubric) before committing.
- **Keep the same field name for the same concept across every tool that
  takes it** — grep sibling tools before naming a new field for an existing
  concept (e.g. `id` for a bare MAL numeric id across every `get_anime`/
  `get_manga`/`get_character`/`get_person`-style read tool). When an
  upstream field name genuinely can't match across a read/write pair — MAL's
  own API names the same watched-episode count `num_episodes_watched` on
  read but `num_watched_episodes` on write — call out the mismatch
  explicitly in that field's `.describe()` text (see
  `update_my_anime_status`) rather than leaving it for the caller to
  discover.
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

## Testing the live/published server

For a full audit of the currently published (or just-fixed) package —
build/test/lint plus hammering the live MCP tools with edge cases,
cross-checked against source — follow
[skills/live-audit/SKILL.md](skills/live-audit/SKILL.md). It covers the
safety rules for testing mutation tools against a real authenticated MAL
account, the dual-backend (Jikan / official-API-fallback) awareness needed
when reporting a finding, and known bug classes worth checking don't recur.

## Before opening a PR

Run `npm run build && npm test && npm run lint && npm run format:check`.
Update `CHANGELOG.md` (Unreleased section) — see the `changelog-style` skill for
entry style.

## Releasing

`package.json` is the single source of truth for the version; `npm version`
bumps + syncs every derived file + tags the release. See the `release` skill
for the full steps (including the `preversion` gate on `CHANGELOG.md` and
tool descriptions) and MCP Registry details.

## Reuse / shared architecture

This server follows a reusable shape: a generic carcass (`src/lib/` + build
tooling, tests infra, CI) and a thin domain layer (`config.ts`, `clients/`,
domain `tools/`, `prompts.ts`, `check-api.mjs`). New MCP servers (e.g. TMDB,
Steam) start from the **`mcp-server-template`** repository, which extracts that
carcass; only the domain layer is rewritten. Extract `lib/` into a shared npm
package only once cross-server duplication actually hurts (YAGNI) — not before.
