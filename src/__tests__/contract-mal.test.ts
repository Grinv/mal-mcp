// Live contract tests against the real, OAuth-authenticated MyAnimeList API
// (MalClient). Skipped unless RUN_LIVE is set AND real credentials are present
// (MAL_ACCESS_TOKEN, or MAL_CLIENT_ID + MAL_REFRESH_TOKEN) — see docs/auth.md.
// These exist to catch upstream schema drift the new response-validation in
// mal.ts (MyUserInfoSchema/MalListResponseSchema/ListStatusUpdateResponseSchema)
// would reject — a mocked test can't tell us the *real* API still matches them.
//   RUN_LIVE=1 npm test   (reads .env via --env-file, see scripts/run-tests.mjs)
import { test } from "node:test";
import assert from "node:assert/strict";
import { MalClient } from "../clients/mal.js";
import { loadConfig } from "../config.js";
import { silentLogger } from "./helpers.js";

const hasCreds = Boolean(
  process.env.MAL_ACCESS_TOKEN || (process.env.MAL_CLIENT_ID && process.env.MAL_REFRESH_TOKEN),
);
const skip =
  process.env.RUN_LIVE && hasCreds
    ? false
    : "set RUN_LIVE=1 plus MAL_ACCESS_TOKEN or MAL_CLIENT_ID+MAL_REFRESH_TOKEN to run live MAL contract tests";

const client = new MalClient(loadConfig(), silentLogger());

test("live: getMyUserInfo satisfies MyUserInfoSchema", { skip }, async () => {
  const info = (await client.getMyUserInfo()) as Record<string, unknown>;
  assert.equal(typeof info["id"], "number");
  assert.equal(typeof info["name"], "string");
});

test("live: getMyAnimeList satisfies MalListResponseSchema", { skip }, async () => {
  const res = (await client.getMyAnimeList({ limit: 5 })) as {
    items: Record<string, unknown>[];
    has_next_page: boolean;
  };
  assert.ok(Array.isArray(res.items));
  assert.equal(typeof res.has_next_page, "boolean");
});

test("live: getMyMangaList satisfies MalListResponseSchema", { skip }, async () => {
  const res = (await client.getMyMangaList({ limit: 5 })) as { items: unknown[] };
  assert.ok(Array.isArray(res.items));
});

// A real write, kept safe: only touches an entry that isn't already on the live
// list (checked first — skip rather than risk overwriting real data), and always
// deletes it again in `finally`. Validates ListStatusUpdateResponseSchema against
// an actual update_my_anime_status response, not a mocked one.
test(
  "live: updateMyAnimeStatus satisfies ListStatusUpdateResponseSchema, then cleans up",
  { skip },
  async (t) => {
    const TEST_ANIME_ID = 1; // Cowboy Bebop — just used as a scratch list entry
    const existing = (await client.getMyAnimeList({ limit: 1000 })) as {
      items: { mal_id?: number }[];
    };
    if (existing.items.some((i) => i.mal_id === TEST_ANIME_ID)) {
      t.skip(
        `anime ${TEST_ANIME_ID} is already on the live list — skipping to avoid clobbering it`,
      );
      return;
    }
    try {
      const updated = (await client.updateMyAnimeStatus(TEST_ANIME_ID, {
        status: "plan_to_watch",
      })) as Record<string, unknown>;
      assert.equal(updated["status"], "plan_to_watch");
    } finally {
      await client.deleteMyAnimeListItem(TEST_ANIME_ID);
    }
  },
);
