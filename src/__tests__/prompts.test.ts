import { test } from "node:test";
import assert from "node:assert/strict";
import { connectServer, promptText } from "./helpers.js";

test("recommend_similar prompt embeds the title and tool guidance", async (t) => {
  const { client, close } = await connectServer();
  t.after(close);
  const res = await client.getPrompt({
    name: "recommend_similar",
    arguments: { title: "Naruto" },
  });
  const text = promptText(res);
  assert.match(text, /Naruto/);
  assert.match(text, /get_anime_recommendations/);
});

test("seasonal_overview prompt names the season when provided", async (t) => {
  const { client, close } = await connectServer();
  t.after(close);
  const withSeason = await client.getPrompt({
    name: "seasonal_overview",
    arguments: { season: "spring", year: "2024" },
  });
  assert.match(promptText(withSeason), /spring 2024/);

  const current = await client.getPrompt({ name: "seasonal_overview", arguments: {} });
  assert.match(promptText(current), /current season/);
});

test("hidden_gems prompt names the right top tool per kind", async (t) => {
  const { client, close } = await connectServer();
  t.after(close);
  const anime = await client.getPrompt({ name: "hidden_gems", arguments: {} });
  assert.match(promptText(anime), /get_top_anime/);

  const manga = await client.getPrompt({ name: "hidden_gems", arguments: { kind: "manga" } });
  assert.match(promptText(manga), /get_top_manga/);
});

test("the server lists all prompts", async (t) => {
  const { client, close } = await connectServer();
  t.after(close);
  const { prompts } = await client.listPrompts();
  const names = prompts.map((p) => p.name).sort();
  assert.deepEqual(names, ["hidden_gems", "recommend_similar", "seasonal_overview"]);
});
