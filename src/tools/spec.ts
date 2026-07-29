// A tool as one named, independently addressable object — name/title/description/schemas/
// annotations/handler together — instead of a bare positional server.registerTool(name, config,
// handler) call. registerReadTools/registerMyListTools/registerLoginTools build an array of
// these and register each in a thin loop, so finding, reviewing, or programmatically iterating
// one tool (e.g. a future tool-description-check pass) doesn't require scanning the whole file.
// defineTool() is an identity function — it exists only so each call site's own inputSchema
// literal drives the generic, giving `handler` the exact same argument-type inference a plain
// server.registerTool() call already gets.
import type { z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/server";
import type { ToolResult } from "../lib/result.js";

export interface ToolSpec<In extends z.ZodType, Out extends z.ZodType> {
  name: string;
  title: string;
  description: string;
  inputSchema: In;
  outputSchema: Out;
  annotations: ToolAnnotations;
  handler: (args: z.infer<In>) => Promise<ToolResult> | ToolResult;
}

export function defineTool<In extends z.ZodType, Out extends z.ZodType>(
  spec: ToolSpec<In, Out>,
): ToolSpec<In, Out> {
  return spec;
}
