// Reusable MCP prompts. They orchestrate the read tools so a client can offer
// one-click flows without the user having to chain tool calls manually.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "recommend_similar",
    {
      title: "Recommend similar anime",
      description: "Suggest anime similar to a given title, with reasons.",
      argsSchema: { title: z.string().describe("An anime title to base recommendations on.") },
    },
    ({ title }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Recommend anime similar to "${title}".\n` +
              "Steps: call search_anime to resolve its mal_id, then get_anime_recommendations, " +
              "and optionally get_anime for the top picks. Present 5-8 recommendations with a one-line " +
              "reason each, noting score and genres.",
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
}
