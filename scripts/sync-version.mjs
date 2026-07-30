// Propagate the version from package.json (the single source of truth) into the
// other files that must carry it: src/version.ts, manifest.json (.mcpb bundle),
// server.json (MCP registry, incl. the release-asset URL), and CHANGELOG.md
// (renames [Unreleased] to this version, see renderChangelogRelease below).
// Wired into the npm `version` lifecycle hook (see package.json), so
// `npm version <bump>` updates every file in one commit. Uses targeted token
// replacement — not JSON re-serialization — to preserve each file's exact
// formatting.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

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

// Shared with preversion-check.mjs's checkChangelog(): does CHANGELOG.md's
// [Unreleased] section (everything up to the next "## [" heading) contain a
// real bullet? Checks for an actual bullet (`- `) rather than just "is a
// heading immediately next" — robust to stray blank lines. Exported so both
// scripts encode this one rule exactly once instead of two independently
// drifting regexes.
export function unreleasedHasBullets(text) {
  const marker = "## [Unreleased]\n";
  const idx = text.indexOf(marker);
  if (idx === -1) {
    throw new Error(`sync-version: '${marker.trim()}' heading not found in CHANGELOG.md`);
  }
  const afterMarker = text.slice(idx + marker.length);
  // afterMarker starts right after Unreleased's own heading line, so the next "## [" — however
  // far away, with or without a blank line before it — always marks the next heading's start;
  // no need to anchor on a preceding \n (a prior version of this regex did, and swallowed the
  // whole rest of the file when Unreleased had no blank line before the next heading — see
  // AGENTS.md, 2026-07-30).
  const nextHeadingIdx = afterMarker.search(/## \[/);
  const body = nextHeadingIdx === -1 ? afterMarker : afterMarker.slice(0, nextHeadingIdx);
  return /^-\s/m.test(body.trim());
}

// Rename CHANGELOG.md's `## [Unreleased]` heading to this version (the release
// workflow's CHANGELOG extraction step matches on `## [<version>]` verbatim —
// a repo-history incident on 2026-07-29 shipped a v0.8.0 release commit/tag
// with the heading still saying "Unreleased," which would have produced an
// empty GitHub Release body had it not been caught and fixed before pushing
// the tag). Reopens a fresh, empty [Unreleased] section above it, and rolls
// the trailing compare-link block forward the same way. Pure string -> string
// (no file I/O) so it's directly unit-testable.
//
// Idempotent: if this version's own heading already exists, returns the text
// unchanged — a safe no-op on a re-run after a partial failure (e.g. `npm
// version` completing this rewrite but a later step in the same run
// crashing). A no-bullets [Unreleased] still gets its own heading (with a
// placeholder note under it) rather than being silently skipped — the
// release workflow's "empty RELEASE_NOTES.md" guard needs every real release
// to have a non-empty section, including a CONFIRM_EMPTY_CHANGELOG=1
// dependency-only release.
export function renderChangelogRelease(text, version, date) {
  if (text.includes(`## [${version}] - `)) {
    return text;
  }

  const unreleasedHeading = "## [Unreleased]";
  if (!text.includes(unreleasedHeading)) {
    throw new Error(
      "sync-version: no '## [Unreleased]' heading in CHANGELOG.md — already renamed, or the " +
        "heading format changed and this script needs updating.",
    );
  }
  const hasBullets = unreleasedHasBullets(text);
  const newHeading = hasBullets
    ? `${unreleasedHeading}\n\n## [${version}] - ${date}`
    : `${unreleasedHeading}\n\n## [${version}] - ${date}\n\n_No user-facing changes in this release._`;
  const withHeading = text.replace(unreleasedHeading, newHeading);

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
// `process.argv[1]` is a raw OS path (backslash-separated on Windows) with no
// URL scheme, while `import.meta.url` is always a well-formed `file://` URL —
// naively concatenating `file://` + the path can never string-equal it on
// Windows, so this guard used to silently never match there. pathToFileURL()
// normalizes both sides to the same URL form. The `process.argv[1] &&` guard
// matters too: it's undefined for a no-script invocation (e.g. `node -e`),
// and pathToFileURL(undefined) throws rather than just failing to match.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
