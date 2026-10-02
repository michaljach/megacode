// Composition root: the one place that wires adapters into the core.
import { loadSettings } from "./adapters/settings.ts";
import { mcp } from "./adapters/mcp/manager.ts";
import { readProjectContext } from "./adapters/project.ts";
import { resolveModel } from "./adapters/providers/registry.ts";
import { builtinTools } from "./adapters/tools/index.ts";
import { Agent } from "./core/agent.ts";
import { buildSystemPrompt } from "./core/prompts.ts";
import { combineToolSources } from "./core/tools.ts";

/** An agent using the configured providers, built-in tools and MCP servers. Throws for an invalid model spec. */
export function createAgent(model: string): Agent {
  return new Agent(model, {
    resolveModel,
    tools: combineToolSources(builtinTools, mcp),
    systemPrompt: () => buildSystemPrompt(readProjectContext({ includeInstructions: loadSettings().projectInstructions })),
    settings: loadSettings,
  });
}
