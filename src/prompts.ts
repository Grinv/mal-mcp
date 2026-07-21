// Reusable MCP prompts. They orchestrate the read tools so a client can offer
// one-click flows without the user having to chain tool calls manually.
import { z } from "zod";
import { completable, type McpServer } from "@modelcontextprotocol/server";
import type { JikanClient } from "./clients/jikan.js";

const COMPLETION_LIMIT = 8;

export function registerPrompts(server: McpServer, jikan: JikanClient): void {
  server.registerPrompt(
    "recommend_similar",
    {
      title: "Recommend similar anime",
      description:
        "Suggest anime similar to a given title, with reasons. title is optional — if omitted, " +
        "asks which title instead of failing.",
      argsSchema: {
        // Optional rather than required: not every MCP client elicits a missing
        // required prompt argument from the user (e.g. Claude Code doesn't — it
        // just fails the call), so a missing title is instead handled in the
        // prompt text below, universally across clients.
        title: completable(
          z
            .string()
            .describe(
              "An anime title to base recommendations on. Start typing for live title " +
                "suggestions. Omit to be asked which title you mean.",
            ),
          async (value) => {
            // Best-effort: a completion list is a nice-to-have, so a transient
            // upstream failure degrades to no suggestions instead of an error
            // surfacing in the client's live-typing UI.
            try {
              const r = await jikan.searchAnime({ q: value, limit: COMPLETION_LIMIT });
              const results = r.results as { title?: string }[] | undefined;
              return (results ?? [])
                .map((a) => a.title)
                .filter((t): t is string => Boolean(t))
                .slice(0, COMPLETION_LIMIT);
            } catch {
              return [];
            }
          },
        ).optional(),
      },
    },
    ({ title }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: title
              ? `Recommend anime similar to "${title}".\n` +
                "Steps: call search_anime to resolve its mal_id, then get_anime_recommendations, " +
                "then get_anime for each of the top picks to get its score and genres " +
                "(get_anime_recommendations doesn't include them). Present 5-8 recommendations " +
                "with a one-line reason each, noting score and genres."
              : "Ask me which anime I'm basing recommendations on before doing anything else — " +
                "I didn't say which one.",
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "seasonal_overview",
    {
      title: "Seasonal anime overview",
      description: "Summarize the notable anime of a given season (or the current one).",
      argsSchema: {
        season: z.enum(["winter", "spring", "summer", "fall"]).describe("Season name.").optional(),
        year: z
          .string()
          .regex(/^\d{4}$/)
          .describe("Four-digit year.")
          .optional(),
      },
    },
    ({ season, year }) => {
      const which = season && year ? `the ${season} ${year} season` : "the current season";
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text:
                `Give an overview of ${which} in anime.\n` +
                "Call get_seasonal_anime" +
                (season && year ? ` with year=${year} and season=${season}` : "") +
                ", then group the results into highlights (highest scored / most anticipated) and " +
                "notable genres. Keep it concise.",
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    "hidden_gems",
    {
      title: "Find hidden gems",
      description:
        "Surface highly-rated anime or manga that aren't widely known — high score, low popularity.",
      argsSchema: {
        kind: z
          .enum(["anime", "manga"])
          .describe("Look for anime or manga. Defaults to anime.")
          .optional(),
      },
    },
    ({ kind }) => {
      const which = kind ?? "anime";
      const topTool = which === "anime" ? "get_top_anime" : "get_top_manga";
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text:
                `Find hidden-gem ${which}: high score but not widely known.\n` +
                `Call ${topTool} with no filter (default all-time ranking) and limit=25, then pick the ` +
                "entries whose score is high but whose popularity rank / members count is much worse " +
                "than their score rank would suggest — those are the underseen ones. Present 5-8 picks " +
                "with title, score, and a one-line reason each noting why it's underrated.",
            },
          },
        ],
      };
    },
  );
}
