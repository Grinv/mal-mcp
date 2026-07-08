// Interactive MAL login tools. mal-mcp is a public PKCE client (no client
// secret): the user registers a MAL app (type "other") with the localhost
// Redirect URI, sets MAL_CLIENT_ID, then runs `login_mal` once. The server runs
// the OAuth dance and stores the token; `submit_mal_redirect` completes it when
// the browser is on another machine (SSH/remote/headless) and the localhost
// callback can't be reached.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MalClient } from "../clients/mal.js";
import { jsonResult } from "../lib/result.js";
import { guard } from "./guard.js";

export function registerLoginTools(server: McpServer, mal: MalClient): void {
  server.registerTool(
    "login_mal",
    {
      title: "Log in to MyAnimeList",
      description:
        "Authorize the personal-list tools with your MyAnimeList account (one-time). " +
        "Prerequisite: register a MAL API app of type 'other' at " +
        "https://myanimelist.net/apiconfig with Redirect URI set to this server's " +
        "localhost callback, and set MAL_CLIENT_ID in the server env. Calling this returns " +
        "an authorization URL: open it, log in, and click Allow. If your browser is on the " +
        "same machine as the server, login completes automatically; if it's remote (SSH/" +
        "headless), copy the URL you land on and pass it to submit_mal_redirect.",
      inputSchema: {},
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    () =>
      guard(async () => {
        const { authorizeUrl, redirectUri, listening } = await mal.startLogin();
        return jsonResult({
          authorize_url: authorizeUrl,
          redirect_uri: redirectUri,
          auto_capture: listening,
          instructions: listening
            ? "Open authorize_url, log in and click Allow. Login then completes automatically — " +
              "call get_my_user_info to confirm. If the browser is on a different machine than " +
              "this server, instead copy the URL it redirects you to and pass it to submit_mal_redirect."
            : "Open authorize_url, log in and click Allow, then copy the full URL your browser is " +
              "redirected to (it contains ?code=...) and pass it to submit_mal_redirect. " +
              `(The local auto-capture on ${redirectUri} was unavailable — likely the port is busy.)`,
        });
      }),
  );

  server.registerTool(
    "submit_mal_redirect",
    {
      title: "Finish MyAnimeList login",
      description:
        "Complete a login started with login_mal by submitting the URL your browser was " +
        "redirected to after clicking Allow (the one containing ?code=...). Use this when " +
        "login didn't complete automatically — e.g. the server runs on a remote/headless host. " +
        "A bare code string is also accepted.",
      inputSchema: {
        redirect_url: z
          .string()
          .min(1)
          .describe("The full redirected URL (contains ?code=...), or just the code value."),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    ({ redirect_url }) =>
      guard(async () => {
        await mal.submitRedirect(redirect_url);
        const info = (await mal.getMyUserInfo()) as { name?: unknown };
        return jsonResult({
          logged_in: true,
          user: typeof info.name === "string" ? info.name : undefined,
          message: "MyAnimeList login complete. The token is stored and refreshes automatically.",
        });
      }),
  );
}
