---
name: release
description: Cut a release of mal-mcp — draft CHANGELOG entries, check docs/metadata consistency, then bump/tag/push. Use when asked to release, cut a version, or publish a new version of this package.
---

# Releasing

`package.json` is the **single source of truth** for the version. The npm
`version` lifecycle hook runs `scripts/sync-version.mjs`, which propagates it to
`src/version.ts`, `manifest.json` and `server.json` (incl. the `.mcpb` release-asset
URL); `version.test.ts` guards that they never drift.

A `preversion` hook (`scripts/preversion-check.mjs`) runs first — it's a
presence-only safety net, not a substitute for actually running the skill
below as a real judgment step. It blocks `npm version` if `CHANGELOG.md`'s
`[Unreleased]` section is empty: run the `changelog-style` skill against the
commits since the last tag first — it's what actually makes the entries
short, self-describing, free of implementation detail, and linked to their
commits; the hook only confirms _something_ is there, not that it follows
that style. (Or re-run with `CONFIRM_EMPTY_CHANGELOG=1` if this release
genuinely has no user-facing changes, e.g. a pure dependency bump.)

**When invoked as this skill**, run these as explicit steps, not optional —
don't rely on the `preversion` hook alone to catch a skipped one:

1. Invoke the `changelog-style` skill against the commits since the last tag;
   write/fix the `[Unreleased]` entries per its style rules.
2. Run the `docs-consistency-check` skill.
3. Commit all of the above.
4. `npm version <patch|minor|major>` — preversion gate, then bumps + syncs
   every file + commits `"release: vX.Y.Z"` + tags `vX.Y.Z`.
5. `git push --follow-tags` — pushing the tag triggers `.github/workflows/release.yml`.

The tag push (`v*`) runs the **Release** workflow: `check:api` gate → build → test
→ pack `.mcpb` → GitHub Release → `npm publish` (OIDC trusted publishing, with
provenance — no token) → **publish to the official MCP Registry** (`mcp-publisher`,
GitHub OIDC). Never hand-edit the version in the derived files; bump `package.json`
via `npm version` and let the hook sync the rest.

## MCP Registry

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
`config.ts`'s `CREDENTIAL_ENV_VARS` (the source of truth — a `satisfies` clause
ties it to `EnvSchema`'s real keys, so a typo/rename fails `tsc --noEmit`),
`manifest.json` `user_config` (the `.mcpb` install form), and `server.json`
`packages[].environmentVariables` (the registry entry). When you add/rename/
remove a credential var, update `CREDENTIAL_ENV_VARS` plus the descriptor in
both JSON files — `version.test.ts` guards that all three agree (not just
`manifest.json` against `server.json`), so a mismatch fails a test instead of
only surfacing as a stale install form. Keep `server.json` descriptions ≤ 100
chars (registry schema cap). Purely internal tunables (timeouts, cache, rate
limits, `LOG_LEVEL`) stay env-only — they don't belong in `CREDENTIAL_ENV_VARS`
or in the install form/registry entry. `MAL_TOKEN_STORE`/`MAL_OAUTH_PORT` are
the same category (rare, advanced overrides) even though README documents them
in the main table alongside the credential vars — don't add them to
`CREDENTIAL_ENV_VARS`/`manifest.json`/`server.json` just because they're in
`config.ts`'s `EnvSchema`.
