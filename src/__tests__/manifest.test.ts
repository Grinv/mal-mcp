import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { connectServer } from "./helpers.js";

// Tests run from dist-tests/; repo root is one level up.
const repoRoot = join(process.cwd(), "..");
const manifest = JSON.parse(readFileSync(join(repoRoot, "manifest.json"), "utf8")) as {
  manifest_version: string;
  tools: { name: string }[];
};

// Schema versions shipped by the installed @anthropic-ai/mcpb (freshness guard:
// if a future bump drops our version's schema, this test fails and nudges us).
const schemaDir = join(repoRoot, "node_modules", "@anthropic-ai", "mcpb", "dist");
const supported = readdirSync(schemaDir)
  .map((f) => /^mcpb-manifest-v(\d+\.\d+)\.schema\.json$/.exec(f)?.[1])
  .filter((v): v is string => Boolean(v));

test("manifest_version is still supported by the installed @anthropic-ai/mcpb", () => {
  assert.ok(supported.length > 0, "no mcpb manifest schemas found");
  assert.ok(
    supported.includes(manifest.manifest_version),
    `manifest_version ${manifest.manifest_version} not in supported [${supported.join(", ")}]`,
  );
});

// manifest.json's `tools` list is manually curated (tools_generated: false) — it drifted
// out of sync with the real tool set once already (missing 22 tools added across the
// v0.2.0/v0.3.0 expansions) with nothing to catch it. This keeps the two in lockstep.
test("manifest.json's tools list matches every tool the server actually registers", async (t) => {
  const { client, close } = await connectServer();
  t.after(close);
  const { tools } = await client.listTools();
  const registered = tools.map((tool) => tool.name).sort();
  const listed = manifest.tools.map((tool) => tool.name).sort();
  assert.deepEqual(listed, registered);
});
