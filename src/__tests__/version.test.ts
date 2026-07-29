import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VERSION } from "../version.js";
import { CREDENTIAL_ENV_VARS } from "../config.js";
import { renderChangelogRelease, unreleasedHasBullets } from "../../scripts/sync-version.mjs";

// Tests run from the dist-tests/ working directory; the repo root is one level up.
const root = join(process.cwd(), "..");
const readJson = (rel: string) => JSON.parse(readFileSync(join(root, rel), "utf8"));

const pkg = readJson("package.json") as { version: string; mcpName: string };
const manifest = readJson("manifest.json") as {
  version: string;
  user_config: Record<string, unknown>;
};
const server = readJson("server.json") as {
  name: string;
  description: string;
  version: string;
  packages: {
    registryType: string;
    version: string;
    identifier: string;
    environmentVariables?: { name: string; description: string }[];
  }[];
};

// package.json is the single source of truth; scripts/sync-version.mjs (the npm
// `version` hook) propagates it everywhere below. These assertions fail loudly
// if any file drifts — including a hand-edit that bypassed the hook.
test("VERSION constant matches package.json", () => {
  assert.equal(VERSION, pkg.version);
});

test("manifest.json version matches package.json", () => {
  assert.equal(manifest.version, pkg.version);
});

test("server.json versions (+ mcpb release URL) match package.json", () => {
  assert.equal(server.version, pkg.version);
  for (const p of server.packages) assert.equal(p.version, pkg.version);
  // The .mcpb asset URL is version-pinned; the npm identifier is not.
  const mcpb = server.packages.find((p) => p.registryType === "mcpb");
  assert.ok(mcpb, "server.json has an mcpb package");
  assert.match(mcpb.identifier, new RegExp(`/v${pkg.version}/`));
});

// The MCP Registry verifies npm ownership by matching package.json's mcpName to
// the published server name, so these must stay identical.
test("package.json mcpName matches server.json name", () => {
  assert.equal(pkg.mcpName, server.name);
});

// The MCP Registry server.schema caps description at 100 chars (npm/manifest
// have no such limit, so server.json's may differ from package.json's).
test("server.json description fits the MCP Registry 100-char limit", () => {
  assert.ok(
    server.description.length <= 100,
    `server.json description is ${server.description.length} chars (max 100)`,
  );
});

// User-facing config is declared in three places that must agree: config.ts's
// CREDENTIAL_ENV_VARS (the real, typo-checked source — see its comment),
// manifest.json's user_config (the .mcpb install form), and server.json's
// environmentVariables (the registry entry). Previously this test only cross-checked
// manifest.json against server.json, leaving the config.ts step unverified — a var
// renamed/added in config.ts without updating the other two would pass silently.
test("manifest.json user_config and server.json environmentVariables match config.ts's CREDENTIAL_ENV_VARS", () => {
  const expected = new Set<string>(CREDENTIAL_ENV_VARS);
  const manifestVars = new Set(Object.keys(manifest.user_config).map((k) => k.toUpperCase()));
  assert.deepEqual(
    manifestVars,
    expected,
    "manifest.json user_config must match config.ts's CREDENTIAL_ENV_VARS",
  );
  for (const p of server.packages) {
    const got = new Set((p.environmentVariables ?? []).map((e) => e.name));
    assert.deepEqual(
      got,
      expected,
      `package ${p.registryType} environmentVariables must match config.ts's CREDENTIAL_ENV_VARS`,
    );
  }
  // Registry schema caps each description at 100 chars too.
  for (const p of server.packages)
    for (const e of p.environmentVariables ?? [])
      assert.ok(
        e.description.length <= 100,
        `${e.name} description is ${e.description.length} > 100`,
      );
});

// A 2026-07-29 incident shipped a release commit/tag with CHANGELOG.md's heading
// still saying "Unreleased" (renaming it to the version was a manual step nobody
// remembered), which would have produced an empty GitHub Release body — the
// workflow's extraction step matches on `## [<version>]` verbatim. sync-version.mjs
// now does this rename itself; these tests guard the pure string-transform it uses.
test("renderChangelogRelease renames Unreleased, reopens it, and rolls the compare links forward", () => {
  const fixture =
    "## [Unreleased]\n\n### Fixed\n\n- Something ([abc1234](https://example.com)).\n\n" +
    "## [0.7.3] - 2026-07-27\n\n### Fixed\n\n- Old thing.\n\n" +
    "[Unreleased]: https://github.com/o/r/compare/v0.7.3...HEAD\n" +
    "[0.7.3]: https://github.com/o/r/compare/v0.7.2...v0.7.3\n";

  const out = renderChangelogRelease(fixture, "0.8.0", "2026-07-29");

  assert.match(out, /## \[Unreleased\]\n\n## \[0\.8\.0\] - 2026-07-29\n/);
  assert.match(out, /## \[0\.8\.0\][\s\S]*- Something/);
  assert.match(out, /\[Unreleased\]: https:\/\/github\.com\/o\/r\/compare\/v0\.8\.0\.\.\.HEAD/);
  assert.match(out, /\[0\.8\.0\]: https:\/\/github\.com\/o\/r\/compare\/v0\.7\.3\.\.\.v0\.8\.0/);
  // The prior version's own link line is untouched.
  assert.match(out, /\[0\.7\.3\]: https:\/\/github\.com\/o\/r\/compare\/v0\.7\.2\.\.\.v0\.7\.3/);
});

test("renderChangelogRelease throws if the Unreleased heading is already gone", () => {
  assert.throws(() => renderChangelogRelease("## [0.8.0] - 2026-07-29\n", "0.9.0", "2026-08-01"));
});

test("renderChangelogRelease throws if the Unreleased compare-link line is missing", () => {
  assert.throws(() => renderChangelogRelease("## [Unreleased]\n\n- x.\n", "0.8.0", "2026-07-29"));
});

// A no-bullets [Unreleased] must still get its own heading (with a placeholder
// note) rather than being silently skipped — otherwise release.yml's
// "empty RELEASE_NOTES.md" guard fails an entire CONFIRM_EMPTY_CHANGELOG=1
// dependency-only release after the tag is already pushed.
test("renderChangelogRelease adds a placeholder heading when Unreleased has no bullets", () => {
  const fixture =
    "## [Unreleased]\n\n## [0.7.3] - 2026-07-27\n\n### Fixed\n\n- Old thing.\n\n" +
    "[Unreleased]: https://github.com/o/r/compare/v0.7.3...HEAD\n" +
    "[0.7.3]: https://github.com/o/r/compare/v0.7.2...v0.7.3\n";

  const out = renderChangelogRelease(fixture, "0.8.0", "2026-07-29");

  assert.match(
    out,
    /## \[Unreleased\]\n\n## \[0\.8\.0\] - 2026-07-29\n\n_No user-facing changes in this release\._\n\n## \[0\.7\.3\]/,
  );
  assert.match(out, /\[Unreleased\]: https:\/\/github\.com\/o\/r\/compare\/v0\.8\.0\.\.\.HEAD/);
  assert.match(out, /\[0\.8\.0\]: https:\/\/github\.com\/o\/r\/compare\/v0\.7\.3\.\.\.v0\.8\.0/);
  // The prior version's own link line is untouched.
  assert.match(out, /\[0\.7\.3\]: https:\/\/github\.com\/o\/r\/compare\/v0\.7\.2\.\.\.v0\.7\.3/);
});

// Idempotency: re-running for a version whose heading already exists (e.g. a
// retry after a partial `npm version` failure) must be a safe no-op.
test("renderChangelogRelease is idempotent when this version's heading already exists", () => {
  const alreadyReleased =
    "## [Unreleased]\n\n## [0.8.0] - 2026-07-29\n\n### Fixed\n\n- Something.\n\n" +
    "[Unreleased]: https://github.com/o/r/compare/v0.8.0...HEAD\n" +
    "[0.8.0]: https://github.com/o/r/compare/v0.7.3...v0.8.0\n";

  assert.equal(renderChangelogRelease(alreadyReleased, "0.8.0", "2026-07-29"), alreadyReleased);
});

test("unreleasedHasBullets detects a bullet under Unreleased", () => {
  assert.equal(
    unreleasedHasBullets("## [Unreleased]\n\n### Fixed\n\n- Something.\n\n## [0.7.3] - x\n"),
    true,
  );
});

test("unreleasedHasBullets is false when Unreleased has no bullets", () => {
  assert.equal(unreleasedHasBullets("## [Unreleased]\n\n## [0.7.3] - x\n"), false);
});

test("unreleasedHasBullets throws if the Unreleased heading is missing", () => {
  assert.throws(() => unreleasedHasBullets("## [0.7.3] - x\n"));
});
