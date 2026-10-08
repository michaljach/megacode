import { COMPACT_AT, compactHistory } from "./compaction.ts";
import { closeOpenToolCalls, dropImages, type Message, type ToolCall, type ToolMessage, type ToolResult } from "./conversation.ts";
import { ContextOverflowError, type ModelResolver, type Provider, type StopReason, type TurnRequest, type TurnResult, type Usage } from "./provider.ts";
import type { Settings } from "./settings.ts";
import { canSuggest, suggestNextPrompt } from "./suggestion.ts";
import type { ExecutionResult, ToolContext, ToolSource } from "./tools.ts";
import { isHttpErrorLike } from "../adapters/providers/shared.ts";

export type NoticeLevel = "info" | "warn" | "error";

export type ModelTiming = {
  /** One-based step within this send; includes retries inside the provider/turn. */
  step: number;
  durationMs: number;
  /** First nonempty visible text, not first network byte or reasoning token. */
  firstTextMs: number | null;
  status: "completed" | "error" | "aborted";
  usage?: Usage;
  responseModel?: string;
};

/** How the agent reaches the user: interaction for tools, plus progress callbacks. */
export type AgentEvents = Pick<ToolContext, "approve" | "askQuestions"> & {
  onText(delta: string): void;
  /** One model response finished (it may be followed by tool calls). */
  onStepEnd(): void;
  onModelTiming?(timing: ModelTiming): void;
  onToolStart(call: ToolCall): void;
  onToolEnd(call: ToolCall, result: ExecutionResult): void;
  onNotice(text: string, level: NoticeLevel): void;
};

/** Everything the agent needs from the outside world; wired up in the composition root. */
export type AgentDeps = {
  resolveModel: ModelResolver;
  tools: ToolSource;
  /** Rebuilt at the start of every send, so new skills, settings and the working directory apply to the next turn. */
  systemPrompt: () => Promise<string>;
  settings: () => Pick<Settings, "maxSteps" | "effort">;
};

/** How full the context window is: the last request plus its reply, and the window when the provider reports it. */
export type ContextUsage = { tokens: number; window: number | null };

/** What one send works with: the resolved model, its context window, and how to reach the user. */
type SendContext = { provider: Provider; model: string; contextWindow: number | null; signal: AbortSignal; ev: AgentEvents };

const INTERRUPTED = "Interrupted by user.";
const IMAGE_REJECTED = "Image not sent: the model rejected it.";

/** The agent loop: model turn → run requested tools → repeat until the model stops. */
export class Agent {
  messages: Message[] = [];
  usage: Usage = { input: 0, output: 0 };
  readonly #deps: AgentDeps;
  #model: string;
  /** Tokens in the last request plus its reply, roughly the history's size; null until a response reports usage. */
  #contextTokens: number | null = null;
  #contextWindow: number | null = null;
  #speed: number | null = null;

  constructor(model: string, deps: AgentDeps) {
    deps.resolveModel(model); // validate early
    this.#deps = deps;
    this.#model = model;
  }

  get model() {
    return this.#model;
  }

  /** Output tokens per second of the last model response, counting from the request; null until one reports usage. */
  get speed(): number | null {
    return this.#speed;
  }

  get context(): ContextUsage | null {
    return this.#contextTokens === null ? null : { tokens: this.#contextTokens, window: this.#contextWindow };
  }

  setModel(spec: string) {
    this.#deps.resolveModel(spec);
    this.#model = spec;
  }

  clear() {
    this.messages = [];
    this.usage = { input: 0, output: 0 };
    this.#contextTokens = null;
    this.#speed = null;
  }

  async send(text: string, signal: AbortSignal, ev: AgentEvents): Promise<void> {
    // Pick up installed skills and project context between turns, never mid-turn.
    const system = await this.#deps.systemPrompt();
    const { provider, model } = this.#deps.resolveModel(this.#model);
    const { maxSteps, effort } = this.#deps.settings();
    const { tools } = this.#deps;
    const ctx: SendContext = { provider, model, contextWindow: (await provider.contextWindow?.(model)) ?? null, signal, ev };
    this.#contextWindow = ctx.contextWindow;
    // Compacting before the new message keeps it verbatim.
    if (this.#nearLimit(ctx)) await this.#compact(ctx, false);
    this.messages.push({ role: "user", text });

    try {
      for (let step = 0; step < maxSteps; step++) {
        if (step > 0 && this.#nearLimit(ctx)) await this.#compact(ctx, true);
        const started = performance.now();
        let firstTextMs: number | null = null;
        let res: TurnResult | undefined;
        try {
          res = await this.#turn(ctx, {
            model,
            effort,
            system: [system, tools.instructions?.()].filter(Boolean).join("\n\n"),
            messages: this.messages,
            tools: tools.specs(),
            signal,
            onText: text => {
              if (text && firstTextMs === null) firstTextMs = performance.now() - started;
              ev.onText(text);
            },
          });
        } finally {
          ev.onModelTiming?.({
            step: step + 1, durationMs: performance.now() - started, firstTextMs,
            status: res ? "completed" : signal.aborted ? "aborted" : "error",
            usage: res?.usage,
            responseModel: res?.responseModel,
          });
        }
        this.#addUsage(res.usage);
        this.#contextTokens = res.usage ? res.usage.input + res.usage.output : null;
        this.#speed = res.usage?.output ? res.usage.output / ((performance.now() - started) / 1000) : null;
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

  /**
   * One model request, retried once after fixing what a rejection points at. A history that no longer fits the context
   * window is compacted. Providers reject images they can't take (a model without vision, an unsupported file); left in
   * history, the image would fail every later request too, so on a 400 images are dropped. (A 400 for another reason
   * just costs the images and one extra request before it surfaces.)
   */
  async #turn(ctx: SendContext, req: TurnRequest): Promise<TurnResult> {
    try {
      return await ctx.provider.turn(req);
    } catch (e) {
      if (req.signal.aborted) throw e;
      if (e instanceof ContextOverflowError) {
        await this.#compact(ctx, true);
        return ctx.provider.turn({ ...req, messages: this.messages }).catch((again: unknown) => {
          if (!(again instanceof ContextOverflowError)) throw again;
          throw new ContextOverflowError("The conversation is still too long for the model after compacting. Run /clear to start over.");
        });
      }
      if (!isHttpErrorLike(e) || e.status !== 400 || !dropImages(this.messages, IMAGE_REJECTED)) throw e;
      ctx.ev.onNotice("The model rejected an image, so it was removed from the conversation.", "warn");
      return ctx.provider.turn({ ...req, messages: this.messages });
    }
  }

  #nearLimit({ contextWindow }: SendContext): boolean {
    return contextWindow !== null && this.#contextTokens !== null && this.#contextTokens >= contextWindow * COMPACT_AT;
  }

  /** Replaces the history with the model's summary of it. `continuing`: mid-turn, so the model carries on after. */
  async #compact(ctx: SendContext, continuing: boolean) {
    const count = this.messages.length;
    ctx.ev.onNotice("Compacting the conversation to fit the model's context window…", "info");
    const { model, contextWindow, signal } = ctx;
    const { messages, usage } = await compactHistory(ctx.provider, { model, contextWindow, signal, messages: this.messages, continuing });
    this.#addUsage(usage);
    this.messages = messages;
    this.#contextTokens = null;
    ctx.ev.onNotice(`Conversation compacted: ${count} message${count === 1 ? "" : "s"} summarized.`, "info");
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
