// TokenStore had no tests of its own: mal.test.ts only exercised it incidentally, on the happy
// path. The invariant its own comments promise — the file ends up 0600 no matter what was there
// before — went unverified, and that is the one worth pinning: it guards a credential at rest.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TokenStore, defaultTokenStorePath, type TokenState } from "../lib/tokenStore.js";
import { silentLogger } from "./helpers.js";
import { createLogger, type Logger } from "../lib/logger.js";

// POSIX modes are advisory on Windows (the file inherits directory ACLs), so the permission
// assertions below would fail there for reasons that say nothing about this code.
const posix = process.platform !== "win32";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "mal-mcp-tokenstore-"));
}

function capturingLogger(): Logger & { warnings: string[] } {
  const warnings: string[] = [];
  const base = createLogger("silent");
  return { ...base, warnings, warn: (msg: string) => warnings.push(msg) };
}

const STATE: TokenState = { accessToken: "a", refreshToken: "r", expiresAt: 1_700_000_000_000 };

test("save then load round-trips the token state", () => {
  const dir = tempDir();
  try {
    const store = new TokenStore(join(dir, "tokens.json"), silentLogger());
    store.save(STATE);
    assert.deepEqual(store.load(), STATE);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("save creates the file 0600", { skip: !posix }, () => {
  const dir = tempDir();
  try {
    const path = join(dir, "tokens.json");
    new TokenStore(path, silentLogger()).save(STATE);
    assert.equal(statSync(path).mode & 0o777, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("save tightens an existing world-readable token file to 0600", { skip: !posix }, () => {
  // writeFileSync's `mode` only applies on create, so an in-place rewrite would keep 0644.
  // Writing to a temp file and renaming over the target is what makes this hold.
  const dir = tempDir();
  try {
    const path = join(dir, "tokens.json");
    writeFileSync(path, "{}", { mode: 0o644 });
    new TokenStore(path, silentLogger()).save(STATE);
    assert.equal(statSync(path).mode & 0o777, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("save is unaffected by a leftover loose-permissioned temp file", { skip: !posix }, () => {
  // Regression: the temp name is `<path>.<pid>.tmp`, and pids get reused, so a temp file left
  // behind by a killed process can still be sitting there. Writing into it would hit the same
  // mode-only-on-create rule, and rename() would then carry 0666 onto the real token file.
  const dir = tempDir();
  try {
    const path = join(dir, "tokens.json");
    writeFileSync(`${path}.${process.pid}.tmp`, "stale", { mode: 0o666 });
    new TokenStore(path, silentLogger()).save(STATE);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")) as TokenState, STATE);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("save creates the parent directory 0700", { skip: !posix }, () => {
  const dir = tempDir();
  try {
    const nested = join(dir, "config", "mal-mcp");
    new TokenStore(join(nested, "tokens.json"), silentLogger()).save(STATE);
    assert.equal(statSync(nested).mode & 0o777, 0o700);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("load returns undefined when the file does not exist", () => {
  const dir = tempDir();
  try {
    assert.equal(new TokenStore(join(dir, "absent.json"), silentLogger()).load(), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("load warns and ignores a file that is not valid JSON", () => {
  const dir = tempDir();
  try {
    const path = join(dir, "tokens.json");
    writeFileSync(path, "not json{");
    const logger = capturingLogger();
    assert.equal(new TokenStore(path, logger).load(), undefined);
    assert.equal(logger.warnings.length, 1);
    assert.match(logger.warnings[0]!, /is not valid JSON; ignoring it/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("load warns and ignores valid JSON of the wrong shape", () => {
  const dir = tempDir();
  try {
    const path = join(dir, "tokens.json");
    writeFileSync(path, JSON.stringify({ nothing: "useful" }));
    const logger = capturingLogger();
    assert.equal(new TokenStore(path, logger).load(), undefined);
    assert.equal(logger.warnings.length, 1);
    assert.match(logger.warnings[0]!, /is malformed; ignoring it/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("load returns undefined for a directory in place of the file", () => {
  const dir = tempDir();
  try {
    const path = join(dir, "tokens.json");
    mkdirSync(path);
    assert.equal(new TokenStore(path, capturingLogger()).load(), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("defaultTokenStorePath prefers MAL_TOKEN_STORE over every OS convention", () => {
  assert.equal(
    defaultTokenStorePath({ MAL_TOKEN_STORE: "/custom/tokens.json", XDG_CONFIG_HOME: "/xdg" }),
    "/custom/tokens.json",
  );
});

test("defaultTokenStorePath honors XDG_CONFIG_HOME", { skip: !posix }, () => {
  const path = defaultTokenStorePath({ XDG_CONFIG_HOME: "/xdg" });
  assert.equal(path, join("/xdg", "mal-mcp", "tokens.json"));
});

test("defaultTokenStorePath falls back to the home directory", () => {
  const path = defaultTokenStorePath({});
  assert.match(path, /mal-mcp/);
  assert.match(path, /tokens\.json$/);
});
