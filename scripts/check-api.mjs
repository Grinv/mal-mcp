// Pre-deploy health check for the upstream APIs this server depends on.
// Jikan endpoints must return 200 with the expected shape; the official MAL
// endpoint must be reachable (401 without a token confirms it is alive and the
// auth gate works). Exits non-zero on any mismatch so a release can be gated.
//
// Run: `npm run check:api`. Requests are spaced to respect Jikan's rate limit.

const JIKAN = process.env.JIKAN_BASE_URL ?? "https://api.jikan.moe/v4";
const MAL = process.env.MAL_BASE_URL ?? "https://api.myanimelist.net/v2";
const SPACING_MS = 700;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// Fetch that tolerates transient 429/5xx (the public Jikan instance rate-limits).
async function fetchResilient(url, attempts = 3) {
  for (let i = 0; ; i += 1) {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (res.status !== 429 && res.status < 500) return res;
    if (i >= attempts - 1) return res;
    const retryAfter = Number(res.headers.get("retry-after"));
    await delay(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * (i + 1));
  }
}

/** @type {{name:string, run:() => Promise<void>}[]} */
const checks = [];
const jikan = (name, path, assertFn) =>
  checks.push({
    name,
    run: async () => {
      const res = await fetchResilient(`${JIKAN}${path}`);
      if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
      const body = await res.json();
      assertFn(body);
    },
  });

const hasData = (b) => {
  if (!b || b.data === undefined) throw new Error("missing `data`");
};
const hasArray = (b) => {
  if (!Array.isArray(b?.data)) throw new Error("`data` is not an array");
};

jikan("anime search", "/anime?q=frieren&limit=1", hasArray);
jikan("anime details", "/anime/52991/full", hasData);
jikan("anime characters", "/anime/52991/characters", hasArray);
jikan("anime recommendations", "/anime/52991/recommendations", hasArray);
jikan("anime reviews", "/anime/52991/reviews?limit=1", hasArray);
jikan("top anime", "/top/anime?limit=1", hasArray);
jikan("seasonal (now)", "/seasons/now?limit=1", hasArray);
jikan("schedule", "/schedules?filter=monday&limit=1", hasArray);
jikan("manga search", "/manga?q=berserk&limit=1", hasArray);
jikan("manga details", "/manga/2/full", hasData);
jikan("user profile", "/users/Xinil/full", hasData);
jikan("user favorites", "/users/Xinil/favorites", hasData);

checks.push({
  name: "MAL reachability (auth required without token)",
  run: async () => {
    const res = await fetch(`${MAL}/users/@me`, { headers: { Accept: "application/json" } });
    // Alive + auth gate working: MAL rejects unauthenticated calls with 401/403.
    if (res.status !== 401 && res.status !== 403) {
      throw new Error(`expected 401/403, got ${res.status}`);
    }
  },
});

const failures = [];
for (const check of checks) {
  try {
    await check.run();
    console.log(`  ok   ${check.name}`);
  } catch (err) {
    failures.push(check.name);
    console.error(`  FAIL ${check.name}: ${err instanceof Error ? err.message : String(err)}`);
  }
  await delay(SPACING_MS);
}

if (failures.length) {
  console.error(`\n${failures.length}/${checks.length} API checks failed.`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} API checks passed.`);
