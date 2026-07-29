---
name: tool-description-check
description: Self-check a new or edited MCP tool `description`/field `.describe()` text before committing — verify every behavioral claim against live testing, check for contradictions with sibling tools, and score against Glama's Tool Definition Quality Score (TDQS) rubric. Use whenever a tool description or schema field description in src/tools/*.ts is added or changed.
---

# Tool descriptions: what to check before committing

Published research on this exact failure mode: [Glama's TDQS
methodology](https://github.com/glama-ai/tool-definition-quality-score) found
97% of 856 tools across 103 real MCP servers have a description defect — 56%
don't clearly state what the tool does, 89% don't say when to use it.
Separately, "From Docs to Descriptions" measured that strong descriptions get
260% more selection in competitive scenarios and lift task success ~6 points.
Bad descriptions aren't a hypothetical risk; they're the median case. This
server is scored on the same rubric at
[glama.ai/mcp/servers/Grinv/mal-mcp/score](https://glama.ai/mcp/servers/Grinv/mal-mcp/score)
(re-analyzed on Glama's own schedule, not on push — treat this as a manual
pre-commit check, not something to verify live after every edit).

| TDQS dimension          | Weight | Question                                                           |
| ----------------------- | ------ | ------------------------------------------------------------------ |
| Purpose Clarity         | 25%    | Does the description state what the tool does?                     |
| Usage Guidelines        | 20%    | Does it say when to use this tool vs. alternatives?                |
| Behavioral Transparency | 20%    | Does it disclose behavior beyond what annotations already provide? |
| Parameter Semantics     | 15%    | Does it add meaning beyond what the input schema provides?         |
| Conciseness & Structure | 10%    | Is it appropriately sized and front-loaded?                        |
| Contextual Completeness | 10%    | Given the tool's complexity, is the description complete enough?   |

Usage Guidelines and Behavioral Transparency carry the most weight after
Purpose — double-check those two first on any new or edited tool.

## Two rules that override everything below

1. **No unverified claims.** Every behavioral statement in a description —
   not just "the schema allows this input," which is self-evidently true,
   but "here's what happens when you send it" — must be backed by one of:
   - an existing `docs/api-references.md` "verified live" entry, cited by
     reference instead of re-asserted from memory (e.g. the "no-match search
     doesn't return empty" note for the official-API fallback, or the
     `num_episodes_watched`/`num_watched_episodes` read/write field-name
     mismatch — both already verified there);
   - a fresh live call against Jikan/the official API made during this
     review, with the actual response observed;
   - direct reading of the exact function implementing the behavior, when
     it's deterministic code logic rather than an upstream API's quirk
     (e.g. `#updateStatus` in `clients/mal.ts` sends only the fields passed
     in, confirming `update_my_anime_status`'s "fields you omit are left
     unchanged" claim).

   If you can't tick one of these, don't write the claim. A sibling server
   (anilist-mcp-server) shipped tool descriptions from exactly this kind of
   unverified analogy — a field claimed "computed and accurate" when it was
   never computed at all, and a cross-reference claiming a field said
   something its own text never actually said — both from one otherwise-
   careful editing session. "This probably works the same as the similar
   field" is how that class of bug gets in.

2. **No contradictions between tools.** A claim in tool A's description
   about tool B, a shared value, or a shared behavior must match what B
   actually says and does. This repo already has several of these
   cross-references done right — `get_top_characters`/`get_top_people` point
   to `search_characters`/`search_people` for a name lookup instead of a
   ranking, `get_anime_recommendations`/`get_manga_recommendations` point to
   `get_top_anime`/`get_top_manga` for an untargeted ranking, and
   `get_user_profile`/`get_my_user_info` cross-reference each other
   bidirectionally (including the manga-stats gap on the "my" side). When
   you edit one description, re-read every sibling description that
   cross-references it or shares its underlying data — fixing A while
   leaving a now-false claim in B is still a bug you introduced this
   session, not a pre-existing one.

## Checklist

### Purpose and when to call it

- State what the tool does **and** when to call it — a trigger condition
  ("call this when the user asks about X"), not just a return-value
  description (a measured effect on newer, tool-call-conservative models,
  per Anthropic's own tool-use guidance — not just style).
- Give the tool itself a clear, specific name — verb + resource
  (`get_anime_statistics`, not `stats`). An agent screens dozens of tool
  names before it ever reads a description; a vague or overlapping name
  loses the match before the description gets a chance to help.
- Name the alternative tool for every pair that could plausibly be confused
  (similar inputs, overlapping domain) — "use X instead of Y when Z" is the
  single highest-leverage fix for this dimension. Make it bidirectional: if
  Y's description points to X, X's own description should acknowledge that
  role.
- Don't split one concept across near-duplicate tools, and don't collapse
  unrelated actions into one tool with a mode flag — one tool, one job,
  matching how this project already groups by domain (`read.ts`/`mylist.ts`)
  rather than by raw endpoint.
- When genuinely unsure whether a description will make an agent pick the
  right tool among lookalikes, test it: prompt a fresh model with the
  candidate tools and a representative request, see what it actually picks,
  and adjust the text from that observed choice — not from how it reads to
  you. This checks selection _effectiveness_, a different failure mode from
  the fact-_correctness_ rule above.

### Parameter semantics

- Keep the same field name for the same concept across every sibling tool
  that takes it — grep before naming a new field for an existing concept
  (see the field-naming bullet in [AGENTS.md](../../AGENTS.md)'s Conventions
  section). When an upstream field name genuinely can't match across a
  read/write pair — MAL's own API names the same count
  `num_episodes_watched` on read but `num_watched_episodes` on write — say
  so explicitly in the field's own `.describe()` text (as
  `update_my_anime_status` already does) instead of leaving the mismatch
  for the caller to discover.
- If a field's coverage is already ~100% `.describe()` (this project's
  baseline), don't pad prose restating the schema — TDQS's own rubric caps
  this dimension at 3/5 regardless. Only add text for a genuinely non-obvious
  fact the schema can't express on its own (e.g. `score`'s "0 clears the
  score" — a real side effect the type alone can't convey).
- Every numeric range or enum the prose promises must be enforced in the Zod
  schema (`.min()`/`.max()`/`z.enum`) — a described bound with no matching
  constraint is a lie the schema doesn't back up.
- Mark a field `required` only if the tool genuinely can't work without it,
  and give every optional field a sensible, stated default (e.g. `sfw`
  defaulting to `false`, `get_anime_reviews`/`get_manga_reviews` defaulting
  `limit` to 5). A truly-required field marked optional forces a caller to
  guess whether omitting it is safe; the reverse adds friction to every call
  for no reason.
- If a field accepts two meaningfully different forms (e.g. a raw ID vs. a
  name/string with its own separate lookup path), say whether both forms are
  validated against real data or only one is — an unrecognized value that
  silently returns nothing looks identical to "no results" otherwise.

### Mutations — behavioral transparency

- State full-replace-vs-partial-merge **at the exact field**, never inferred
  from the container. `update_my_anime_status`/`update_my_manga_status` are
  a confirmed-correct example (checked against `#updateStatus` in
  `clients/mal.ts`, which `PATCH`es only the fields actually passed): the
  description says omitted fields are "left unchanged on an existing entry."
  Any new mutation field must earn the same verification before the
  description asserts the same thing — don't assume every field on a PATCH
  merges the same way just because most of them do.
- If the mutation upserts (create-or-update by some key, as both
  `update_my_*_status` tools do), say so plainly. "Everything else is left
  at defaults" is only true for a genuinely new record — on an existing
  one, omitted fields keep their _previous_ value, not a default.
- If a value is matched **positionally** against a separately-configured
  order, say that reordering/renaming the reference list silently
  reinterprets already-stored values — this is data corruption dressed up
  as a cosmetic rename, not just a UX nit. (No tool here does this today,
  but check for it before adding one that scores/tags against an
  externally-ordered list.)
- Never claim a capability (privacy, confidentiality, atomicity) the schema
  doesn't wire up. If the upstream mutation has an argument this tool
  doesn't expose, say the _tool_ lacks it — don't imply the upstream API
  itself lacks it.
- Never contradict an annotation. `delete_my_anime_list_item`/
  `delete_my_manga_list_item` carry `idempotentHint: true` — verify a repeat
  call on an already-deleted entry actually behaves the way that hint
  implies (no-ops or errors predictably) before the description leans on
  it, rather than assuming idempotence because the flag is set.

### Reads — behavioral transparency

- Distinguish "genuinely zero results" from "silently filtered out by a
  bad/unrecognized input" wherever the upstream API doesn't error on a
  mismatch. This repo has a documented real case: the official-API fallback
  (`officialReads.ts`) doesn't return an empty list for a no-match search —
  it comes back with a full page of unrelated results instead (see
  `docs/api-references.md`'s "No-match search doesn't return empty"). Any
  tool that can hit that fallback path needs this caveat, not just the one
  it was first noticed on — apply it **consistently across every sibling
  field/tool of the same shape**.
- A shared/reused description or caveat (e.g. "no `themes`/`demographics` on
  this fallback," "no score distribution on this fallback") must be
  re-verified against _this specific tool's_ actual fallback support — this
  project already tracks which fallback-eligible tools lose which fields
  (see `docs/api-references.md`); a caveat correct for
  `get_anime_statistics`'s fallback (missing `scores`) is not automatically
  correct for `get_manga_statistics`, which has **no** fallback at all and
  stays Jikan-only.
- Disclose the return shape's real substance, not just the auth/key caveat —
  fixed caps (`get_anime_reviews`'s 1200-char truncation, `get_person`'s
  50-role cap), ordering, and which nested fields a specific tool omits that
  a same-shaped sibling includes. This is the same rigor as `outputSchema`'s
  own `.describe()` text, not just the top-level description's prose.

### Conciseness, title, and structure

- Front-load the single most important fact (what + when) in the first
  sentence — a caller reads the opening far more reliably than the tail of a
  long description. Keep total length proportional to actual complexity: one
  sentence for a simple read, several for a mutation or fallback-eligible
  read with real caveats — don't pad either direction.
- Keep `title` a short, literal human label — it's the UI-facing name, not a
  second description; don't duplicate `description`'s content there or leave
  it vaguer than the tool's own name.

## Verify, then fix the implementation before dumbing down the description

When a true fact would make a description more useful but the code doesn't
actually do it yet (e.g. a field the description could confidently promise
if the client computed it), prefer fixing the implementation to match the
better description over writing a weaker, technically-safe sentence — as
long as the fix is small, deterministic, and doesn't change any other
observable behavior. Only fall back to narrowing the claim when the fix
would be a real feature addition, not a one-line gap-filler.

## Full spec

The [repo README](https://github.com/glama-ai/tool-definition-quality-score)
is the complete TDQS methodology: scoring pipeline, exact LLM prompts
(Appendix A), calibration examples, and weight formulas. Read it once for
calibration examples if an edit isn't clearly hitting 4-5 on the dimension
you're targeting.

## Keep this checklist honest against drift

This is an incremental, diff-based check by design — "new or edited"
descriptions — which means a rule added here today says nothing about
whether _already-registered_ tools already violate it. A sibling repo in
this project family (anilist-mcp-server) found exactly that gap live: its
"never contradict an annotation" rule (an `idempotentHint: true` tool whose
own description says a repeat call errors, not no-ops) was added in a fix
commit that corrected _other_ tools' descriptions — but the delete-tool
annotations that rule was written to catch were never rechecked against it
at the same time, and stayed wrong from the very first release through
several audits after.

- **A new or tightened rule here implies an immediate retroactive sweep, not
  just future guidance.** When you add or tighten a rule in this file, run
  it against every currently registered tool (not just the one you're
  editing) before considering the update done, and fix what it finds in the
  same pass.
- **Periodically run this whole checklist as a full sweep**, not only on
  new/edited descriptions — e.g. before a release, or whenever asked for a
  broader audit — since incremental diff-based checking alone lets an
  already-registered tool drift out of compliance forever once nobody edits
  it again.
