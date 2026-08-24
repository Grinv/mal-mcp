---
name: prompt-check
description: Live-test every MCP Prompt in src/prompts.ts through the real MCP protocol (not a static read) across every argument combination. Use when a prompt is added or its argument-handling logic changes, or as part of a live-audit pass.
---

# Prompt check — live-test every MCP Prompt argument combination

A static read comparing prompt text against tool names/params misses
argument-handling bugs. Actually render every prompt through the real MCP
protocol:

```sh
npx @modelcontextprotocol/inspector --cli node dist/index.js --method prompts/list
npx @modelcontextprotocol/inspector --cli node dist/index.js --method prompts/get \
  --prompt-name <name> --prompt-args key=value key2=value2
```

`--prompt-args` takes space-separated `key=value` pairs, **not** a JSON blob
— the CLI rejects JSON with "Invalid parameter format".

For each of the three prompts, cover every combination of optional args, not
just "all set" or "all omitted":

- `recommend_similar`: no `title` (should ask which anime, not fail — confirm
  the client actually gets asked rather than the call erroring), `title` set
  to something real, `title` set to something with no search results.
- `seasonal_overview`: neither `season` nor `year`, only `season`, only
  `year`, both together. Giving just one of `season`/`year` alone renders
  identically to giving neither ("the current season," no args passed to
  `get_seasonal_anime`) — this is correct, not a bug: `get_seasonal_anime`'s
  own description says supplying only one is treated as omitting both
  (matches `getSeason()`'s `p.year && p.season ? ... : "seasons/now"` in
  `src/clients/tenrai.ts`), so the prompt mirrors the tool's own contract.
  Don't flag this from a source-only read of the prompt's branching alone —
  it resembles the "argument that's individually optional but breaks when
  given alone" bug class, but here the "breakage" is intended.
- `hidden_gems`: no `kind`, `kind=anime`, `kind=manga` — each is a genuinely
  different branch (different top-list tool).
