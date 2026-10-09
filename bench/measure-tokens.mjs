// Measure token distribution of a megacode conversation
import { buildSystemPrompt } from "../src/core/prompts.ts";
import { builtinTools } from "../src/adapters/tools/index.ts";

// System prompt
const system = buildSystemPrompt({
  cwd: "/home/jach/dev/megacode",
  platform: "linux",
  instructions: [],
  skills: [],
});

// Tool definitions (as embedded in system message)
const tools = builtinTools.specs();
const toolsText = tools.map((t) => `Tool: ${t.name}\n${t.description}\nSchema: ${JSON.stringify(t.parameters)}`).join("\n\n");

console.log("=== Token distribution ===\n");

console.log("System prompt:");
console.log("  Chars:", system.length);
console.log("  Tokens (est):", Math.ceil(system.length / 4));

console.log("\nEmbedded tool definitions:");
console.log("  Chars:", toolsText.length);
console.log("  Tokens (est):", Math.ceil(toolsText.length / 4));

console.log("\nSystem prompt + tools:");
const combined = [system, toolsText].filter(Boolean).join("\n\n");
console.log("  Chars:", combined.length);
console.log("  Tokens (est):", Math.ceil(combined.length / 4));

console.log("\n=== Tool breakdown ===\n");
for (const t of tools) {
  const text = `Tool: ${t.name}\n${t.description}\nSchema: ${JSON.stringify(t.parameters)}`;
  console.log(`${t.name.padEnd(15)} ${text.length.toString().padStart(5)} chars`);
}
