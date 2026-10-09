// Cache hit rate benchmark - real OpenAI API
import { buildSystemPrompt } from "../src/core/prompts.ts";
import { compressedToolText } from "../src/adapters/providers/shared.ts";
import { builtinTools } from "../src/adapters/tools/index.ts";
import OpenAI from "openai";

const apiKey = process.argv[2];
if (!apiKey) {
  console.error("Usage: node --import tsx bench/cache-real-final.mjs <api-key>");
  process.exit(1);
}

const systemPrompt = buildSystemPrompt({
  cwd: "/home/jach/dev/megacode",
  platform: "linux",
  instructions: [],
  skills: [],
  stable: true,
});

const toolsText = builtinTools.specs().map(function(t) {
  return compressedToolText(t);
}).join("\n\n");
const fullSystem = [systemPrompt, toolsText].filter(Boolean).join("\n\n");

console.log("System: " + systemPrompt.length + " chars / " + Math.ceil(systemPrompt.length / 4) + " tokens");
console.log("Tools: " + toolsText.length + " chars / " + Math.ceil(toolsText.length / 4) + " tokens");
console.log("Total cacheable prefix: " + fullSystem.length + " chars / " + Math.ceil(fullSystem.length / 4) + " tokens");
console.log();

// Helper to collect all chunks and get usage
async function collectUsage(openai, params) {
  var response = await openai.chat.completions.create(params);
  var chunks = [];
  for await (var chunk of response) {
    chunks.push(chunk);
  }
  var lastChunk = chunks[chunks.length - 1];
  return lastChunk ? lastChunk.usage : null;
}

async function run() {
  const openai = new OpenAI({ apiKey: apiKey });
  var NUM_TURNS = 30;

  console.log("=== Cache Hit Rate Benchmark (" + NUM_TURNS + " turns, gpt-4o-mini) ===\n");

  // Build base conversation (user+assistant pairs that stay the same each turn)
  var baseMessages = [];
  var topics = [
    "JavaScript fundamentals", "TypeScript generics", "React hooks",
    "Node.js event loop", "Git branching strategies", "CSS Grid layouts",
    "REST API design", "Database normalization", "Unit testing patterns",
    "CI/CD pipeline setup"
  ];

  for (var i = 0; i < NUM_TURNS; i++) {
    var topic = topics[i % topics.length];
    baseMessages.push({ role: "user", content: "Please work on " + topic + ". Read the relevant files and make changes as needed. Use edit_file for targeted changes. Check the results afterwards." });
    baseMessages.push({ role: "assistant", content: "I'll work on " + topic + ". Let me read the relevant files first, then make the necessary edits using edit_file for targeted changes and verify the results." });
  }

  var results = [];

  for (var turn = 0; turn < NUM_TURNS; turn++) {
    // Build conversation up to this turn
    var messages = baseMessages.slice(0, turn * 2);

    // Current user message (changes each turn)
    messages.push({
      role: "user",
      content: "Current task " + (turn + 1) + ": Review and improve the " + ["core module", "UI component", "API endpoint", "test suite", "config file", "build script", "documentation", "error handler"][turn % 8] + " for better performance."
    });

    var startTime = Date.now();

    try {
      var usage = await collectUsage(openai, {
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: fullSystem }, ...messages],
        max_tokens: 5,
        stream: true,
        stream_options: { include_usage: true },
      });

      var duration = Date.now() - startTime;

      if (!usage) {
        console.log("Turn " + (turn + 1) + ": No usage data");
        continue;
      }

      var totalTokens = usage.prompt_tokens;
      var cachedTokens = usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens ? usage.prompt_tokens_details.cached_tokens : 0;
      var cacheHitRate = totalTokens > 0 ? (cachedTokens / totalTokens * 100) : 0;

      results.push({ turn: turn + 1, totalTokens: totalTokens, cachedTokens: cachedTokens, cacheHitRate: cacheHitRate, duration: duration });

      var cachedPct = cachedTokens > 0 ? (cachedTokens / totalTokens * 100).toFixed(1).padStart(5) : "   0.0";
      console.log("T" + (turn + 1).toString().padStart(2) + ": " + totalTokens.toString().padStart(5) + " total, " + cachedTokens.toString().padStart(5) + " cached, " + cachedPct + "% hit rate");

    } catch (e) {
      console.log("Turn " + (turn + 1) + ": " + e.message);
      break;
    }
  }

  if (results.length === 0) {
    console.log("No results. Check API key.");
    return;
  }

  var cacheResults = results.slice(1);
  var avgRate = cacheResults.reduce(function(s, r) { return s + r.cacheHitRate; }, 0) / cacheResults.length;

  console.log("\n=== Results ===");
  console.log("Average cache hit rate (turns 2-" + (cacheResults.length + 1) + "): " + avgRate.toFixed(1) + "%");
  console.log("Min: " + Math.min.apply(null, cacheResults.map(function(r) { return r.cacheHitRate; })).toFixed(1) + "%");
  console.log("Max: " + Math.max.apply(null, cacheResults.map(function(r) { return r.cacheHitRate; })).toFixed(1) + "%");
  console.log("\nCache threshold: ~1024 tokens (GPT-4o-mini)");
  console.log("System + compressed tools: " + Math.ceil(fullSystem.length / 4) + " tokens");
  console.log("Remaining cache budget: " + Math.max(0, 1024 - Math.ceil(fullSystem.length / 4)) + " tokens");
}

run().catch(console.error);
