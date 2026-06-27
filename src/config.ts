// Loads and validates configuration from environment variables. Every secret
// is optional: the server always starts (so clients can list tools); the
// personal-list tools report a clear error at call time when unconfigured.
import { z } from "zod";
import type { LogLevel } from "./lib/logger.js";

const EnvSchema = z.object({
  MAL_ACCESS_TOKEN: z.string().min(1).optional(),
  MAL_CLIENT_ID: z.string().min(1).optional(),
  MAL_CLIENT_SECRET: z.string().min(1).optional(),
  MAL_REFRESH_TOKEN: z.string().min(1).optional(),
  /** Override the on-disk token store path (defaults under the OS config dir). */
  MAL_TOKEN_STORE: z.string().min(1).optional(),

  JIKAN_BASE_URL: z.string().url().default("https://api.jikan.moe/v4"),
  MAL_BASE_URL: z.string().url().default("https://api.myanimelist.net/v2"),
  MAL_OAUTH_BASE_URL: z.string().url().default("https://myanimelist.net/v1/oauth2"),

  HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  HTTP_RETRIES: z.coerce.number().int().nonnegative().default(2),
  JIKAN_MIN_INTERVAL_MS: z.coerce.number().int().nonnegative().default(400),
  CACHE_TTL_MS: z.coerce.number().int().nonnegative().default(300_000),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"]).default("info"),
});

export interface MalAuth {
  accessToken: string | undefined;
  clientId: string | undefined;
  clientSecret: string | undefined;
  refreshToken: string | undefined;
  tokenStorePath: string | undefined;
  /** Has client credentials + a refresh token → can silently refresh. */
  canRefresh: boolean;
  /** Has an access token or can refresh → personal-list tools are usable. */
  configured: boolean;
}

export interface Config {
  jikanBaseUrl: string;
  malBaseUrl: string;
  malOauthBaseUrl: string;
  httpTimeoutMs: number;
  httpRetries: number;
  jikanMinIntervalMs: number;
  cacheTtlMs: number;
  logLevel: LogLevel;
  auth: MalAuth;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Drop empty-string values so defaults apply and optional secrets stay unset.
  // .mcpb passes unconfigured user_config fields as "", which would otherwise
  // fail the min(1) validation and crash startup.
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined && v !== ""),
  );
  const parsed = EnvSchema.parse(cleaned);

  const canRefresh = Boolean(
    parsed.MAL_CLIENT_ID && parsed.MAL_CLIENT_SECRET && parsed.MAL_REFRESH_TOKEN,
  );
  const configured = canRefresh || Boolean(parsed.MAL_ACCESS_TOKEN);

  return {
    jikanBaseUrl: parsed.JIKAN_BASE_URL,
    malBaseUrl: parsed.MAL_BASE_URL,
    malOauthBaseUrl: parsed.MAL_OAUTH_BASE_URL,
    httpTimeoutMs: parsed.HTTP_TIMEOUT_MS,
    httpRetries: parsed.HTTP_RETRIES,
    jikanMinIntervalMs: parsed.JIKAN_MIN_INTERVAL_MS,
    cacheTtlMs: parsed.CACHE_TTL_MS,
    logLevel: parsed.LOG_LEVEL,
    auth: {
      accessToken: parsed.MAL_ACCESS_TOKEN,
      clientId: parsed.MAL_CLIENT_ID,
      clientSecret: parsed.MAL_CLIENT_SECRET,
      refreshToken: parsed.MAL_REFRESH_TOKEN,
      tokenStorePath: parsed.MAL_TOKEN_STORE,
      canRefresh,
      configured,
    },
  };
}
