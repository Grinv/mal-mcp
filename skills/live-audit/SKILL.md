---
name: live-audit
description: Audit mal-mcp — build/test/lint gate, live MCP tool edge-case sweep (input validation, not-found paths, mutations with capture/revert), source-level code review, and docs/metadata consistency. Use when asked to test/audit the published or just-fixed mal-mcp package, hunt for bugs/edge cases, or repeat "the same kind of testing as before."
---

# live-audit — mal-mcp health check + edge-case hunt

Repo-specific playbook, for any agent/model working on this repo (not tied to
a particular harness — see `AGENTS.md`'s own agent-agnostic framing). Use it
when asked to test/audit the published or just-fixed mal-mcp package, hunt
for bugs/edge cases, or repeat "the same kind of testing as before." Sibling
repos (`tmdb-mcp`, `steam-games-mcp`, `anilist-mcp-server`) keep their own
`skills/live-audit/SKILL.md` — when either this file or a sibling's improves,
sync the useful parts both ways rather than letting them drift.

Goal: find real bugs/inaccuracies in the live tool behavior (against the real
Tenrai API, its official-MAL-API fallback, and the official MAL API itself)
and in the source, then fix what's found. Read `AGENTS.md` first if it's not
already in context — every fix must follow its conventions (`guard()`/
never-throw, `format.schemas.ts`'s `.strict()` shaper/schema 1:1 rule vs.
`clients/mal.ts`'s deliberate `.passthrough()`, commit author/no-Co-Authored-By,
etc.).

This assumes the server is already reachable as an MCP connection in your
current session (e.g. as `mcp__mal__*` tools in Claude Code). If it isn't
connected, connect it first rather than skipping straight to step 1.

## Contents

- 0. Confirm "published"/"fixed" actually means what you think it means
- 1. Static pass first (cheap, catches regressions before you burn API calls)
- 2. Safety rules for live testing (read before calling anything)
- 3. Live edge-case sweep
- 4. Source-level code review
- 5. Docs/metadata consistency
- 6. Report, then fix only what's confirmed
- 7. Commit + changelog, if asked

## 0. Confirm "published"/"fixed" actually means what you think it means

```sh
node -p "require('./package.json').version"; npm view mal-mcp version; git log --oneline -5
```

If `package.json`'s version matches the npm-published version, live-testing
the running tools _is_ testing the published package. If you've since made
local fixes, remember the running MCP server is a **separate process** from
your edits — stdio servers don't hot-reload. Ask for a restart before
trusting a live call against fixed code, and state plainly whether findings
apply to the published package or to fixed-but-unreleased/unrestarted code.

## 1. Static pass first (cheap, catches regressions before you burn API calls)

```sh
npm run build && npm test && npm run lint && npm run format:check
```

Optionally `npm run check:api` too — a live upstream health-check against
both Tenrai and (if `MAL_CLIENT_ID`/OAuth creds are set) the official API. A
failure there can mean either a genuine shape drift (a real finding) or a
transient Tenrai/MAL outage (see `notes/tenrai-reliability.md` — gitignored
local log; check it before re-diagnosing a failure as new). **Note
`check-api.mjs`'s own scope**: it does a raw `fetch()` with just
`{ Accept: "application/json" }` — it never routes through
`TenraiClient`/`HttpClient`, so it can neither exercise nor confirm any
client-side header/config fix. Don't treat a `check:api` pass/fail on a given
route as evidence for or against such a fix; it's testing raw upstream
reachability only.

All green is a **baseline, not proof of correctness** — it only confirms
nothing already-covered regressed. It says nothing about whether the
interesting logic (error/exception branches especially) is covered at all —
a line can execute inside a test without the test actually asserting on the
specific thing that matters (e.g. a test that triggers a validation error but
only checks `isError: true`, never the actual message text). `npm run
test:coverage` (~80% gate) measures lines executed, not whether the
assertions on those lines are meaningful. When reviewing or writing tests as
part of this audit, ask: does a test exist that deliberately triggers this
error path, and does it assert on the _specific_ resulting message/shape?

Anything red here is the actual finding — stop and report it before moving to
live testing.

## 2. Safety rules for live testing (read before calling anything)

- **A real authenticated MAL account may be wired into the session.** Call
  `get_my_user_info` before doing anything else — if it succeeds, every
  mutation call below acts on a real person's real anime/manga list.
- **Read-only tools** (`search_*`, `get_*` except the `get_my_*` trio) are
  always safe to call freely — no special permission needed.
- **Mutation tools** (`update_my_anime_status`, `update_my_manga_status`,
  `delete_my_anime_list_item`, `delete_my_manga_list_item`) require the
  user's explicit go-ahead before this pass touches them. Reversible live
  tests against the maintainer's real list are acceptable when asked for —
  run the `mutation-test-safety` skill's contract for every mutation call
  (pre-state via `get_my_anime_list`/`get_my_manga_list`, revert via
  `update_my_anime_status`/`update_my_manga_status` back to the original
  fields or `delete_my_*_list_item` if the entry didn't exist before).
- **Do not call `login_mal`/`submit_mal_redirect` live** — re-running the
  PKCE OAuth flow can disrupt the session's already-configured token/store
  and isn't meaningfully revertible mid-session.
- **Dual-backend awareness**: `search_anime`, `search_manga`,
  `get_top_anime`, `get_top_manga`, `get_seasonal_anime`,
  `get_upcoming_season`, `get_anime`/`get_manga`, `get_anime_statistics`, and
  `get_anime_recommendations`/`get_manga_recommendations` fall back to the
  official MAL API (`MAL_CLIENT_ID`, no OAuth) when Tenrai fails — see
  `ReadFallback`/`withFallback` in `src/clients/readFallback.ts`. When
  reporting a finding on one of these tools, **state which backend actually
  answered** (Tenrai vs. the official fallback) — their available fields
  differ by design (see the fallback field-gap list in
  `docs/api-references.md`), so a "missing field" on a fallback response is
  expected, not a bug, unless it's missing from a field the fallback is
  documented to cover.

## 3. Live edge-case sweep

Batch independent tool calls together where your harness supports it — this
is slow one-at-a-time. Adapt ids/tools to whatever's currently registered
(`grep -n 'registerTool(' src/tools/*.ts`), don't just replay last run's exact
calls verbatim. Split into independent workstreams if your environment
supports concurrent subagents/background tasks.

- **Input validation boundaries**: empty `q`, negative/zero/decimal
  `mal_id`/`page`/`limit`, `page`/`limit` at their documented boundary and one
  past it, an unknown/misspelled param name (every `inputSchema` should
  reject a typo, not silently ignore it). Prefer read-only tools for the
  unknown-param probe; on a mutation tool, send _only_ the bogus field (no
  other real field) — an ignored unknown field plus a real field still
  mutates the account for real (see `mutation-test-safety`).
- **Cross-field pairing rules**: `update_my_anime_status`/
  `update_my_manga_status` called with only `anime_id`/`manga_id` and no
  other field — must reject (regression-check for the 0.7.1 fix; re-verify it
  still does, since this exact bug shipped and was fixed once already).
  `num_watched_episodes`/`num_chapters_read` vs. a `status` that doesn't make
  sense together (e.g. marking `completed` with 0 episodes watched) — does
  MAL/the tool flag this or silently accept it?
- **Not-found / empty-result paths**: a nonexistent-but-well-formed `mal_id`
  for anime/manga/character/person, a search returning zero results,
  `delete_my_anime_list_item`/`delete_my_manga_list_item` on an id with no
  existing list entry.
- **Score/rating edge cases**: an anime/manga with a Tenrai `score` of exactly
  `0` (should surface as absent, not literal `0` — shipped in 0.2.0, worth a
  regression spot-check), a brand-new/unranked entry with no `rank`/
  `popularity` at all.
- **Payload-size risk**: `get_anime_reviews`/`get_manga_reviews` (1200-char
  truncation per review, `limit` param), `get_anime_recommendations`/
  `get_manga_recommendations` (documented 25-item cap), `get_person`'s voice
  roles (documented 50-item cap), `get_my_anime_list`/`get_my_manga_list`
  against a real account with a large list (pagination fields actually
  usable, not just present).
- **Documented vs. actual shape**: for anything that looks surprising live,
  grep the field back to its `.describe()` text and its `format.schemas.ts`
  `.strict()` schema — does the tool's own description/outputSchema promise
  what you just saw (or promise something you didn't)? A `.strict()` schema
  rejecting a real live response is itself a finding (shaper/schema drift),
  not something to silently work around.
- **Unicode / adult / locale weirdness**: emoji-only queries, non-Latin
  scripts, `sfw` toggling (including during an official-API fallback, which
  enforces it client-side via each node's `nsfw` field — confirm it isn't
  silently ignored there), whitespace-only search terms.
- **Empty-because-filtered vs. empty-because-baseline**: when checking that a
  filter (`sfw`/`sfw_strict`) removes something, first confirm the UNFILTERED
  call is non-empty — otherwise an empty filtered result proves nothing. This
  bit a `get_anime_news` description once: it claimed `sfw` "returns an empty
  list entirely for an NSFW anime," but that was verified against a hentai
  title that simply had no news to begin with. The real behavior (a mainstream
  R+ title with actual news) is that it cuts the list down, not to zero. Pick a
  subject with a real non-empty baseline (e.g. High School DxD, not Bible Black)
  before concluding what a filter does.
- **Live prompt testing**: run the `prompt-check` skill against every prompt
  in `src/prompts.ts` — a static read comparing prompt text against tool
  names/params misses argument-handling bugs that only show up when actually
  rendered through the real MCP protocol.

For anything that looks like a bug, **don't stop at the symptom** — grep the
source for the actual mechanism (the const/regex/schema that produced it)
before calling it a finding. A live response that merely _looks_ odd but ties
back to correct, intentional code (e.g. a documented fallback field gap)
isn't a finding.

The same caution runs the other way: a finding produced by reading source
_without_ calling any live tool is a hypothesis, not a confirmed bug — Tenrai's
and the official API's actual behavior sometimes contradicts what the code's
shape implies (this is exactly why the `seasonal_overview` item above says
"verify live before reporting"). Before reporting any source-only finding,
spend one live call confirming the actual response shape it depends on.

A third caution, for any upstream that can be transiently flaky: **one paired
live A/B test is suggestive, not proof of causality.** A single "failure
without the change, success with it" result can just as easily be the
upstream self-resolving mid-test. Before writing up a live-tested fix as
confirmed, look for (or run) a same-day control on the identical route
through a path that does _not_ carry the change — if that also succeeds, the
fix's causal effect is unconfirmed, not settled, regardless of how clean the
original paired numbers looked.

## 4. Source-level code review

Sweep every file under `src/tools/`, `src/clients/`, and `src/lib/` (lighter
pass on the last group unless something specific points there) for:

- A tool whose field name for a concept diverges from every sibling tool
  handling the same concept (e.g. one list tool naming its MAL username/id
  parameter differently from another) — grep every call site of a shared
  concept and diff the field names, don't just check each in isolation. This
  bug class can't be caught by testing well-formed values (every call site
  works fine on its own) or by a clean-error check — outside the two
  `.strict()` schemas in `tools/login.ts`, no input schema here is `.strict()`,
  so a plausible-but-wrong name is silently dropped as an unrecognized key
  instead of erroring, and the tool quietly falls back to whatever its field
  being _absent_ means. Confirmed live on a sibling project
  (anilist-mcp-server): a search tool's user-filter parameter was named
  differently from every other user-scoped tool, so passing the
  sibling-consistent (but wrong) name silently returned the unfiltered global
  feed instead of erroring or filtering.
- A `summarize*`/shaper function in `src/lib/format.ts`/`formatOfficial.ts`
  that doesn't end by calling its paired schema's `.parse()` in
  `src/lib/format.schemas.ts` — AGENTS.md's schema-first convention requires
  every shaper validate its own output this way so the shaper and its
  `outputSchema` can't drift silently.
- A schema that landed in the wrong file for its purpose: `format.schemas.ts`
  schemas must be `.strict()` (shaped/summarized output), while
  `clients/mal.ts`'s `MyUserInfoSchema`/`MalListResponseSchema`/
  `ListStatusUpdateResponseSchema` are deliberately `.passthrough()` (raw
  upstream responses forwarded near-verbatim) — a new schema mixing the two
  styles, or a `.strict()` schema applied to a passthrough response, is a bug.
- `withFallback`/`ReadFallback` call sites that don't distinguish a genuine
  upstream failure (5xx/network/timeout — should fall back) from a real 4xx
  (e.g. a genuine "not found" — should **not** silently retry against the
  official API and potentially mask the real error).
- Rate limiting: does every new Tenrai/official-API call site actually route
  through the shared `withThrottle`/`RateLimiter` wiring in
  `src/clients/httpClients.ts`, or does a new method construct its own
  `HttpClient`/bypass the limiter?
- Tool failures that don't go through `guard()` (`src/tools/guard.ts`) —
  AGENTS.md requires every tool failure return `{ isError: true }`, never a
  raw throw.
- `TtlCache` dedup (`src/lib/cache.ts`'s in-flight-request coalescing) — a new
  cached method that fetches directly instead of routing through
  `#cache`/`#cached` bypasses this for no reason.
- Logger/credential leakage: `MAL_CLIENT_ID`, OAuth access/refresh tokens,
  and the on-disk token store path never appear in cleartext in any new
  debug/warn/error log line (`src/lib/logger.ts` redacts credentials — check
  a new call site doesn't route around it by string-concatenating a header
  value directly into a log message).
- The `tool-description-check` skill (Glama's TDQS rubric) compliance for any
  new or edited tool `description`/field `.describe()` text, per AGENTS.md.

## 5. Docs/metadata consistency

Run the `docs-consistency-check` skill. Also log any new Tenrai quirk or
reliability data point turned up this pass in `notes/tenrai-reliability.md`
(gitignored), with a date, the same way past passes have — don't let a
fresh finding live only in this conversation's transcript.

## 6. Report, then fix only what's confirmed

Rank findings by severity. For each: what's wrong, concrete repro (exact tool
call + params), the file/line causing it, and the fix shape. Silence on a
category you didn't get to (rather than implying full coverage) beats a false
"all clear." Then run the `self-learning` skill against each confirmed
finding.

If asked to fix: implement the smallest correct change, add/extend a test in
the matching `src/__tests__/*.test.ts` (mirror the existing test's style in
that file), then re-run the full `build && test && lint && format:check` gate
before calling it done. Re-verify live only after the running MCP server
process has been restarted (it won't pick up source changes on its own) —
build/test passing is necessary but re-confirming actual live behavior
changed is stronger evidence than trusting the diff alone.

## 7. Commit + changelog, if asked

One `fix:`/`feat:` commit per logically distinct change (don't bundle two
unrelated fixes into one commit), then a separate `docs:` commit adding to
`CHANGELOG.md`'s `[Unreleased]` section (style: the `changelog-style` skill)
with one bullet per fix, each linking that fix commit's short sha
(`https://github.com/Grinv/mal-mcp/commit/<7-char-sha>`). Author/committer
`Grinv <4070730+Grinv@users.noreply.github.com>`, **no** `Co-Authored-By`
trailer (AGENTS.md's commit convention). Don't push unless explicitly asked.
