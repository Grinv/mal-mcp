// Server construction and stdio startup. Kept separate from the bin entry
// (index.ts) so tests can import buildServer without triggering startup.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, type Config } from "./config.js";
import { createLogger, type Logger, type LogLevel, type LogSink } from "./lib/logger.js";
import { TokenStore, defaultTokenStorePath } from "./lib/tokenStore.js";
import { JikanClient } from "./clients/jikan.js";
import { MalClient } from "./clients/mal.js";
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

  const jikan = new JikanClient(config, logger);
  const mal = new MalClient(config, logger, tokenStore);

  const server = new McpServer(
    { name: "mal-mcp", version: VERSION },
    // Declare the logging capability so the SDK registers `logging/setLevel`
    // and lets us push `notifications/message` to the client (see start()).
    { capabilities: { logging: {} }, instructions: INSTRUCTIONS },
  );

  registerReadTools(server, jikan);
  registerMyListTools(server, mal);
  registerLoginTools(server, mal);
  registerPrompts(server);
  return server;
}

// Internal levels → MCP (syslog-style) levels for notifications/message.
const MCP_LOG_LEVELS = {
  debug: "debug",
  info: "info",
  warn: "warning",
  error: "error",
} as const satisfies Record<Exclude<LogLevel, "silent">, string>;

/** A {@link LogSink} that mirrors each log line onto the MCP client as a
 *  `notifications/message`. Best-effort: sends are dropped silently when there
 *  is no transport yet, when the client filtered the level via `logging/setLevel`,
 *  or after disconnect — logging must never break the server. */
export function mcpLoggingSink(server: McpServer): LogSink {
  return (level, message) => {
    void server.server
      .sendLoggingMessage({
        level: MCP_LOG_LEVELS[level],
        logger: "mal-mcp",
        data: message,
      })
      .catch(() => {});
  };
}

/** Mirror logs to the client, but ONLY after the initialize handshake completes.
 *  Sending a `notifications/message` before `initialized` violates the MCP
 *  lifecycle, and strict clients (e.g. Claude Desktop) drop the connection — so
 *  `ref.sink` stays unset (stderr-only) until then. Pass the same holder the
 *  logger reads from. */
export function activateClientLoggingOnInitialize(
  server: McpServer,
  ref: { sink?: LogSink },
): void {
  const priorOnInitialized = server.server.oninitialized;
  server.server.oninitialized = () => {
    priorOnInitialized?.();
    ref.sink = mcpLoggingSink(server);
  };
}

/** Load config, build the server, and serve over stdio until terminated. */
export async function start(): Promise<void> {
  const config = loadConfig();

  // Forward-ref via a holder: the logger is needed to build the server, but the
  // sink needs the server, so we fill it in once the server exists — and only
  // once the client has initialized (see activateClientLoggingOnInitialize).
  const ref: { sink?: LogSink } = {};
  const logger = createLogger(config.logLevel, (level, message) => ref.sink?.(level, message));
  const server = buildServer(config, logger);
  activateClientLoggingOnInitialize(server, ref);

  await server.connect(new StdioServerTransport());
  logger.info(
    `mal-mcp ${VERSION} ready (personal-list tools ${
      config.auth.configured ? "enabled" : "not yet authorized — run login_mal"
    })`,
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
