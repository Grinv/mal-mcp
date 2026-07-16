// Helpers that build MCP tool results. Tool handlers return these objects;
// failures become { isError: true } results (never thrown) so the agent
// receives an actionable message instead of a protocol error.
import { redact, type ApiError, type ApiErrorHint } from "./errors.js";

export interface ToolResult {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  // Matches the SDK's CallToolResult index signature.
  [key: string]: unknown;
}

/** Success result carrying both a text mirror and structured data.
 *
 * The text is compact (no indentation): MCP clients that don't read
 * `structuredContent` fall back to this string and feed it to the model, so
 * pretty-print whitespace would be pure token overhead. */
export function jsonResult(structured: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(structured) }],
    structuredContent: structured,
  };
}

export function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Translate an upstream ApiError into a friendly, actionable tool error. */
export function apiErrorToResult(err: ApiError): ToolResult {
  return errorResult(messageFor(err));
}

// Prose for each ApiErrorHint — the sole place hint text is authored. Clients (e.g.
// jikanFallback.ts) only attach the marker fact; they never construct user-facing copy.
const HINT_TEXT: Record<ApiErrorHint, string> = {
  client_id_would_help:
    "Tip: setting the MAL_CLIENT_ID environment variable would let this retry via the official " +
    "MAL API when Jikan has trouble (no login needed) — see docs/auth.md.",
};

function messageFor(err: ApiError): string {
  const hint = err.hint ? ` ${HINT_TEXT[err.hint]}` : "";
  return baseMessageFor(err) + hint;
}

// `err.message` is upstream-controlled text (an HTTP response body, or a network-layer
// exception message) — redact() strips anything credential-shaped before it reaches the
// agent/user, and wrapping it in parens keeps the surrounding sentence's punctuation clean
// regardless of whether the upstream text itself ends mid-sentence or with its own period.
function baseMessageFor(err: ApiError): string {
  switch (err.code) {
    case "unauthorized":
      return (
        "MyAnimeList rejected the access token (401). It may be missing or expired. " +
        "Run the login_mal tool to (re)authorize, or set MAL_CLIENT_ID + MAL_REFRESH_TOKEN " +
        "to enable automatic token refresh. See docs/auth.md."
      );
    case "forbidden":
      return "MyAnimeList denied access (403). The token may lack the required permissions.";
    case "not_found":
      return "No matching resource was found (404).";
    case "not_modified":
      return "The content has not changed since the last request (304).";
    case "rate_limited":
      return "Upstream rate limit hit (429). Please retry in a few seconds.";
    case "server_error":
      return `The upstream service returned an error (5xx). Please retry later. (${redact(err.message)})`;
    case "network":
      return (
        `Could not reach the upstream service (network error). Check connectivity and ` +
        `retry. (${redact(err.message)})`
      );
    case "timeout":
      return `The upstream request timed out. Please retry. (${redact(err.message)})`;
    case "bad_request":
      return `The request was rejected as invalid: ${redact(err.message)}`;
    default:
      return `Unexpected error talking to the upstream service: ${redact(err.message)}`;
  }
}
