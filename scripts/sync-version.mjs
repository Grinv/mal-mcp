// Propagate the version from package.json (the single source of truth) into the
// other files that must carry it: src/version.ts, manifest.json (.mcpb bundle),
// server.json (MCP registry, incl. the release-asset URL), and CHANGELOG.md
// (renames [Unreleased] to this version, see renderChangelogRelease below).
// Wired into the npm `version` lifecycle hook (see package.json), so
// `npm version <bump>` updates every file in one commit. Uses targeted token
// replacement — not JSON re-serialization — to preserve each file's exact
// formatting.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function patch(rel, edits) {
  const file = join(root, rel);
  let text = readFileSync(file, "utf8");
  for (const [pattern, replacement] of edits) {
    if (!text.match(pattern)) {
      throw new Error(`sync-version: pattern ${pattern} not found in ${rel} — update the script`);
    }
    text = text.replace(pattern, replacement);
  }
  writeFileSync(file, text);
}

// The leading quote means this never matches `"manifest_version"` in manifest.json.
const versionField = /("version":\s*")[^"]*(")/;

// Rename CHANGELOG.md's `## [Unreleased]` heading to this version (the release
// workflow's CHANGELOG extraction step matches on `## [<version>]` verbatim —
// a repo-history incident on 2026-07-29 shipped a v0.8.0 release commit/tag
// with the heading still saying "Unreleased," which would have produced an
// empty GitHub Release body had it not been caught and fixed before pushing
// the tag). Reopens a fresh, empty [Unreleased] section above it, and rolls
// the trailing compare-link block forward the same way. Pure string -> string
// (no file I/O) so it's directly unit-testable.
export function renderChangelogRelease(text, version, date) {
  const unreleasedHeading = "## [Unreleased]";
  if (!text.includes(unreleasedHeading)) {
    throw new Error(
      "sync-version: no '## [Unreleased]' heading in CHANGELOG.md — already renamed, or the " +
        "heading format changed and this script needs updating.",
    );
  }
  const withHeading = text.replace(
    unreleasedHeading,
    `${unreleasedHeading}\n\n## [${version}] - ${date}`,
  );

  const unreleasedLinkPattern = /\[Unreleased\]: (\S+)\/compare\/(v[^.]+\.[^.]+\.\S+)\.\.\.HEAD/;
  const linkMatch = withHeading.match(unreleasedLinkPattern);
  if (!linkMatch) {
    throw new Error(
      "sync-version: no '[Unreleased]: .../compare/vX.Y.Z...HEAD' link line found in " +
        "CHANGELOG.md — update the script if the link format changed.",
    );
  }
  const [fullMatch, repoUrl, previousVersion] = linkMatch;
  return withHeading.replace(
    fullMatch,
    `[Unreleased]: ${repoUrl}/compare/v${version}...HEAD\n` +
      `[${version}]: ${repoUrl}/compare/${previousVersion}...v${version}`,
  );
}

function main() {
  const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

  patch("src/version.ts", [[/(export const VERSION = ")[^"]*(")/, `$1${version}$2`]]);
  patch("manifest.json", [[versionField, `$1${version}$2`]]);
  patch("server.json", [
    [new RegExp(versionField, "g"), `$1${version}$2`], // top-level + package version
    [/(releases\/download\/v)\d+\.\d+\.\d+(\/)/, `$1${version}$2`], // .mcpb asset URL tag
  ]);

  const changelogFile = join(root, "CHANGELOG.md");
  const date = new Date().toISOString().slice(0, 10);
  const changelog = renderChangelogRelease(readFileSync(changelogFile, "utf8"), version, date);
  writeFileSync(changelogFile, changelog);

  console.log(
    `sync-version: set ${version} in version.ts, manifest.json, server.json, CHANGELOG.md`,
  );
}

// Only run as a script (not when version.test.ts imports renderChangelogRelease).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
