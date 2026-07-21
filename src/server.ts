import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { McpServer } from "@modelcontextprotocol/server";

// Server construction and stdio startup. Kept separate from the bin entry
// (index.ts) so tests can import buildServer without triggering startup.
import { loadConfig, type Config } from "./config.js";
import { createLogger, type Logger } from "./lib/logger.js";
import { TokenStore, defaultTokenStorePath } from "./lib/tokenStore.js";
import { JikanClient } from "./clients/jikan.js";
import { MalClient } from "./clients/mal.js";
import { OfficialReadsClient } from "./clients/officialReads.js";
import { registerReadTools } from "./tools/read.js";
import { registerMyListTools } from "./tools/mylist.js";
import { registerLoginTools } from "./tools/login.js";
import { registerPrompts } from "./prompts.js";
import { VERSION } from "./version.js";

const INSTRUCTIONS = [
  "MyAnimeList tools. Reads (search/details/rankings/seasons/characters/reviews/profiles) are",
  "served via the public Jikan API and need no credentials. Personal-list tools (get_my_*,",
  "update_my_*, delete_my_*) act on the authenticated user's own MAL list and require a user",
  "token; without one they return an actionable error. Resolve a title to its mal_id with",
  "search_anime/search_manga before calling id-based tools. To filter a search by genre, first",
  "call get_anime_genres/get_manga_genres to get the numeric IDs the `genres` parameter expects.",
  "NSFW results are NOT filtered by default; pass sfw=true to exclude adult entries.",
].join(" ");

/** Construct a fully-registered MCP server. Shared by start() and tests. */
export function buildServer(config: Config, logger: Logger): McpServer {
  const tokenStore = new TokenStore(config.auth.tokenStorePath ?? defaultTokenStorePath(), logger);

  const mal = new MalClient(config, logger, tokenStore);
  // OfficialReadsClient is the fallback for read tools whose Jikan live pass-through
  // to MAL is degraded (search/top/seasonal — see notes/jikan-reliability.md); it
  // structurally satisfies JikanFallback, needs only a Client ID (no user token),
  // and is kept separate from MalClient's OAuth/personal-list concern.
  const officialReads = new OfficialReadsClient(config, logger);
  const jikan = new JikanClient(config, logger, officialReads);

  const server = new McpServer(
    { name: "mal-mcp", title: "MAL MCP Server", version: VERSION },
    { instructions: INSTRUCTIONS },
  );

  registerReadTools(server, jikan);
  registerMyListTools(server, mal);
  registerLoginTools(server, mal);
  registerPrompts(server, jikan);
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
  logger.info(
    `mal-mcp ${VERSION} ready (personal-list tools ${
      config.auth.configured ? "enabled" : "not yet authorized — run login_mal"
    })`,
  );

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
