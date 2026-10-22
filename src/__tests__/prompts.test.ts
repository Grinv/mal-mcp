import { test } from "node:test";
import assert from "node:assert/strict";
import { connectServer, promptText, mockFetch, installFetch, jsonResponse } from "./helpers.js";

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

test("seasonal_overview never silently drops a partial season/year argument", async (t) => {
  // Both arguments are independently optional, but get_seasonal_anime needs them together, so a
  // partial one used to vanish: asking for spring rendered the current-season text with no trace
  // of the input, and the model would answer about the wrong season with full confidence.
  const { client, close } = await connectServer();
  t.after(close);

  const seasonOnly = promptText(
    await client.getPrompt({ name: "seasonal_overview", arguments: { season: "spring" } }),
  );
  assert.match(seasonOnly, /spring/);
  assert.match(seasonOnly, /season=spring/);
  assert.match(seasonOnly, /year=\d{4}/);

  const yearOnly = promptText(
    await client.getPrompt({ name: "seasonal_overview", arguments: { year: "2024" } }),
  );
  assert.match(yearOnly, /2024/);
  assert.match(yearOnly, /year=2024/);
  assert.match(yearOnly, /overview of the year 2024 in anime/);
  assert.doesNotMatch(yearOnly, /anime year in anime/);
  // Only a year was given, so the prompt has to spell out that all four seasons are in scope.
  for (const s of ["winter", "spring", "summer", "fall"]) {
    assert.match(yearOnly, new RegExp(s));
  }
});

test("recommend_similar title completion skips the upstream search under 3 characters", async (t) => {
  const mock = mockFetch(() => jsonResponse({ data: [{ mal_id: 20, title: "Naruto" }] }));
  installFetch(t, mock);
  const { client, close } = await connectServer();
  t.after(close);
  const complete = (value: string) =>
    client.complete({
      ref: { type: "ref/prompt", name: "recommend_similar" },
      argument: { name: "title", value },
    });
  assert.deepEqual((await complete("na ")).completion.values, []);
  assert.equal(mock.calls.length, 0);
  assert.deepEqual((await complete("nar")).completion.values, ["Naruto"]);
  assert.equal(mock.calls.length, 1);
  // A two-character CJK title is a whole title, not a too-broad prefix.
  await complete("銀魂");
  assert.equal(mock.calls.length, 2);
  await complete("銀");
  assert.equal(mock.calls.length, 2);
});
