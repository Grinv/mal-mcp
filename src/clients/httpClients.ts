// Shared HttpClient construction for the official MAL API (`config.malBaseUrl`). Both
// `MalClient` (OAuth, personal-list reads/writes) and `OfficialReadsClient` (Client-ID-only
// public reads) talk to the same base URL with the same timeout/retry config — this keeps
// their construction in sync instead of duplicating the options object in both files.
import { HttpClient, type HttpClientOptions } from "../lib/http.js";
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
