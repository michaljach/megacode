import type { ImageContent, ToolCall } from "./conversation.ts";

export type ToolSpec = {
  name: string;
  description: string;
  parameters: { type: "object"; properties: Record<string, unknown>; required?: string[] };
};

/** A proposed file edit; the UI renders it as a diff. */
export type FileChange = { file: string; before: string; after: string };

export type ApprovalRequest = { tool: string; title: string; body?: string; change?: FileChange };
/** Asks the user before a side effect. Resolves true to proceed. */
export type Approve = (req: ApprovalRequest) => Promise<boolean>;

export type Question = { question: string; options?: string[] };
export type Answer = { question: string; answer: string };
/** Shows an interactive questionnaire. Resolves null when the user cancels. */
export type AskQuestions = (questions: Question[], signal?: AbortSignal) => Promise<Answer[] | null>;

/** What a tool may use from the session: user interaction and cancellation. */
export type ToolContext = { approve: Approve; signal?: AbortSignal; askQuestions?: AskQuestions };

export type ExecutionResult = {
  output: string;
  isError: boolean;
  images?: ImageContent[];
  /** Display-only: the applied edit. Never sent to the model. */
  change?: FileChange;
};

/** A single tool. `run` receives arguments already validated against `parameters`. */
export type Tool<Input = Record<string, unknown>> = ToolSpec & {
  run(input: Input, ctx: ToolContext): Promise<string | ExecutionResult>;
};

/** Port for anything that offers tools to the agent: built-ins, MCP servers, … */
export interface ToolSource {
  specs(): ToolSpec[];
  has(name: string): boolean;
  execute(call: ToolCall, ctx: ToolContext): Promise<ExecutionResult>;
  /** Extra system-prompt text that comes with these tools. */
  instructions?(): string;
}

/** One ToolSource over several; earlier sources win name clashes. */
export function combineToolSources(...sources: ToolSource[]): ToolSource {
  const owner = (name: string) => sources.find((s) => s.has(name));
  return {
    specs: () => sources.flatMap((s) => s.specs()),
    has: (name) => !!owner(name),
    execute: async (call, ctx) => owner(call.name)?.execute(call, ctx) ?? { output: `Unknown tool: ${call.name}`, isError: true },
    instructions: () => sources.map((s) => s.instructions?.() ?? "").filter(Boolean).join("\n\n"),
  };
}
