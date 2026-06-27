# Roadmap / TODO

Deferred work, intentionally left out of the initial `0.1.0` release. Convert to
GitHub Issues once the repository is public.

## Distribution

- [x] **Publish to npm** (`npx -y mal-mcp`). v0.1.0 published; CI publishes future
      versions via **Trusted Publishing** (OIDC, no token) with `--provenance`.
- [ ] **Submit to the official MCP Registry.** Now unblocked (package exists).
      Finalize `server.json` (released `.mcpb` asset URL + `fileSha256`),
      authenticate the `io.github.Grinv/*` namespace via GitHub OIDC, and add an
      `mcp-publisher publish` step to `release.yml`.

## Release engineering

- [ ] **Sign `.mcpb` bundles** — _blocked_: `@anthropic-ai/mcpb` 2.1.2 does not
      verify its own signature (`mcpb sign` reports success, but `mcpb verify`/
      `info` still say "Not signed"). Wiring it up would add a signing key in
      secrets for zero effect. Revisit when the CLI fixes signature round-trip.
- [ ] **Automate the changelog/releases** with release-please or Changesets
      (Conventional Commits) once npm publishing is in place.

## Features (optional, only if needed)

- [ ] Full interactive OAuth2 PKCE flow (local callback server) as an alternative
      to the manual token + silent-refresh approach.
- [ ] Additional Jikan read surface (e.g. genres list, producers, full schedule).
