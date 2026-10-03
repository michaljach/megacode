// Runs in the task workspace; deliberately uses the real Agent and tools.
import { writeFileSync } from "node:fs";
import type { ModelTiming } from "../src/core/agent.ts";
import { EFFORTS, type Effort } from "../src/core/provider.ts";
import { createAgent } from "../src/composition.ts";
import { setConfigDir } from "../src/adapters/storage.ts";
import { loadSettings } from "../src/adapters/settings.ts";

if (process.env.MEGACODE_CONFIG_DIR) setConfigDir(process.env.MEGACODE_CONFIG_DIR);
const timeoutMs = Number(process.env.BENCH_AGENT_TIMEOUT_MS ?? 240_000);
if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid BENCH_AGENT_TIMEOUT_MS");
const effort = process.env.BENCH_EFFORT as Effort | undefined;
if (effort && !EFFORTS.includes(effort)) throw new Error(`Invalid benchmark effort: ${effort}`);
const agent = createAgent(process.argv[2]!, { effort });
const started = performance.now();
const modelTimings: ModelTiming[] = [];
const toolTimings: { step: number; id: string; name: string; startedMs: number; durationMs: number | null; isError: boolean | null }[] = [];
let steps = 0;
let calls = 0;
const notices: string[] = [];
let error: string | undefined;
let finished = false;
// Checkpoint after each event so a hard process deadline still leaves completed timings.
function checkpoint() {
  writeFileSync(process.env.BENCH_METRICS!, JSON.stringify({
    usage: agent.usage, effort: effort ?? "configured", steps, calls, notices, error, finished,
    elapsedMs: performance.now() - started, modelTimings, toolTimings,
    timeoutMs, settings: { ...loadSettings(), ...(effort ? { effort } : {}) },
  }, null, 2));
}
checkpoint();
try {
  await agent.send(process.argv[3]!, AbortSignal.timeout(timeoutMs), {
    approve: async () => true,
    onText: text => process.stdout.write(text),
    onModelTiming: timing => { modelTimings.push(timing); checkpoint(); },
    onStepEnd: () => { steps++; process.stdout.write("\n"); checkpoint(); },
    onToolStart: call => {
      calls++;
      console.log(`TOOL ${call.name} ${JSON.stringify(call.input)}`);
      toolTimings.push({ step: steps, id: call.id, name: call.name, startedMs: performance.now() - started, durationMs: null, isError: null });
      checkpoint();
    },
    onToolEnd: (_, result) => {
      const timing = toolTimings.at(-1)!;
      timing.durationMs = performance.now() - started - timing.startedMs;
      timing.isError = result.isError;
      console.log(result.output);
      checkpoint();
    },
    onNotice: text => { notices.push(text); console.log(text); },
  });
} catch (e) {
  error = String(e);
  console.error(error);
} finally {
  finished = true;
  checkpoint();
}
if (error) process.exitCode = 1;
