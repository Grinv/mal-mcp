import { test } from "node:test";
import assert from "node:assert/strict";
import { connectServer } from "./helpers.js";

test("recommend_similar prompt embeds the title and tool guidance", async () => {
  const { client, close } = await connectServer();
  try {
    const res = await client.getPrompt({
      name: "recommend_similar",
      arguments: { title: "Naruto" },
    });
    const text = (res.messages[0]!.content as { type: string; text: string }).text;
    assert.match(text, /Naruto/);
    assert.match(text, /get_anime_recommendations/);
  } finally {
    await close();
  }
});

test("seasonal_overview prompt names the season when provided", async () => {
  const { client, close } = await connectServer();
  try {
    const withSeason = await client.getPrompt({
      name: "seasonal_overview",
      arguments: { season: "spring", year: "2024" },
    });
    assert.match((withSeason.messages[0]!.content as { text: string }).text, /spring 2024/);

    const current = await client.getPrompt({ name: "seasonal_overview", arguments: {} });
    assert.match((current.messages[0]!.content as { text: string }).text, /current season/);
  } finally {
    await close();
  }
});

test("the server lists both prompts", async () => {
  const { client, close } = await connectServer();
  try {
    const { prompts } = await client.listPrompts();
    const names = prompts.map((p) => p.name).sort();
    assert.deepEqual(names, ["recommend_similar", "seasonal_overview"]);
  } finally {
    await close();
  }
});
