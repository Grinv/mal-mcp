// guard() is the one net between a tool handler and the MCP protocol: nothing it
// wraps may ever throw past it. Exercised indirectly by every end-to-end tool test
// (tools.test.ts) for the ApiError/success paths — this file covers it directly,
// including the non-Error-throw edge case those never hit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { guard } from "../tools/guard.js";
import { ApiError } from "../lib/errors.js";
import { jsonResult, type ToolResult } from "../lib/result.js";
import { toolText } from "./helpers.js";

test("guard passes through a successful result unchanged", async () => {
  const res = await guard(() => Promise.resolve(jsonResult({ ok: true })));
  assert.equal(res.isError, undefined);
  assert.deepEqual(res.structuredContent, { ok: true });
});

test("guard converts a thrown ApiError into its actionable message", async () => {
  const res = await guard((): Promise<ToolResult> => {
    throw new ApiError({ code: "not_found", message: "no such anime" });
  });
  assert.equal(res.isError, true);
  assert.match(toolText(res), /no matching resource/i);
});

test("guard converts a thrown plain Error into its message", async () => {
  const res = await guard((): Promise<ToolResult> => {
    throw new Error("kaboom");
  });
  assert.equal(res.isError, true);
  assert.equal(toolText(res), "Unexpected error: kaboom");
});

test("guard converts a thrown non-Error value (e.g. a bare string) via String()", async () => {
  const res = await guard((): Promise<ToolResult> => {
    throw "plain string failure";
  });
  assert.equal(res.isError, true);
  assert.equal(toolText(res), "Unexpected error: plain string failure");
});
