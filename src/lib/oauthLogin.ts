// Helpers for the interactive MAL login (login_mal tool). MAL uses OAuth2
// authorization-code with PKCE — and only the `plain` method (code_challenge ==
// code_verifier). mal-mcp is a public client, so there is no client secret.
//
// Two ways to receive the redirect `code`:
//   - a best-effort localhost listener (works when the browser is on the same
//     machine as the server — local Claude Desktop / Claude Code), and
//   - manual paste of the redirected URL (works everywhere, incl. SSH/remote/
//     headless where localhost isn't reachable from the user's browser).
// Both paths converge on the same code→token exchange.
import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { platform } from "node:os";

/** A high-entropy PKCE code verifier: 43–128 chars from the unreserved set
 *  (RFC 7636). base64url of 64 random bytes → 86 chars, well within range. */
export function generateVerifier(): string {
  return randomBytes(64).toString("base64url");
}

/** Build the MAL authorize URL for the PKCE `plain` method (challenge == verifier). */
export function buildAuthorizeUrl(opts: {
  oauthBaseUrl: string;
  clientId: string;
  redirectUri: string;
  verifier: string;
  state?: string;
}): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: opts.clientId,
    code_challenge: opts.verifier,
    code_challenge_method: "plain",
    redirect_uri: opts.redirectUri,
  });
  if (opts.state) q.set("state", opts.state);
  return `${opts.oauthBaseUrl.replace(/\/$/, "")}/authorize?${q.toString()}`;
}

/** Extract the `code` from a redirected URL, a bare `?code=…` query, or a raw
 *  code string. Throws with the OAuth `error` when the redirect denied access. */
export function extractCode(redirect: string): string {
  const text = redirect.trim();
  let params: URLSearchParams | undefined;
  try {
    params = new URL(text).searchParams;
  } catch {
    // Not a full URL — maybe "?code=…&state=…" or just the code.
    if (text.includes("=")) params = new URLSearchParams(text.replace(/^\?/, ""));
  }
  if (params) {
    const err = params.get("error");
    if (err) throw new Error(`authorization denied: ${err}`);
    const code = params.get("code");
    if (code) return code;
    throw new Error("no `code` found in the pasted redirect URL");
  }
  if (!text) throw new Error("empty redirect/code");
  return text; // treat the whole string as the bare code
}

/** Open a URL in the OS default browser. Best-effort — never throws (headless/
 *  remote hosts simply won't have a browser, and that's fine). */
export function openBrowser(url: string): void {
  const cmd = platform() === "darwin" ? "open" : platform() === "win32" ? "cmd" : "xdg-open";
  const args = platform() === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* no browser available — the caller falls back to manual paste */
  }
}

/** Start a localhost HTTP listener that resolves with the first `code` it
 *  receives on `path`. Best-effort: rejects if the port can't be bound. The
 *  returned `close()` stops the server (call it once the flow is done, whichever
 *  path completed). */
export function listenForCode(opts: {
  port: number;
  path: string;
  onCode: (code: string) => void;
}): Promise<{ server: Server; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      let code: string | null = null;
      let denied: string | null = null;
      try {
        const url = new URL(req.url ?? "/", `http://localhost:${opts.port}`);
        if (!url.pathname.startsWith(opts.path)) {
          res.writeHead(404).end();
          return;
        }
        code = url.searchParams.get("code");
        denied = url.searchParams.get("error");
      } catch {
        /* fall through to the generic reply */
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        denied
          ? "<h2>MyAnimeList login was denied. You can close this tab.</h2>"
          : code
            ? "<h2>Logged in to MyAnimeList — you can close this tab and return to your client.</h2>"
            : "<h2>Waiting for the MyAnimeList redirect…</h2>",
      );
      if (code) opts.onCode(code);
    });
    server.on("error", reject);
    server.listen(opts.port, "127.0.0.1", () => {
      resolve({ server, close: () => server.close() });
    });
  });
}
