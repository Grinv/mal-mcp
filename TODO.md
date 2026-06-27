# Roadmap / TODO

Deferred work, intentionally left out of the initial `0.1.0` release. Convert to
GitHub Issues once the repository is public.

## Distribution

- [ ] **Publish to npm** so clients can run `npx -y mal-mcp` with no local path.
      Add `NPM_TOKEN`, publish with `--provenance` (GitHub OIDC), and update the
      `npx` snippet in `docs/clients.md`.
- [ ] **Submit to the official MCP Registry.** Finalize `server.json` (fill the
      released `.mcpb` asset URL + `fileSha256`), authenticate the
      `io.github.Grinv/*` namespace via GitHub OIDC, and add an
      `mcp-publisher publish` step to `release.yml`. Pairs with the npm step.

## Release engineering

- [ ] **Sign `.mcpb` bundles** (`mcpb sign` + `mcpb verify` in `release.yml`).
      Needs a persistent signing key in repo secrets — an ephemeral self-signed
      key per run adds no trust, so this is deferred until a key exists.
- [ ] **Automate the changelog/releases** with release-please or Changesets
      (Conventional Commits) once npm publishing is in place.

## Features (optional, only if needed)

- [ ] Full interactive OAuth2 PKCE flow (local callback server) as an alternative
      to the manual token + silent-refresh approach.
- [ ] Additional Jikan read surface (e.g. genres list, producers, full schedule).
