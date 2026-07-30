// Pre-deploy health check for the upstream APIs this server depends on.
//
// Distinguishes two failure classes:
//   - CONTRACT drift (404, unexpected status, wrong response shape) → FAIL the
//     release: the API changed and our integration is likely broken.
//   - TRANSIENT outage (5xx / 429 / timeout / network) → WARN only: the upstream
//     is momentarily down; that is no reason to block shipping our own code.
//
// Run: `npm run check:api`. Requests are spaced to respect Tenrai's rate limit.

const TENRAI = process.env.TENRAI_BASE_URL ?? "https://api.tenrai.org/v1";
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
const tenrai = (name, path, assertFn) =>
  checks.push({
    name,
    run: async () => {
      const res = await fetchResilient(`${TENRAI}${path}`);
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

tenrai("anime search", "/anime?q=frieren&limit=1", hasArray);
tenrai("anime details", "/anime/52991/full", hasData);
tenrai("anime characters", "/anime/52991/characters", hasArray);
tenrai("anime recommendations", "/anime/52991/recommendations", hasArray);
tenrai("anime reviews", "/anime/52991/reviews?limit=1", hasArray);
tenrai("anime episodes", "/anime/52991/episodes", hasArray);
tenrai("anime genres", "/genres/anime", hasArray);
tenrai("top anime", "/top/anime?limit=1", hasArray);
tenrai("seasonal (now)", "/seasons/now?limit=1", hasArray);
tenrai("schedule", "/schedules?filter=monday&limit=1", hasArray);
tenrai("manga search", "/manga?q=berserk&limit=1", hasArray);
tenrai("manga details", "/manga/2/full", hasData);
tenrai("manga characters", "/manga/2/characters", hasArray);
tenrai("manga recommendations", "/manga/2/recommendations", hasArray);
tenrai("manga reviews", "/manga/2/reviews?limit=1", hasArray);
tenrai("manga genres", "/genres/manga", hasArray);
tenrai("character details", "/characters/1/full", hasData);
tenrai("character search", "/characters?q=spike&limit=1", hasArray);
tenrai("person details", "/people/1/full", hasData);
tenrai("anime staff", "/anime/52991/staff", hasArray);
tenrai("anime statistics", "/anime/52991/statistics", hasData);
tenrai("random anime", "/random/anime", hasData);
tenrai("upcoming season", "/seasons/upcoming?limit=1", hasArray);
tenrai("producers", "/producers?limit=1", hasArray);
tenrai("top people", "/top/people?limit=1", hasArray);
tenrai("top characters", "/top/characters?limit=1", hasArray);
tenrai("seasons list", "/seasons", hasArray);
tenrai("random character", "/random/characters", hasData);
tenrai("anime news", "/anime/52991/news", hasArray);

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
