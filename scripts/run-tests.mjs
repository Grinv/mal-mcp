// Cross-platform test runner: runs `node --test` with the working directory set
// to dist-tests (where compiled *.test.js + their imports live). Avoids the
// POSIX-only `(cd dir && ...)` shell idiom so it works on Windows cmd.exe too.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Keep this in sync with the CI "Coverage gate" step (.github/workflows/ci.yml).
const COVERAGE_LINES_THRESHOLD = 80;

// Any arg besides --coverage is passed straight through to `node --test`, so
// e.g. `npm test -- --test-name-pattern=foo` can run a subset locally.
const rawArgs = process.argv.slice(2);
const coverage = rawArgs.includes("--coverage");
const passthrough = rawArgs.filter((a) => a !== "--coverage");

// `--test-coverage-lines` (a hard, fail-the-run threshold) landed in Node 22.8.
// On older runtimes — including the Node 20 floor — fall back to reporting
// coverage without enforcing it, so `npm run test:coverage` still works there.
const [major, minor] = process.versions.node.split(".").map(Number);
const supportsThreshold = major > 22 || (major === 22 && minor >= 8);

const args = ["--test", ...passthrough];
if (coverage) {
  args.push("--experimental-test-coverage");
  if (supportsThreshold) args.push(`--test-coverage-lines=${COVERAGE_LINES_THRESHOLD}`);
}

// RUN_LIVE=1 npm test exercises the *.test.ts "live:" contract suites against the
// real Jikan/MAL APIs. Those need real credentials (MAL_CLIENT_ID, MAL_ACCESS_TOKEN,
// MAL_REFRESH_TOKEN) that live in the repo's gitignored .env, not process.env — load
// it only in that opt-in path, via Node's built-in --env-file (no dotenv dependency).
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(repoRoot, ".env");
if (process.env.RUN_LIVE && existsSync(envFile)) {
  args.push(`--env-file=${envFile}`);
}

const child = spawn(process.execPath, args, { cwd: "dist-tests", stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
