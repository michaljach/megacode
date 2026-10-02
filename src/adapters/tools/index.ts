import type { Tool, ToolSource } from "../../core/tools.ts";
import { editFile, listFiles, readFileTool, writeFileTool } from "./files.ts";
import { viewImage } from "./image.ts";
import { askQuestions } from "./questions.ts";
import { bash, grep } from "./shell.ts";
import { validateArguments } from "./validation.ts";

const TOOLS: Tool[] = [askQuestions, viewImage, readFileTool, writeFileTool, editFile, bash, listFiles, grep];
const byName = new Map(TOOLS.map((t) => [t.name, t]));

/** The tools megacode ships with. Failures come back as error results, never as exceptions. */
export const builtinTools: ToolSource = {
  specs: () => TOOLS.map(({ name, description, parameters }) => ({ name, description, parameters })),
  has: (name) => byName.has(name),
  async execute(call, ctx) {
    const tool = byName.get(call.name);
    if (!tool) return { output: `Unknown tool: ${call.name}`, isError: true };
    try {
      const input = validateArguments(call.input, tool.parameters);
      ctx.signal?.throwIfAborted();
      const result = await tool.run(input, ctx);
      return typeof result === "string" ? { output: result, isError: false } : result;
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, isError: true };
    }
  },
};
