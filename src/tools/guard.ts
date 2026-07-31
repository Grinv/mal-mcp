// Shared helper: run a tool body and convert any failure into a tool result
// (never throw), so the agent receives an actionable message.
import { ApiError, redact } from "../lib/errors.js";
import { apiErrorToResult, errorResult, type ToolResult } from "../lib/result.js";

export async function guard(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError) return apiErrorToResult(err);
    // Non-ApiError throws carry an arbitrary, un-vetted message. Route it through
    // redact() for parity with the ApiError path (result.ts's baseMessageFor already
    // redacts) so a thrown Error that happens to embed a credential can't leak.
    return errorResult(
      redact(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`),
    );
  }
}
