// Lists every commit since the last release tag and flags which ones don't appear anywhere in
// CHANGELOG.md, so the changelog-style skill's "gather" step has a concrete checklist instead of
// relying on memory to notice a dropped commit. Not a hard gate (many commits are legitimately
// internal — dev-dependency bumps, docs-about-docs, CI-only fixes — and never get an entry): this
// only reports, so a human/agent can triage each "not found" line as "needs an entry" or
// "correctly excluded, internal."
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

function sh(cmd) {
  return execSync(cmd, { cwd: root, encoding: "utf8" }).trim();
}

const lastTag = sh("git describe --tags --abbrev=0");
const log = sh(`git log ${lastTag}..HEAD --format=%h%x09%s`);
const commits = log
  ? log.split("\n").map((line) => {
      const [sha, ...rest] = line.split("\t");
      return { sha, subject: rest.join("\t") };
    })
  : [];

const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");

const covered = [];
const uncovered = [];
for (const c of commits) {
  (changelog.includes(c.sha) ? covered : uncovered).push(c);
}

console.log(`check-changelog-coverage: ${commits.length} commit(s) since ${lastTag}`);
console.log(`  ${covered.length} referenced in CHANGELOG.md`);
console.log(
  `  ${uncovered.length} not referenced — triage each as "needs an entry" or "correctly excluded (internal)":`,
);
for (const c of uncovered) {
  console.log(`    ${c.sha}  ${c.subject}`);
}
