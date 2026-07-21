// Shared test helpers. Not a test file (no *.test suffix) so the runner skips it.
import type { TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createLogger, type Logger } from "../lib/logger.js";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";

export function silentLogger(): Logger {
  return createLogger("silent");
}

export function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

type FetchArgs = Parameters<typeof fetch>;

export interface FetchMock {
  fn: typeof fetch;
  calls: { url: string; init: FetchArgs[1] }[];
}

/** Build a fetch mock from a handler, recording every call. */
export function mockFetch(
  handler: (url: string, init: FetchArgs[1]) => Response | Promise<Response>,
): FetchMock {
  const calls: FetchMock["calls"] = [];
  const fn = (async (input: FetchArgs[0], init?: FetchArgs[1]) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as { url: string }).url;
    calls.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

/** Install a fetch mock via the test's built-in mock tracker (auto-restores when the test ends). */
export function installFetch(t: TestContext, mock: FetchMock): void {
  t.mock.method(globalThis, "fetch", mock.fn);
}

/** A single MCP content block's text (empty string if it's not a text block or is missing). */
function contentText(item: { type?: string; text?: string } | undefined): string {
  return item?.text ?? "";
}

/** Extract a tool-call result's first content block's text (empty string if absent). */
export function toolText(res: unknown): string {
  const content = (res as { content?: unknown } | undefined)?.content;
  return contentText((content as { type: string; text?: string }[] | undefined)?.[0]);
}

/** Extract a getPrompt() result's first message's content text (empty string if absent). */
export function promptText(res: unknown): string {
  const messages = (res as { messages?: unknown } | undefined)?.messages;
  const first = (messages as { content?: unknown }[] | undefined)?.[0];
  return contentText(first?.content as { type?: string; text?: string } | undefined);
}

/** Build the server and connect an in-memory client for end-to-end tool tests.
 *  Defaults MAL_TOKEN_STORE to a fresh, nonexistent per-call path (unless `env`
 *  overrides it) — without this, buildServer()'s defaultTokenStorePath() falls
 *  back to the real `~/.config/mal-mcp/tokens.json`, so a maintainer who has
 *  actually run login_mal on their own machine would have every "no token
 *  configured" test see their real, valid token instead of a clean slate. */
export async function connectServer(
  env: NodeJS.ProcessEnv = {},
): Promise<{ client: Client; close: () => Promise<void> }> {
  const isolatedEnv = {
    MAL_TOKEN_STORE: join(tmpdir(), `mal-mcp-test-${randomUUID()}.json`),
    ...env,
  };
  const server = buildServer(loadConfig(isolatedEnv), silentLogger());
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  // Prime the client's tools/list cache: callTool() only validates a result's
  // structuredContent against the tool's outputSchema when this cache is
  // already populated, so every callTool() in the suite doubles as an
  // outputSchema conformance check instead of silently skipping validation.
  await client.listTools();
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
