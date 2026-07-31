// Typed errors for upstream API failures. Clients throw `ApiError`; tool
// handlers convert it into an MCP tool result (see lib/result.ts) so the
// agent gets an actionable, non-protocol error.

export type ApiErrorCode =
  | "unauthorized" // 401 — token missing/expired/invalid
  | "forbidden" // 403 — insufficient permissions/scope
  | "not_found" // 404 — no such resource
  | "not_modified" // 304 — cached content still fresh (conditional request)
  | "rate_limited" // 429 — slow down
  | "server_error" // 5xx — upstream broke
  | "network" // connection failed
  | "timeout" // request aborted by our timeout
  | "bad_request" // 400/405/422 — malformed or unsupported request
  | "unknown";

// A fact a client can attach to an ApiError for result.ts to act on, without the client
// authoring any user-facing prose itself — messageFor() owns the actual sentence for each hint.
export type ApiErrorHint = "client_id_would_help";

export interface ApiErrorOptions {
  code: ApiErrorCode;
  message: string;
  status?: number;
  retryable?: boolean;
  cause?: unknown;
  hint?: ApiErrorHint;
}

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number | undefined;
  readonly retryable: boolean;
  readonly hint: ApiErrorHint | undefined;

  constructor(opts: ApiErrorOptions) {
    super(opts.message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = "ApiError";
    this.code = opts.code;
    this.status = opts.status;
    this.retryable = opts.retryable ?? false;
    this.hint = opts.hint;
  }
}

/** Map an HTTP status code to an ApiErrorCode and whether a retry may help. */
export function classifyStatus(status: number): { code: ApiErrorCode; retryable: boolean } {
  if (status === 304) return { code: "not_modified", retryable: false };
  if (status === 401) return { code: "unauthorized", retryable: false };
  if (status === 403) return { code: "forbidden", retryable: false };
  if (status === 404) return { code: "not_found", retryable: false };
  if (status === 429) return { code: "rate_limited", retryable: true };
  if (status === 400 || status === 405 || status === 422)
    return { code: "bad_request", retryable: false };
  if (status >= 500) return { code: "server_error", retryable: true };
  return { code: "unknown", retryable: false };
}

// Credential-shaped tokens redact() masks, in both key=value and JSON shapes:
// the OAuth tokens/ids plus the PKCE `code_verifier` (the login exchange's
// secret). The bare authorization `code` is deliberately NOT listed: it's
// single-use, short-lived, never logged by any current path, and a bare `code`
// key collides with the ubiquitous diagnostic `code` field (Node error codes,
// our own ApiErrorCode) that logs must keep readable.
const CREDENTIAL_KEYS = "access_token|refresh_token|client_secret|client_id|code_verifier";

/** Strip anything that looks like a credential before logging. */
export function redact(input: string): string {
  return (
    input
      .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer ***")
      // The Client ID travels as an X-MAL-CLIENT-ID header on official-API reads.
      .replace(/(X-MAL-CLIENT-ID\s*:\s*)\S+/gi, "$1***")
      .replace(new RegExp(`\\b(${CREDENTIAL_KEYS})=([^&\\s"]+)`, "gi"), "$1=***")
      // Same fields, but JSON-body shape ("key":"value") rather than
      // key=value — MAL's token endpoint responds with access_token/
      // refresh_token as JSON, and while this client's own request bodies are
      // form-encoded (no client_secret at all — mal-mcp is a secret-less PKCE
      // client), a raw upstream response body logged verbatim would slip past
      // the key=value pattern above without this.
      .replace(new RegExp(`"(${CREDENTIAL_KEYS})"\\s*:\\s*"[^"]*"`, "gi"), '"$1":"***"')
  );
}
