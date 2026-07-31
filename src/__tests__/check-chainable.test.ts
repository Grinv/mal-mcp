import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSchemaOptionalFields } from "../../scripts/check-chainable-optional-fields.mjs";

// Regression guard for the check-chainable-optional-fields heuristic. The declaration regex
// once matched only `z.object(`, so after format.schemas.ts migrated to `z.strictObject(` the
// script silently resolved ZERO schemas and reported every flagged tool as "schema not resolved"
// — defeating the exact mal_id/year chainable-field check it exists to run. These tests fail if
// that regex ever stops matching the shapes the codebase actually uses.

test("parseSchemaOptionalFields resolves z.strictObject schemas (the migrated-to shape)", () => {
  const src = [
    "export const fooSchema = z.strictObject({",
    "  mal_id: z.number(),",
    "  title_english: z.string().optional(),",
    "  note: z.string().optional(),",
    "});",
  ].join("\n");
  const map = parseSchemaOptionalFields(src);
  const foo = map.get("fooSchema");
  assert.ok(foo, "a z.strictObject schema must be resolved, not skipped");
  assert.deepEqual(foo.optionalFields, ["title_english", "note"]);
});

test("parseSchemaOptionalFields still handles legacy z.object and z.looseObject", () => {
  const src = [
    "const barSchema = z.object({ a: z.string().optional() });",
    "const bazSchema = z.looseObject({ b: z.number() });",
  ].join("\n");
  const map = parseSchemaOptionalFields(src);
  const bar = map.get("barSchema");
  const baz = map.get("bazSchema");
  assert.ok(bar, "a legacy z.object schema must be resolved");
  assert.deepEqual(bar.optionalFields, ["a"]);
  assert.ok(baz, "a z.looseObject schema must be resolved too");
  assert.deepEqual(baz.optionalFields, []);
});

test("parseSchemaOptionalFields captures nested array item-schema refs", () => {
  const src = "const seasonsListSchema = z.strictObject({ seasons: z.array(seasonEntrySchema) });";
  const map = parseSchemaOptionalFields(src);
  const seasons = map.get("seasonsListSchema");
  assert.ok(seasons, "a z.strictObject schema must be resolved");
  assert.deepEqual(seasons.nestedSchemaRefs, ["seasonEntrySchema"]);
});

test("the real format.schemas.ts actually resolves (not zero schemas), and seasonEntrySchema.year is required", () => {
  const root = join(import.meta.dirname, "..", "..");
  const schemas = readFileSync(join(root, "src/lib/format.schemas.ts"), "utf8");
  const map = parseSchemaOptionalFields(schemas);
  // The original bug: the regex matched nothing, so the map came back empty.
  assert.ok(map.size > 10, `expected many schemas resolved, got ${map.size}`);
  const season = map.get("seasonEntrySchema");
  assert.ok(season, "seasonEntrySchema (a z.strictObject) must resolve");
  // get_seasons_list's description promises `year` is chainable, so it must NOT be optional.
  assert.ok(
    !season.optionalFields.includes("year"),
    "seasonEntrySchema.year must be required (chainable field), not optional",
  );
});
