import type { ImageContent, ToolSpec } from "../types.ts";
import type { AskQuestions } from "./questions.ts";

/** Ask the user before a side effect. `body` may contain ANSI colors (e.g. a diff). */
export type Approve = (req: { tool: string; title: string; body: string }) => Promise<boolean>;
export type Ctx = { approve: Approve; signal?: AbortSignal; askQuestions?: AskQuestions };

export type ExecutionResult = { output: string; isError: boolean; images?: ImageContent[]; changePreview?: string };
export type Tool = ToolSpec & { run: (input: any, ctx: Ctx) => Promise<string | ExecutionResult> };
