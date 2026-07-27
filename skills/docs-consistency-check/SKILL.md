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
