// Runs in the task workspace; deliberately uses the real Agent and tools.
import { writeFile } from "node:fs/promises";
import { Agent } from "../src/agent.ts";

const agent = new Agent(process.argv[2]!);
let steps = 0;
let calls = 0;
const notices: string[] = [];
let error: string | undefined;
try {
  await agent.send(process.argv[3]!, AbortSignal.timeout(240_000), {
    approve: async () => true,
    onText: text => process.stdout.write(text),
    onStepEnd: () => { steps++; process.stdout.write("\n"); },
    onToolStart: call => { calls++; console.log(`TOOL ${call.name} ${JSON.stringify(call.input)}`); },
    onToolEnd: (_, result) => console.log(result.output),
    onNotice: text => { notices.push(text); console.log(text); },
  });
} catch (e) {
  error = String(e);
  console.error(error);
} finally {
  await writeFile(process.env.BENCH_METRICS!, JSON.stringify({ usage: agent.usage, steps, calls, notices, error }, null, 2));
}
if (error) process.exitCode = 1;
