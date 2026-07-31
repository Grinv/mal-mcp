// Persists the MAL OAuth token state (access + rotated refresh token) so the
// silent-refresh flow survives restarts. MAL rotates the refresh token on each
// refresh, so we must write the new one back. The file is created 0600 inside
// the user's OS config directory.
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import type { Logger } from "./logger.js";

export interface TokenState {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds at which the access token expires. */
  expiresAt: number;
}

export class TokenStore {
  readonly #path: string;
  readonly #logger: Logger;

  constructor(path: string, logger: Logger) {
    this.#path = path;
    this.#logger = logger;
  }

  get path(): string {
    return this.#path;
  }

  /** Returns persisted state, or undefined if absent/unreadable/corrupt. */
  load(): TokenState | undefined {
    let raw: string;
    try {
      raw = readFileSync(this.#path, "utf8");
    } catch {
      return undefined; // not created yet
    }
    try {
      const parsed = JSON.parse(raw) as Partial<TokenState>;
      if (
        typeof parsed.accessToken === "string" &&
        typeof parsed.refreshToken === "string" &&
        typeof parsed.expiresAt === "number"
      ) {
        return parsed as TokenState;
      }
      this.#logger.warn(`token store at ${this.#path} is malformed; ignoring it`);
      return undefined;
    } catch {
      this.#logger.warn(`token store at ${this.#path} is not valid JSON; ignoring it`);
      return undefined;
    }
  }

  save(state: TokenState): void {
    // POSIX modes restrict access on macOS/Linux. Windows ignores them (the
    // file inherits directory ACLs) — best effort, no error there.
    mkdirSync(dirname(this.#path), { recursive: true, mode: 0o700 });
    // Write to a temp file then rename over the target. rename() is atomic on the
    // same filesystem, so a crash mid-write can't leave a truncated token file
    // (load() would silently drop it and force a re-login). It also guarantees the
    // result is 0600 even when the destination already exists: writeFileSync's
    // `mode` only applies when it creates the file, so an in-place rewrite of a
    // pre-existing looser-permissioned file would otherwise keep the old mode.
    // The pid suffix keeps two processes' temp files from colliding.
    const tmp = `${this.#path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    renameSync(tmp, this.#path);
  }
}

/** Default token store path, honoring MAL_TOKEN_STORE then OS conventions. */
export function defaultTokenStorePath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.MAL_TOKEN_STORE) return env.MAL_TOKEN_STORE;
  const base =
    platform() === "win32"
      ? (env.APPDATA ?? join(homedir(), "AppData", "Roaming"))
      : (env.XDG_CONFIG_HOME ?? join(homedir(), ".config"));
  return join(base, "mal-mcp", "tokens.json");
}
