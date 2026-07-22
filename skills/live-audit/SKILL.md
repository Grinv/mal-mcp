# live-audit — mal-mcp health check + edge-case hunt

Repo-specific playbook, for any agent/model working on this repo (not tied to
a particular harness — see `AGENTS.md`'s own agent-agnostic framing). Use it
when asked to test/audit the published or just-fixed mal-mcp package, hunt
for bugs/edge cases, or repeat "the same kind of testing as before." Sibling
repos (`tmdb-mcp`, `steam-games-mcp`, `anilist-mcp-server`) keep their own
`skills/live-audit/SKILL.md` — when either this file or a sibling's improves,
sync the useful parts both ways rather than letting them drift.

Goal: find real bugs/inaccuracies in the live tool behavior (against the real
Jikan API, its official-MAL-API fallback, and the official MAL API itself)
and in the source, then fix what's found. Read `AGENTS.md` first if it's not
already in context — every fix must follow its conventions (`guard()`/
never-throw, `format.schemas.ts`'s `.strict()` shaper/schema 1:1 rule vs.
`clients/mal.ts`'s deliberate `.passthrough()`, commit author/no-Co-Authored-By,
etc.).

This assumes the server is already reachable as an MCP connection in your
current session (e.g. as `mcp__mal__*` tools in Claude Code). If it isn't
connected, connect it first rather than skipping straight to step 1.

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
both Jikan and (if `MAL_CLIENT_ID`/OAuth creds are set) the official API. A
failure there can mean either a genuine shape drift (a real finding) or
Jikan's own known-flaky upstream connection to MAL (see
`notes/jikan-reliability.md` — gitignored local log; check it before
re-diagnosing a 504 as new). **Note `check-api.mjs`'s own scope**: it does a
raw `fetch()` with just `{ Accept: "application/json" }` — it never routes
through `JikanClient`/`HttpClient`, so it can neither exercise nor confirm
any client-side header/config fix (e.g. the `Accept-Encoding` workaround
below). Don't treat a `check:api` pass/fail on a given route as evidence for
or against such a fix; it's testing raw upstream reachability only. As of
2026-07-23 `notes/jikan-reliability.md` also records an `Accept-Encoding`
default header (jikan-me/jikan#596) shipped in `JikanClient` on the strength
of a single paired live test — a same-day, header-less run of the identical
route also succeeded, so its causal effect is **unconfirmed**, not a settled
fix. Treat a 504 on any Jikan route (with or without that header) as the
known, not-yet-fixed upstream issue, not a new finding, unless the symptom
has genuinely changed shape (e.g. a 4xx or a malformed body where it used to
be a clean 504).

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
  always safe to call freely — no special permission needed. This includes
  `get_user_profile`/`get_user_favorites` for a public username: prefer a
  well-known public MAL profile over guessing a random one.
- **Mutation tools** (`update_my_anime_status`, `update_my_manga_status`,
  `delete_my_anime_list_item`, `delete_my_manga_list_item`) require the
  user's explicit go-ahead before this pass touches them. Reversible live
  tests against the maintainer's real list are acceptable when asked for —
  but still follow this contract for every mutation call:
  1. Capture the exact pre-state first via `get_my_anime_list`/
     `get_my_manga_list` (filter/search for the specific id) — not an
     assumption of what it probably is. A title with no existing list entry
     has a clear pre-state too: "absent."
  2. Make the smallest possible change that still exercises the behavior
     (e.g. one status/score field, not a full rewrite).
  3. Verify the change landed by re-fetching via `get_my_anime_list`/
     `get_my_manga_list` — don't trust the update tool's own echoed response
     alone as proof.
  4. Revert to the captured pre-state immediately, in the same turn
     (`update_my_anime_status`/`update_my_manga_status` back to the original
     fields, or `delete_my_*_list_item` if the entry didn't exist before),
     and verify the revert too. Don't batch several mutations and revert at
     the end — revert each one before moving to the next unrelated test.
  5. Never leave the account in a different state than you found it, even if
     a step errors partway through — check and clean up regardless.
- **Do not call `login_mal`/`submit_mal_redirect` live** — re-running the
  PKCE OAuth flow can disrupt the session's already-configured token/store
  and isn't meaningfully revertible mid-session.
- **Dual-backend awareness**: `search_anime`, `search_manga`,
  `get_top_anime`, `get_top_manga`, `get_seasonal_anime`,
  `get_upcoming_season`, `get_anime`/`get_manga`, `get_anime_statistics`, and
  `get_anime_recommendations`/`get_manga_recommendations` fall back to the
  official MAL API (`MAL_CLIENT_ID`, no OAuth) when Jikan fails — see
  `JikanFallback`/`withFallback` in `src/clients/jikanFallback.ts`. Given
  Jikan's documented current flakiness, a live pass right now will likely
  exercise both paths "for free." When reporting a finding on one of these
  tools, **state which backend actually answered** (Jikan vs. the official
  fallback) — their available fields differ by design (see the fallback
  field-gap list in `docs/api-references.md`), so a "missing field" on a
  fallback response is expected, not a bug, unless it's missing from a field
  the fallback is documented to cover.

## 3. Live edge-case sweep

Batch independent tool calls together where your harness supports it — this
is slow one-at-a-time. Adapt ids/tools to whatever's currently registered
(`grep -n 'registerTool(' src/tools/*.ts`), don't just replay last run's exact
calls verbatim. Split into independent workstreams if your environment
supports concurrent subagents/background tasks.

- **Input validation boundaries**: empty `q`, negative/zero/decimal
  `mal_id`/`page`/`limit`, `page`/`limit` at their documented boundary and one
  past it, an unknown/misspelled param name (every `inputSchema` should
  reject a typo, not silently ignore it).
- **Cross-field pairing rules**: `update_my_anime_status`/
  `update_my_manga_status` called with only `anime_id`/`manga_id` and no
  other field — must reject (regression-check for the 0.7.1 fix; re-verify it
  still does, since this exact bug shipped and was fixed once already).
  `num_watched_episodes`/`num_chapters_read` vs. a `status` that doesn't make
  sense together (e.g. marking `completed` with 0 episodes watched) — does
  MAL/the tool flag this or silently accept it?
- **Not-found / empty-result paths**: a nonexistent-but-well-formed `mal_id`
  for anime/manga/character/person, a nonexistent username for
  `get_user_profile`/`get_user_favorites`, a search returning zero results,
  `delete_my_anime_list_item`/`delete_my_manga_list_item` on an id with no
  existing list entry.
- **Score/rating edge cases**: an anime/manga with a Jikan `score` of exactly
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
- **Live prompt testing** (`src/prompts.ts`) — a static read comparing prompt
  text against tool names/params misses argument-handling bugs. Actually
  render every prompt through the real MCP protocol: `npx
@modelcontextprotocol/inspector --cli node dist/index.js --method
prompts/list`, then `--method prompts/get --prompt-name <name> --prompt-args
key=value key2=value2` (space-separated `key=value` pairs, NOT a JSON blob —
  the CLI rejects JSON with "Invalid parameter format"). For each of the
  three prompts, cover every combination of optional args, not just "all set"
  or "all omitted":
  - `recommend_similar`: no `title` (should ask which anime, not fail —
    confirm the client actually gets asked rather than the call erroring),
    `title` set to something real, `title` set to something with no search
    results.
  - `seasonal_overview`: neither `season` nor `year`, only `season`, only
    `year`, both together. Giving just one of `season`/`year` alone renders
    identically to giving neither ("the current season," no args passed to
    `get_seasonal_anime`) — this is correct, not a bug: `get_seasonal_anime`'s
    own description says supplying only one is treated as omitting both
    (matches `getSeason()`'s `p.year && p.season ? ... : "seasons/now"` in
    `src/clients/jikan.ts`), so the prompt mirrors the tool's own contract.
    Don't flag this from a source-only read of the prompt's branching alone —
    it resembles the "argument that's individually optional but breaks when
    given alone" bug class, but here the "breakage" is intended.
  - `hidden_gems`: no `kind`, `kind=anime`, `kind=manga` — each is a
    genuinely different branch (different top-list tool).

For anything that looks like a bug, **don't stop at the symptom** — grep the
source for the actual mechanism (the const/regex/schema that produced it)
before calling it a finding. A live response that merely _looks_ odd but ties
back to correct, intentional code (e.g. a documented fallback field gap)
isn't a finding.

The same caution runs the other way: a finding produced by reading source
_without_ calling any live tool is a hypothesis, not a confirmed bug — Jikan's
and the official API's actual behavior sometimes contradicts what the code's
shape implies (this is exactly why the `seasonal_overview` item above says
"verify live before reporting"). Before reporting any source-only finding,
spend one live call confirming the actual response shape it depends on.

A third caution, specific to a known-flaky upstream like Jikan: **one paired
live A/B test is suggestive, not proof of causality.** A single "504 without
the change, 200 with it" result can just as easily be Jikan self-resolving
mid-test — this log has real prior examples of the exact same failing set
clearing up within hours with no code change involved (see the recurring
"self-resolving within a day" pattern in the GitHub-issue-history section
below). Before writing up a live-tested fix as confirmed, look for (or run) a
same-day control on the identical route through a path that does _not_ carry
the change — if that also succeeds, the fix's causal effect is unconfirmed,
not settled, regardless of how clean the original paired numbers looked.

## 4. Source-level code review

Sweep every file under `src/tools/`, `src/clients/`, and `src/lib/` (lighter
pass on the last group unless something specific points there) for:

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
- `withFallback`/`JikanFallback` call sites that don't distinguish a genuine
  upstream failure (5xx/network/timeout — should fall back) from a real 4xx
  (e.g. a genuine "not found" — should **not** silently retry against the
  official API and potentially mask the real error).
- Rate limiting: does every new Jikan/official-API call site actually route
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
- `docs/tool-descriptions.md` (Glama's TDQS rubric) compliance for any new or
  edited tool `description`/field `.describe()` text, per AGENTS.md.

## 5. Docs/metadata consistency

Check every one of these, not just a sample:

- `README.md`'s tool table matches `src/tools/*.ts`'s registrations (names,
  and the auth-tier column — none / Client ID / OAuth token, per
  `docs/auth.md` — against what each tool actually needs).
- `manifest.json`'s and `server.json`'s `tools` arrays list the same tool
  **names** as what's actually registered — treat a test failure here as
  authoritative if one exists. Their `description` fields are deliberately
  short, independent marketing-style summaries, NOT a copy of the tool's full
  `.describe()`/`description` text in `src/tools/*.ts` — don't "fix" them to
  match verbatim, that's not a bug. Do re-read them for accuracy if a tool's
  _behavior_ changed in a way the short summary now misrepresents.
- Tool `description`/field `.describe()` text in `src/tools/*.ts` itself:
  does it still match the actual `inputSchema`/`outputSchema` and the real
  behavior?
- `CHANGELOG.md`'s `[Unreleased]` section (see `docs/changelog-style.md` for
  entry style) has one line per real behavior change made in this pass — add
  missing entries, don't just flag them as missing.
- `docs/api-references.md`'s "verified live" claims still match the current
  client code, especially any claim this pass's own fixes just invalidated —
  and especially the Jikan fallback field-gap list, which is exactly the kind
  of claim a MAL API change could quietly break.
- `docs/auth.md`'s credential-tier breakdown still matches what each tool
  actually requires.
- `AGENTS.md`'s project-shape/file-tree description (including this
  `skills/` entry) still matches the filesystem.
- `notes/jikan-reliability.md` (gitignored) — if this pass turned up a new
  Jikan quirk or reliability data point, log it there with a date, the same
  way past passes have; don't let a fresh finding live only in this
  conversation's transcript.

## 6. Report, then fix only what's confirmed

Rank findings by severity. For each: what's wrong, concrete repro (exact tool
call + params), the file/line causing it, and the fix shape. Silence on a
category you didn't get to (rather than implying full coverage) beats a false
"all clear."

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
`CHANGELOG.md`'s `[Unreleased]` section (style: `docs/changelog-style.md`)
with one bullet per fix, each linking that fix commit's short sha
(`https://github.com/Grinv/mal-mcp/commit/<7-char-sha>`). Author/committer
`Grinv <4070730+Grinv@users.noreply.github.com>`, **no** `Co-Authored-By`
trailer (AGENTS.md's commit convention). Don't push unless explicitly asked.
