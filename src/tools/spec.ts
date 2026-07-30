// A tool as one named, independently addressable object — name/title/description/schemas/
// annotations/handler together — instead of a bare positional server.registerTool(name, config,
// handler) call. registerReadTools/registerMyListTools/registerLoginTools build an array of
// these and register each in a thin loop, so finding, reviewing, or programmatically iterating
// one tool (e.g. a future tool-description-check pass) doesn't require scanning the whole file.
// defineTool() is an identity function — it exists only so each call site's own inputSchema
// literal drives the generic, giving `handler` the exact same argument-type inference a plain
// server.registerTool() call already gets.
import type { z } from "zod";
import type { McpServer, ToolAnnotations } from "@modelcontextprotocol/server";
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

/** Register every tool in `specs` on `server` — the one place that maps a ToolSpec onto the
 *  SDK's positional server.registerTool(name, config, handler) shape, shared by all three
 *  registerReadTools/registerMyListTools/registerLoginTools callers instead of each repeating
 *  its own copy of this loop. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- specs is a heterogeneous array of ToolSpec<In, Out> for many different In/Out; a shared existential type isn't expressible here, and the loop body only ever touches fields common to every ToolSpec.
export function registerTools(server: McpServer, specs: ToolSpec<any, any>[]): void {
  for (const tool of specs) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        annotations: tool.annotations,
      },
      tool.handler,
    );
  }
}
