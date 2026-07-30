// Heuristic candidate-finder for the mal_id/get_seasons_list bug class: a tool's own
// description promises an output field is chainable into another tool ("obtain the mal_id
// from...", "pick a valid argument for..."), but the field is `.optional()` in format.schemas.ts
// instead of required, so a shaper that ever drops it fails no check anywhere.
//
// This is NOT a precise check — matching "does this prose promise chainability" is a semantic
// judgment call, not something regexes prove. It over-reports (flags tools whose promise doesn't
// actually name an optional field) and can under-report (a promise phrased differently than the
// trigger list below). Treat its output as a candidate list for a human/agent to eyeball, the
// same way check-changelog-coverage.mjs's "uncovered" list needs triage, not blind trust.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const TRIGGER_PHRASES = [
  /obtain the/i,
  /needed by/i,
  /pick a valid/i,
  /so you can pick/i,
  /chain(?:ed|s)? into/i,
];

/** Given the index of an opening `{`, return the index of its matching `}` (brace-depth counted,
 *  so nested object literals inside don't confuse the boundary), or -1 if unbalanced. */
function findMatchingBrace(text, openBrace) {
  let depth = 0;
  for (let i = openBrace; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Find every top-level `defineTool({ ... })` block in a source file (brace-matched, so nested
 *  object literals inside a tool's own config don't confuse the boundary). */
function findToolBlocks(text) {
  const blocks = [];
  const marker = "defineTool({";
  let from = 0;
  while (true) {
    const start = text.indexOf(marker, from);
    if (start === -1) break;
    const openBrace = start + "defineTool(".length;
    const end = findMatchingBrace(text, openBrace);
    if (end === -1) throw new Error(`Unbalanced defineTool( block at offset ${start}`);
    blocks.push(text.slice(openBrace, end + 1));
    from = end + 1;
  }
  return blocks;
}

/** Extract a `key: "..." + "..." + ...` concatenated string literal's joined text. */
function extractConcatenatedString(block, key) {
  const keyIdx = block.indexOf(`${key}:`);
  if (keyIdx === -1) return undefined;
  // Scan forward from just after the key, collecting quoted string literals joined by `+`,
  // stopping at the next top-level `,\n      <identifier>:` key or closing brace.
  let i = keyIdx + key.length + 1;
  let text = "";
  while (i < block.length) {
    while (/\s/.test(block[i])) i++;
    if (block[i] === '"') {
      const strEnd = block.indexOf('"', i + 1);
      // Doesn't handle escaped quotes — none of this codebase's descriptions use them.
      text += block.slice(i + 1, strEnd);
      i = strEnd + 1;
    } else if (block[i] === "`") {
      const strEnd = block.indexOf("`", i + 1);
      text += block.slice(i + 1, strEnd);
      i = strEnd + 1;
    } else if (block[i] === "+") {
      i++;
    } else {
      break;
    }
  }
  return text;
}

/** Extract a `key: <bare expression>,` value's raw text (for outputSchema references). */
function extractBareValue(block, key) {
  const keyIdx = block.indexOf(`${key}:`);
  if (keyIdx === -1) return undefined;
  let i = keyIdx + key.length + 1;
  while (/\s/.test(block[i])) i++;
  const end = block.indexOf(",\n", i);
  return block.slice(i, end === -1 ? undefined : end).trim();
}

/** Parse format.schemas.ts into a map of schema-name -> { optionalFields, nestedSchemaRefs }.
 *  Only handles the flat `const/export const X = z.object({ ... }).strict()` shape used
 *  throughout this file (not .extend() chains — those are resolved separately below). */
function parseSchemaOptionalFields(text) {
  const fields = new Map();
  const declPattern = /(?:export )?const (\w+Schema) = z\s*\n?\s*\.object\(\{/g;
  let m;
  while ((m = declPattern.exec(text))) {
    const name = m[1];
    const openBrace = text.indexOf("{", m.index + m[0].length - 1);
    const end = findMatchingBrace(text, openBrace);
    const body = text.slice(openBrace + 1, end);
    const optionalFields = [...body.matchAll(/(\w+):[^,\n]*\.optional\(\)/g)].map((mm) => mm[1]);
    // A field wrapping z.array(someSchema) — e.g. `seasons: z.array(seasonEntrySchema)` — isn't
    // itself optional, but its own fields are where a chainable value can hide one level deeper
    // (exactly where get_seasons_list's `year` bug lived — this schema had zero optional fields
    // of its own, all the interesting ones were inside the nested array's item schema).
    const nestedSchemaRefs = [...body.matchAll(/z\.array\((\w+Schema)\)/g)].map((mm) => mm[1]);
    fields.set(name, { optionalFields, nestedSchemaRefs });
  }
  return fields;
}

const readTs = readFileSync(join(root, "src/tools/read.ts"), "utf8");
const myListTs = readFileSync(join(root, "src/tools/mylist.ts"), "utf8");
const schemasTs = readFileSync(join(root, "src/lib/format.schemas.ts"), "utf8");

const schemaOptionalFields = parseSchemaOptionalFields(schemasTs);

/** Collect a schema's own optional fields plus, recursively, any nested array-item schema's
 *  optional fields (labeled with a dotted path so it's clear where each one actually lives). */
function collectOptionalFields(schemaName, path = schemaName, seen = new Set()) {
  if (!schemaName || seen.has(schemaName)) return [];
  seen.add(schemaName);
  const entry = schemaOptionalFields.get(schemaName);
  if (!entry) return [];
  const own = entry.optionalFields.map((f) => `${path}.${f}`);
  const nested = entry.nestedSchemaRefs.flatMap((ref) =>
    collectOptionalFields(ref, `${path}[].${ref}`, seen),
  );
  return [...own, ...nested];
}

let flagged = 0;
for (const [file, text] of [
  ["read.ts", readTs],
  ["mylist.ts", myListTs],
]) {
  for (const block of findToolBlocks(text)) {
    const name = extractConcatenatedString(block, "name") || extractBareValue(block, "name");
    const description = extractConcatenatedString(block, "description");
    if (!description) continue;
    const matchedPhrase = TRIGGER_PHRASES.find((re) => re.test(description));
    if (!matchedPhrase) continue;

    const outputSchemaExpr = extractBareValue(block, "outputSchema");
    // listPageSchema(X) wraps { results: X[], page } — X's own fields are the interesting ones.
    const wrapped = outputSchemaExpr?.match(/^listPageSchema\((\w+)\)$/);
    const schemaName = wrapped ? wrapped[1] : outputSchemaExpr;
    const optionalFields = collectOptionalFields(schemaName);

    flagged++;
    console.log(`${file}: ${name}`);
    console.log(`  trigger: ${matchedPhrase} matched in description`);
    console.log(`  outputSchema: ${outputSchemaExpr} (item schema: ${schemaName ?? "?"})`);
    console.log(
      `  optional fields to eyeball: ${optionalFields.length ? optionalFields.join(", ") : "(none — or schema not resolved by this script)"}`,
    );
    console.log();
  }
}

console.log(
  `check-chainable-optional-fields: ${flagged} tool(s) flagged for review — for each, confirm ` +
    "the specific field the description promises is NOT in the optional-fields list above " +
    "(if it is, that's the bug: make it required in format.schemas.ts + add a fully-populated-" +
    "fixture test, per AGENTS.md's schema-conventions note and the tool-description-check skill).",
);
