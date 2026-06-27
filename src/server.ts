// Server construction and stdio startup. Kept separate from the bin entry
// (index.ts) so tests can import buildServer without triggering startup.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, type Config } from "./config.js";
import { createLogger, type Logger } from "./lib/logger.js";
import { TokenStore, defaultTokenStorePath } from "./lib/tokenStore.js";
import { JikanClient } from "./clients/jikan.js";
import { MalClient } from "./clients/mal.js";
import { registerReadTools } from "./tools/read.js";
import { registerMyListTools } from "./tools/mylist.js";
import { registerPrompts } from "./prompts.js";
import { VERSION } from "./version.js";

const INSTRUCTIONS = [
  "MyAnimeList tools. Reads (search/details/rankings/seasons/characters/reviews/profiles) are",
  "served via the public Jikan API and need no credentials. Personal-list tools (get_my_*,",
  "update_my_*, delete_my_*) act on the authenticated user's own MAL list and require a user",
  "token; without one they return an actionable error. Resolve a title to its mal_id with",
  "search_anime/search_manga before calling id-based tools. NSFW results are NOT filtered by",
  "default; pass sfw=true to exclude adult entries.",
].join(" ");

/** Construct a fully-registered MCP server. Shared by start() and tests. */
export function buildServer(config: Config, logger: Logger): McpServer {
  const tokenStore = new TokenStore(config.auth.tokenStorePath ?? defaultTokenStorePath(), logger);

  const jikan = new JikanClient(config, logger);
  const mal = new MalClient(config, logger, tokenStore);

  const server = new McpServer(
    { name: "mal-mcp", version: VERSION },
    { instructions: INSTRUCTIONS },
  );

  registerReadTools(server, jikan);
  registerMyListTools(server, mal, config);
  registerPrompts(server);
  return server;
}

/** Load config, build the server, and serve over stdio until terminated. */
export async function start(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const server = buildServer(config, logger);

  await server.connect(new StdioServerTransport());
  logger.info(
    `mal-mcp ${VERSION} ready (personal-list tools ${config.auth.configured ? "enabled" : "disabled — no token"})`,
  );

  const shutdown = (signal: string): void => {
    logger.info(`received ${signal}, shutting down`);
    void server.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => logger.error("unhandled rejection", reason));
  process.on("uncaughtException", (err) => {
    logger.error("uncaught exception", err);
    process.exit(1);
  });
}
