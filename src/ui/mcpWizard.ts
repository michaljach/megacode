import { isHttpUrl, SERVER_NAME, splitCommand, type McpTransport } from "../adapters/mcp/config.ts";

// Steps and checks for the /mcp "Add server" wizard, kept apart from rendering so they can be tested.

export const ADD_STEPS = ["name", "type", "target", "extras"] as const;
export type AddStep = (typeof ADD_STEPS)[number];

/** The step before `step`, or null to leave the wizard. */
export const previousAddStep = (step: AddStep): AddStep | null => ADD_STEPS[ADD_STEPS.indexOf(step) - 1] ?? null;

export function serverNameError(name: string, existing: string[]): string | null {
  if (!SERVER_NAME.test(name)) return "Use letters, digits, - and _ (max 32).";
  if (existing.includes(name)) return `A server named ${name} already exists.`;
  return null;
}

/** `target` is a URL for http/sse servers and a command line for stdio ones. */
export function targetError(type: McpTransport, target: string): string | null {
  if (type === "stdio") return splitCommand(target).length ? null : "Enter a command.";
  return isHttpUrl(target) ? null : "Enter an http:// or https:// URL.";
}
