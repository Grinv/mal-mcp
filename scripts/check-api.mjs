// Pre-deploy health check for the upstream APIs this server depends on.
//
// Distinguishes two failure classes:
//   - CONTRACT drift (404, unexpected status, wrong response shape) → FAIL the
//     release: the API changed and our integration is likely broken.
//   - TRANSIENT outage (5xx / 429 / timeout / network) → WARN only: the upstream
//     is momentarily down; that is no reason to block shipping our own code.
//
// Run: `npm run check:api`. Requests are spaced to respect Jikan's rate limit.

const JIKAN = process.env.JIKAN_BASE_URL ?? "https://api.jikan.moe/v4";
const MAL = process.env.MAL_BASE_URL ?? "https://api.myanimelist.net/v2";
const SPACING_MS = 700;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

class TransientError extends Error {}
class ContractError extends Error {}

// Fetch with retries for transient 429/5xx; network failures are transient too.
async function fetchResilient(url, attempts = 3) {
  let last;
  for (let i = 0; ; i += 1) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (res.status !== 429 && res.status < 500) return res;
      last = new TransientError(`upstream ${res.status}`);
    } catch (err) {
      last = new TransientError(`network: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (i >= attempts - 1) throw last;
    await delay(1000 * (i + 1));
  }
}

const checks = [];
const jikan = (name, path, assertFn) =>
  checks.push({
    name,
    run: async () => {
      const res = await fetchResilient(`${JIKAN}${path}`);
      if (res.status !== 200) throw new ContractError(`expected 200, got ${res.status}`);
      assertFn(await res.json());
    },
  });

const hasData = (b) => {
  if (!b || b.data === undefined) throw new ContractError("missing `data`");
};
const hasArray = (b) => {
  if (!Array.isArray(b?.data)) throw new ContractError("`data` is not an array");
};

jikan("anime search", "/anime?q=frieren&limit=1", hasArray);
jikan("anime details", "/anime/52991/full", hasData);
jikan("anime characters", "/anime/52991/characters", hasArray);
jikan("anime recommendations", "/anime/52991/recommendations", hasArray);
jikan("anime reviews", "/anime/52991/reviews?limit=1", hasArray);
jikan("anime episodes", "/anime/52991/episodes", hasArray);
jikan("anime genres", "/genres/anime", hasArray);
jikan("top anime", "/top/anime?limit=1", hasArray);
jikan("seasonal (now)", "/seasons/now?limit=1", hasArray);
jikan("schedule", "/schedules?filter=monday&limit=1", hasArray);
jikan("manga search", "/manga?q=berserk&limit=1", hasArray);
jikan("manga details", "/manga/2/full", hasData);
jikan("manga characters", "/manga/2/characters", hasArray);
jikan("manga recommendations", "/manga/2/recommendations", hasArray);
jikan("manga reviews", "/manga/2/reviews?limit=1", hasArray);
jikan("manga genres", "/genres/manga", hasArray);
jikan("user profile", "/users/Xinil/full", hasData);
jikan("user favorites", "/users/Xinil/favorites", hasData);
jikan("character details", "/characters/1/full", hasData);
jikan("character search", "/characters?q=spike&limit=1", hasArray);
jikan("person details", "/people/1/full", hasData);
jikan("anime staff", "/anime/52991/staff", hasArray);
jikan("anime statistics", "/anime/52991/statistics", hasData);
jikan("random anime", "/random/anime", hasData);
jikan("upcoming season", "/seasons/upcoming?limit=1", hasArray);
jikan("producers", "/producers?limit=1", hasArray);
jikan("top people", "/top/people?limit=1", hasArray);
jikan("top characters", "/top/characters?limit=1", hasArray);
jikan("seasons list", "/seasons", hasArray);
jikan("random character", "/random/characters", hasData);
jikan("anime news", "/anime/52991/news", hasArray);

checks.push({
  name: "MAL reachability (auth required without token)",
  run: async () => {
    const res = await fetchResilient(`${MAL}/users/@me`);
    // Alive + auth gate working: MAL rejects unauthenticated calls with 401/403.
    if (res.status !== 401 && res.status !== 403) {
      throw new ContractError(`expected 401/403, got ${res.status}`);
    }
  },
});

const failures = [];
const warnings = [];
for (const check of checks) {
  try {
    await check.run();
    console.log(`  ok    ${check.name}`);
  } catch (err) {
    if (err instanceof TransientError) {
      warnings.push(check.name);
      console.warn(`  warn  ${check.name}: ${err.message} (transient — not blocking)`);
    } else {
      failures.push(check.name);
      console.error(`  FAIL  ${check.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  await delay(SPACING_MS);
}

if (warnings.length) {
  console.warn(
    `\n${warnings.length}/${checks.length} checks had transient upstream issues (not blocking).`,
  );
}
if (failures.length) {
  console.error(`\n${failures.length}/${checks.length} API checks failed (contract drift).`);
  process.exit(1);
}
console.log(
  `\nContract checks passed (${checks.length - warnings.length}/${checks.length} reachable).`,
);
