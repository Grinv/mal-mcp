// Cross-platform test runner: runs `node --test` over src/**/*.test.ts straight through Node's
// built-in TypeScript type stripping (no build step). A Node script rather than an npm-script
// one-liner so the flags below stay in one place and quoting works on Windows cmd.exe too.
import { spawn } from "node:child_process";
import { join } from "node:path";

// Keep this in sync with the CI "Coverage gate" step (.github/workflows/ci.yml).
const COVERAGE_LINES_THRESHOLD = 80;

// Any arg besides --coverage is passed straight through to `node --test`, so
// e.g. `npm test -- --test-name-pattern=foo` can run a subset locally.
const rawArgs = process.argv.slice(2);
const coverage = rawArgs.includes("--coverage");
const passthrough = rawArgs.filter((a) => a !== "--coverage");

const repoRoot = join(import.meta.dirname, "..");
const args = ["--test", ...passthrough];
if (coverage) {
  args.push(
    "--experimental-test-coverage",
    `--test-coverage-lines=${COVERAGE_LINES_THRESHOLD}`,
    // Measure the code under test, not the tests measuring it.
    "--test-coverage-exclude=src/__tests__/**",
  );
}

// RUN_LIVE=1 npm test exercises the *.test.ts "live:" contract suites against the
// real Tenrai/MAL APIs. Those need real credentials (MAL_CLIENT_ID, MAL_ACCESS_TOKEN,
// MAL_REFRESH_TOKEN) that live in the repo's gitignored .env, not process.env — load
// it only in that opt-in path, via Node's built-in --env-file (no dotenv dependency).
if (process.env.RUN_LIVE) args.push(`--env-file-if-exists=${join(repoRoot, ".env")}`);

// One argument, no shell: node --test expands the glob itself, the same way on every OS.
args.push("src/**/*.test.ts");

const child = spawn(process.execPath, args, { cwd: repoRoot, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
