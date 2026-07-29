---
name: docs-consistency-check
description: Check README/manifest.json/server.json/CHANGELOG.md/AGENTS.md and docs/*.md for drift against the actual registered tools and source. Use after adding, renaming, or removing a tool, or as part of a live-audit pass.
---

# Docs/metadata consistency

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
  behavior? Cross-check new/edited descriptions against the
  `tool-description-check` skill (Glama's TDQS rubric) per AGENTS.md.
- `CHANGELOG.md`'s `[Unreleased]` section (see the `changelog-style` skill for
  entry style) has one line per real behavior change made in this pass — add
  missing entries, don't just flag them as missing. Run
  `node scripts/check-changelog-coverage.mjs` to list every commit since the
  last release tag and flag which ones CHANGELOG.md doesn't reference at
  all — it's not a hard gate (plenty of commits are legitimately internal:
  dev-dependency bumps, docs-about-docs, CI-only fixes), but triage every
  line it reports as either "needs an entry" or "correctly excluded,"
  don't skip the check just because most commits usually are internal.
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
- `PRIVACY.md` and `SECURITY.md`: re-verify every specific claim against the
  actual current code, don't just skim for plausibility — which credentials
  exist and how each is transmitted/redacted (e.g. `src/lib/errors.ts`'s
  `redact()` actually covering both `key=value` and JSON `"key":"value"`
  shapes, and the `tokens.json` store's `0600`/`0700` permissions), what is
  and isn't cached (incl. cache key/TTL — cross-check the "deliberately not
  cached" list against `src/lib/cache.ts` call sites), the current list of
  read-only vs. OAuth/write tools, and the host-allowlist statement (`config.ts`'s
  Zod validation vs. an actual fixed allowlist — there isn't one). This class
  of drift is easy to miss because it reads fine on its own and only breaks
  against the code: a sibling repo's `SECURITY.md`/`PRIVACY.md` both claimed
  "player-specific data is never cached" after a later feature added exactly
  that caching, and a separate claim conflated an actually-cached field with
  a similarly-named never-cached one — neither doc was self-evidently wrong,
  both required re-reading the client code to catch. Also confirm every
  root-level doc a README link points to (`PRIVACY.md`, `SECURITY.md`, …) is
  actually in `package.json`'s `files` array — a new one added there without
  updating `files` 404s on the npm tarball (bit `PRIVACY.md` once already,
  then recurred for `SECURITY.md`).
