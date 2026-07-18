import { test } from "node:test";
import assert from "node:assert/strict";
import {
  summarizeOfficialAnime,
  summarizeOfficialManga,
  type OfficialAnimeNode,
  type OfficialMangaNode,
} from "../lib/formatOfficial.js";

test("summarizeOfficialAnime passes an unmapped status string through unchanged", () => {
  const s = summarizeOfficialAnime({ id: 1, status: "some_new_status" } as OfficialAnimeNode);
  assert.equal(s["status"], "some_new_status");
});

test("summarizeOfficialManga passes an unmapped status string through unchanged", () => {
  const s = summarizeOfficialManga({ id: 1, status: "some_new_status" } as OfficialMangaNode);
  assert.equal(s["status"], "some_new_status");
});

test("summarizeOfficialAnime treats num_episodes: 0 as unknown, not a literal 0", () => {
  const s = summarizeOfficialAnime({ id: 1, num_episodes: 0 } as OfficialAnimeNode);
  assert.ok(!("episodes" in s));
});

test("summarizeOfficialManga treats num_chapters/num_volumes: 0 as unknown", () => {
  const s = summarizeOfficialManga({
    id: 1,
    num_chapters: 0,
    num_volumes: 0,
  } as OfficialMangaNode);
  assert.ok(!("chapters" in s));
  assert.ok(!("volumes" in s));
});

test("summarizeOfficialManga drops author entries with neither a first nor last name", () => {
  const s = summarizeOfficialManga({
    id: 1,
    authors: [{ node: { first_name: "Masashi", last_name: "Kishimoto" } }, { node: {} }],
  } as OfficialMangaNode);
  assert.deepEqual(s["authors"], ["Masashi Kishimoto"]);
});
