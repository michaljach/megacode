import { closeOpenToolCalls, type Message, type ToolCall, type ToolMessage, type ToolResult } from "./conversation.ts";
import type { ModelResolver, TurnResult, Usage } from "./provider.ts";
import type { Settings } from "./settings.ts";
import { canSuggest, suggestNextPrompt } from "./suggestion.ts";
import type { ExecutionResult, ToolContext, ToolSource } from "./tools.ts";

export type NoticeLevel = "info" | "warn" | "error";

/** How the agent reaches the user: interaction for tools, plus progress callbacks. */
export type AgentEvents = Pick<ToolContext, "approve" | "askQuestions"> & {
  onText(delta: string): void;
  /** One model response finished (it may be followed by tool calls). */
  onStepEnd(): void;
  onToolStart(call: ToolCall): void;
  onToolEnd(call: ToolCall, result: ExecutionResult): void;
  onNotice(text: string, level: NoticeLevel): void;
};

/** Everything the agent needs from the outside world; wired up in the composition root. */
export type AgentDeps = {
  resolveModel: ModelResolver;
  tools: ToolSource;
  systemPrompt: () => string;
  settings: () => Pick<Settings, "maxSteps" | "effort">;
};

const INTERRUPTED = "Interrupted by user.";

/** The agent loop: model turn → run requested tools → repeat until the model stops. */
export class Agent {
  messages: Message[] = [];
  usage: Usage = { input: 0, output: 0 };
  readonly #deps: AgentDeps;
  #model: string;
  #system: string;

  constructor(model: string, deps: AgentDeps) {
    deps.resolveModel(model); // validate early
    this.#deps = deps;
    this.#model = model;
    this.#system = deps.systemPrompt();
  }

  get model() {
    return this.#model;
  }

  setModel(spec: string) {
    this.#deps.resolveModel(spec);
    this.#model = spec;
  }

  /** Rebuild the system prompt, e.g. after the working directory or project-instructions setting changes. */
  reloadSystemPrompt() {
    this.#system = this.#deps.systemPrompt();
  }

  clear() {
    this.messages = [];
    this.usage = { input: 0, output: 0 };
  }

  async send(text: string, signal: AbortSignal, ev: AgentEvents): Promise<void> {
    this.messages.push({ role: "user", text });
    const { provider, model } = this.#deps.resolveModel(this.#model);
    const { maxSteps, effort } = this.#deps.settings();
    const { tools } = this.#deps;

    try {
      for (let step = 0; step < maxSteps; step++) {
        const res = await provider.turn({
          model,
          effort,
          system: [this.#system, tools.instructions?.()].filter(Boolean).join("\n\n"),
          messages: this.messages,
          tools: tools.specs(),
          signal,
          onText: ev.onText,
        });
        this.#addUsage(res.usage);
        this.messages.push(res.message);
        ev.onStepEnd();
        if (this.#endsTurn(res, ev)) return;

        this.messages.push(await this.#runTools(res.message.toolCalls, signal, ev));
        if (signal.aborted) throw signal.reason;
      }
      ev.onNotice(`Stopped after ${maxSteps} steps (raise the limit in /config).`, "warn");
    } finally {
      closeOpenToolCalls(this.messages, INTERRUPTED);
    }
  }

  /** Next-prompt prediction; never appended to conversation history. */
  async suggestPrompt(signal: AbortSignal): Promise<string> {
    if (!canSuggest(this.messages)) return "";
    const { provider, model } = this.#deps.resolveModel(this.#model);
    const { text, usage } = await suggestNextPrompt(provider, model, this.messages, signal);
    if (signal.aborted) return "";
    this.#addUsage(usage);
    return text;
  }

  /** True when this response finishes the turn (reporting why, if it's unusual). */
  #endsTurn(res: TurnResult, ev: AgentEvents): boolean {
    switch (res.stop) {
      case "refusal":
        ev.onNotice("The model declined to respond.", "warn");
        return true;
      case "max_tokens":
        // A truncated tool call may have incomplete arguments; don't run it.
        closeOpenToolCalls(this.messages, "Output was truncated (max tokens); tool not run.");
        ev.onNotice("Output truncated: max tokens reached.", "warn");
        return true;
      default:
        return !res.message.toolCalls.length;
    }
  }

  async #runTools(calls: ToolCall[], signal: AbortSignal, ev: AgentEvents): Promise<ToolMessage> {
    const ctx: ToolContext = { approve: ev.approve, askQuestions: ev.askQuestions, signal };
    const results: ToolResult[] = [];
    for (const call of calls) {
      if (signal.aborted) break;
      ev.onToolStart(call);
      const r = await this.#deps.tools.execute(call, ctx);
      ev.onToolEnd(call, r);
      // Only what the model needs; display-only data such as `change` stays out of context.
      results.push({ id: call.id, name: call.name, output: r.output, isError: r.isError, images: r.images });
    }
    return { role: "tool", results };
  }

  #addUsage(usage: Usage | undefined) {
    if (!usage) return;
    this.usage.input += usage.input;
    this.usage.output += usage.output;
  }
}
