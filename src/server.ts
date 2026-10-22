import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { McpServer } from "@modelcontextprotocol/server";

// Server construction and stdio startup. Kept separate from the bin entry
// (index.ts) so tests can import buildServer without triggering startup.
import { loadConfig, type Config } from "./config.ts";
import { createLogger, type Logger } from "./lib/logger.ts";
import { TokenStore, defaultTokenStorePath } from "./lib/tokenStore.ts";
import { TenraiClient } from "./clients/tenrai.ts";
import { MalClient } from "./clients/mal.ts";
import { OfficialReadsClient } from "./clients/officialReads.ts";
import { registerReadTools } from "./tools/read.ts";
import { registerMyListTools } from "./tools/mylist.ts";
import { registerLoginTools } from "./tools/login.ts";
import { registerPrompts } from "./prompts.ts";
import { VERSION } from "./version.ts";

// Our tool/prompt catalog is fixed for the lifetime of a running process (no
// dynamic registration) and isn't user-specific, so a 2026-07-28 client is
// free to cache these operations' results publicly for a while. We have no
// MCP Resources, so `resources/*` isn't given a hint here. `server/discover`
// shares the tool/prompt list's TTL since it's the same "what does this
// server offer" catalog answer. Ignored entirely by 2025-era connections.
export const CACHE_HINT = { ttlMs: 60 * 60 * 1000, cacheScope: "public" } as const;

const INSTRUCTIONS = [
  "MyAnimeList tools. Reads (search/details/rankings/seasons/characters/reviews) are served via",
  "the Tenrai API (a free, unofficial MyAnimeList mirror) and need no",
  "credentials. Personal-list tools (get_my_*, update_my_*, delete_my_*) act on the authenticated",
  "user's own MAL list and require a user token; without one they return an actionable error.",
  "Resolve a title to its mal_id with search_anime/search_manga before calling id-based tools. To",
  "filter a search by genre, first call get_anime_genres/get_manga_genres to get the numeric IDs",
  "the `genres` parameter expects. NSFW results are NOT filtered by default; pass sfw=true to",
  "exclude adult entries.",
].join(" ");

/** Construct a fully-registered MCP server. Shared by start() and tests. */
export function buildServer(config: Config, logger: Logger): McpServer {
  const tokenStore = new TokenStore(config.auth.tokenStorePath ?? defaultTokenStorePath(), logger);

  const mal = new MalClient(config, logger, tokenStore);
  // Checked against the live token store (via isConfigured), not env vars alone, so a user
  // who already ran login_mal sees the accurate state at startup.
  logger.info(
    `personal-list tools ${mal.isConfigured() ? "enabled" : "not yet authorized — run login_mal"}`,
  );
  // OfficialReadsClient is the fallback for read tools when Tenrai (the primary read backend,
  // itself a beta service) fails; it structurally satisfies ReadFallback, needs only a Client ID
  // (no user token), and is kept separate from MalClient's OAuth/personal-list concern.
  const officialReads = new OfficialReadsClient(config, logger);
  const tenrai = new TenraiClient(config, logger, officialReads);

  const server = new McpServer(
    { name: "mal-mcp", title: "MAL MCP Server", version: VERSION },
    {
      instructions: INSTRUCTIONS,
      cacheHints: {
        "tools/list": CACHE_HINT,
        "prompts/list": CACHE_HINT,
        "server/discover": CACHE_HINT,
      },
    },
  );

  registerReadTools(server, tenrai);
  registerMyListTools(server, mal);
  registerLoginTools(server, mal);
  registerPrompts(server, tenrai);
  return server;
}

/** Load config, build the server, and serve over stdio until terminated.
 *  MCP protocol revision 2026-07-28 deprecated server→client log notifications
 *  in favor of stderr (SEP-2577) — the host process already reads a spawned
 *  stdio server's stderr, so this logger's stderr output is the only channel. */
export async function start(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const handle = serveStdio(() => buildServer(config, logger));
  logger.info(`mal-mcp ${VERSION} ready`);

  const shutdown = (signal: string): void => {
    logger.info(`received ${signal}, shutting down`);
    void handle.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => logger.error("unhandled rejection", reason));
  process.on("uncaughtException", (err) => {
    logger.error("uncaught exception", err);
    process.exit(1);
  });
}
