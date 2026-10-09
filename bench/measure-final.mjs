// Measure: compressed tool definitions savings
import { builtinTools } from "../src/adapters/tools/index.ts";
import { compressedToolText } from "../src/adapters/providers/shared.ts";

function current(t) {
  return `Tool: ${t.name}\n${t.description}\nSchema: ${JSON.stringify(t.parameters, null, 2)}`;
}

console.log("=== Current vs Compressed ===\n");

let totalCurrent = 0;
let totalCompressed = 0;

for (const tool of builtinTools.specs()) {
  const cur = current(tool);
  const cmp = compressedToolText(tool);
  const curTokens = Math.ceil(cur.length / 4);
  const cmpTokens = Math.ceil(cmp.length / 4);
  totalCurrent += cur.length;
  totalCompressed += cmp.length;

  console.log(`${tool.name}:`);
  console.log(`  Current: ${cur.length} chars / ${curTokens} tokens`);
  console.log(`  Compressed: ${cmp.length} chars / ${cmpTokens} tokens`);
  console.log(`  Saved: ${cur.length - cmp.length} chars / ${curTokens - cmpTokens} tokens (${Math.round((1 - cmp.length/cur.length)*100)}%)`);
  console.log();
}

const combined = { current: totalCurrent, compressed: totalCompressed };
const curTokens = Math.ceil(combined.current / 4);
const cmpTokens = Math.ceil(combined.compressed / 4);

// System prompt
const { buildSystemPrompt } = await import("../src/core/prompts.ts");
const sys = buildSystemPrompt({ cwd: "/home/jach/dev/megacode", platform: "linux", instructions: [], skills: [] });

console.log("\n=== CACHEABLE PREFIX ===");
console.log(`System prompt: ${sys.length} chars / ${Math.ceil(sys.length / 4)} tokens`);
console.log(`Current tools: ${combined.current} chars / ${curTokens} tokens`);
console.log(`Current total: ${sys.length + combined.current} chars / ${Math.ceil((sys.length + combined.current) / 4)} tokens`);
console.log();
console.log(`Compressed tools: ${combined.compressed} chars / ${cmpTokens} tokens`);
console.log(`Compressed total: ${sys.length + combined.compressed} chars / ${Math.ceil((sys.length + combined.compressed) / 4)} tokens`);
console.log(`Saved: ${combined.current - combined.compressed} chars / ${curTokens - cmpTokens} tokens (${Math.round((1 - combined.compressed/combined.current)*100)}%)`);
