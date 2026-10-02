import type { PermissionMode } from "../config.ts";
import type { ToolCall, ToolSpec } from "../types.ts";
import { editFile, listFiles, readFileTool, viewImage, writeFileTool } from "./files.ts";
import { askQuestions, type AskQuestions } from "./questions.ts";
import { bash, grep } from "./shell.ts";
import type { Approve, ExecutionResult, Tool } from "./types.ts";

export type { Approve, ExecutionResult } from "./types.ts";

const tools: Tool[] = [askQuestions, viewImage, readFileTool, writeFileTool, editFile, bash, listFiles, grep];

export const toolSpecs: ToolSpec[] = tools.map(({ name, description, parameters }) => ({ name, description, parameters }));

/** Tools that "accept edits" mode runs without asking. */
export const EDIT_TOOLS = new Set(["write_file", "edit_file"]);

/** Whether the permission mode lets a tool run without asking the user. */
export const autoApproved = (mode: PermissionMode, tool: string) =>
  mode === "yolo" || (mode === "accept-edits" && EDIT_TOOLS.has(tool));

export async function executeTool(
  call: ToolCall,
  approve: Approve,
  signal?: AbortSignal,
  askQuestions?: AskQuestions,
): Promise<ExecutionResult> {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) return { output: `Unknown tool: ${call.name}`, isError: true };
  try {
    const input: unknown = call.input;
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("Tool arguments must be a JSON object.");
    if ("_invalid_json" in input) throw new Error("Tool arguments were not valid JSON.");
    const missing = (tool.parameters.required ?? []).filter((k) => !Object.hasOwn(input, k) || call.input[k] === undefined);
    if (missing.length) throw new Error(`Missing required arguments: ${missing.join(", ")}`);
    for (const [key, schema] of Object.entries(tool.parameters.properties)) {
      const value = call.input[key];
      if (value === undefined) continue;
      const { type } = schema as { type: string };
      if (type === "array" ? !Array.isArray(value) : typeof value !== type) throw new Error(`${key} must be a ${type}.`);
      if (type === "number" && (!Number.isSafeInteger(value) || (value as number) < (key === "timeout_ms" ? 0 : 1)))
        throw new Error(`${key} must be a ${key === "timeout_ms" ? "non-negative" : "positive"} safe integer.`);
    }
    signal?.throwIfAborted();
    const result = await tool.run(call.input, { approve, signal, askQuestions });
    return typeof result === "string" ? { output: result, isError: false } : result;
  } catch (e) {
    return { output: `Error: ${(e as Error).message}`, isError: true };
  }
}
