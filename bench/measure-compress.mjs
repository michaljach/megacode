// Measure: how much we save by compressing tool definitions
import { builtinTools } from "../src/adapters/tools/index.ts";

function current(t) {
  return `Tool: ${t.name}\n${t.description}\nSchema: ${JSON.stringify(t.parameters, null, 2)}`;
}

function compressed(t) {
  const p = t.parameters;
  const props = Object.entries(p.properties ?? {});
  const required = p.required ?? [];
  const lines = [
    `Tool: ${t.name}\n${t.description}`,
    `Args:`,
    ...props.map(([k, v]) => {
      const req = required.includes(k) ? " *" : "";
      const type = v.type || "object";
      const desc = v.description ? ` ${v.description}` : "";
      const min = v.minimum !== undefined ? `[min:${v.minimum}]` : "";
      const max = v.maximum !== undefined ? `[max:${v.maximum}]` : "";
      const def = v.default !== undefined ? `[def:${v.default}]` : "";
      return `  ${k}${req} (${type})${desc}${min}${max}${def}`;
    }),
  ];
  return lines.join("\n");
}

console.log("=== Current vs Compressed ===\n");

let totalCurrent = 0;
let totalCompressed = 0;

for (const tool of builtinTools.specs()) {
  const cur = current(tool);
  const cmp = compressed(tool);
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

console.log("=== TOTAL ===");
console.log(`Current: ${combined.current} chars / ${curTokens} tokens`);
console.log(`Compressed: ${combined.compressed} chars / ${cmpTokens} tokens`);
console.log(`Saved: ${combined.current - combined.compressed} chars / ${curTokens - cmpTokens} tokens (${Math.round((1 - combined.compressed/combined.current)*100)}%)`);
