// Shared HttpClient construction. `malApiHttpClient` covers the official MAL API
// (`config.malBaseUrl`): both `MalClient` (OAuth, personal-list reads/writes) and
// `OfficialReadsClient` (Client-ID-only public reads) talk to the same base URL with the
// same timeout/retry config — this keeps their construction in sync instead of duplicating
// the options object in both files. `withThrottle`, below, is API-agnostic and is also used
// by `JikanClient` (the unofficial Jikan API, not `config.malBaseUrl`).
import { HttpClient, type HttpClientOptions } from "../lib/http.js";
import { RateLimiter, type RateRule } from "../lib/rateLimit.js";
import type { Logger } from "../lib/logger.js";
import type { Config } from "../config.js";

export function malApiHttpClient(
  config: Config,
  logger: Logger,
  extra?: Partial<HttpClientOptions>,
): HttpClient {
  return new HttpClient({
    baseUrl: config.malBaseUrl,
    logger,
    timeoutMs: config.httpTimeoutMs,
    retries: config.httpRetries,
    ...extra,
  });
}

/** `HttpClientOptions.beforeRequest` wired to a fresh `RateLimiter` — the two-line
 *  "own a limiter, throttle through its `acquire()`" idiom every rate-limited client
 *  (JikanClient, OfficialReadsClient) otherwise repeats. Spread into an HttpClient(Options)
 *  literal: `{ ...withThrottle(minIntervalMs, rules) }`. `MalClient` deliberately omits this —
 *  see the comment at its `#http` construction. */
export function withThrottle(
  minIntervalMs: number,
  rules: RateRule[] = [],
): Pick<HttpClientOptions, "beforeRequest"> {
  const limiter = new RateLimiter(minIntervalMs, rules);
  return { beforeRequest: () => limiter.acquire() };
}
