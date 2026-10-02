import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { tasks } from "./tasks.ts";
import { defaultModel } from "../src/adapters/providers/registry.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const { values } = parseArgs({ options: {
  model: { type: "string" }, command: { type: "string" }, label: { type: "string" },
  repeats: { type: "string", default: "1" }, task: { type: "string" },
  baseline: { type: "boolean", default: false },
} });
const repeats = Number(values.repeats);
if (!Number.isInteger(repeats) || repeats < 1) throw new Error("--repeats must be a positive integer");
const selected = tasks.filter(t => !values.task || t.id === values.task);
if (!selected.length) throw new Error("Unknown task");
const model = values.model ?? defaultModel();
const external: string[] | undefined = values.command ? JSON.parse(values.command) : undefined;
if (external && (!Array.isArray(external) || !external.length || external.some(x => typeof x !== "string")))
  throw new Error('--command must be a JSON argv array, e.g. ["my-wrapper"]');
const label = values.label ?? (values.baseline ? "baseline" : external ? "external" : "megacode");
const runDir = path.join(root, ".bench", `${new Date().toISOString().replaceAll(":", "-")}-${label.replace(/[^\w-]/g, "_")}`);
await mkdir(runDir, { recursive: true });
console.log(`Results: ${runDir}\nModel label: ${model}`);

async function command(argv: string[], cwd: string, env: NodeJS.ProcessEnv, timeout: number) {
  const start = performance.now();
  return await new Promise<{ code: number | null; signal: string | null; timedOut: boolean; ms: number; output: string }>(resolve => {
    const child = spawn(argv[0]!, argv.slice(1), { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
    let output = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { if (process.platform !== "win32") process.kill(-child.pid!, "SIGKILL"); else child.kill("SIGKILL"); } catch {}
    }, timeout);
    child.stdout.on("data", data => { output += data; });
    child.stderr.on("data", data => { output += data; });
    child.on("error", error => { output += String(error); });
    child.on("close", (code, signal) => { clearTimeout(timer); resolve({ code, signal, timedOut, ms: Math.round(performance.now()-start), output }); });
  });
}

const results: Record<string, unknown>[] = [];
for (let repeat = 1; repeat <= repeats; repeat++) for (const task of selected) {
  const dir = path.join(runDir, `${task.id}-${repeat}`);
  const workspace = path.join(dir, "workspace");
  await mkdir(workspace, { recursive: true });
  const files = { "package.json": '{"private":true,"type":"module","scripts":{"test":"node --test"}}\n', ...task.files };
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(workspace, name)), { recursive: true });
    await writeFile(path.join(workspace, name), content);
  }
  await writeFile(path.join(dir, "prompt.txt"), task.prompt);
  const metricsFile = path.join(dir, "metrics.json");
  // The grader is created only AFTER the agent exits. Never put reference tests in its workspace.
  const invocation = external ? [...external, task.prompt] : [process.execPath, path.join(root, "node_modules/tsx/dist/cli.mjs"), path.join(root, "bench/megacode.ts"), model, task.prompt];
  const run = values.baseline ? { code: 0, signal: null, timedOut: false, ms: 0, output: "Unmodified fixture" } :
    await command(invocation, workspace, { ...process.env, BENCH_METRICS: metricsFile, BENCH_MODEL: model }, 300_000);
  await writeFile(path.join(dir, "transcript.txt"), run.output);
  const entry = Object.keys(task.files).find(name => name.startsWith("src/"))!;
  const grader = `import assert from 'node:assert/strict';\nimport {test} from 'node:test';\nimport {readFile} from 'node:fs/promises';\nimport path from 'node:path';\nimport {pathToFileURL} from 'node:url';\nconst mod = await import(pathToFileURL(path.join(process.env.BENCH_WORKSPACE, ${JSON.stringify(entry)})));\n${task.tests}`;
  const gradeFile = path.join(dir, "grade.test.mjs");
  await writeFile(gradeFile, grader);
  const grade = await command([process.execPath, "--test", "--test-reporter=tap", gradeFile], dir, { ...process.env, BENCH_WORKSPACE: workspace }, 30_000);
  await writeFile(path.join(dir, "grade.txt"), grade.output);
  let metrics: unknown = null;
  if (!external && !values.baseline) try { metrics = JSON.parse(await readFile(metricsFile, "utf8")); } catch {}
  const result = { task: task.id, repeat, passed: grade.code === 0 && !grade.timedOut,
    checksPassed: Number(grade.output.match(/^# pass (\d+)/m)?.[1] ?? 0),
    checksFailed: Number(grade.output.match(/^# fail (\d+)/m)?.[1] ?? 0),
    agentExit: run.code, timedOut: run.timedOut, elapsedMs: run.ms, metrics };
  results.push(result);
  console.log(JSON.stringify(result));
  await writeFile(path.join(runDir, "results.json"), JSON.stringify({ label, model, external, repeats, results }, null, 2));
}
console.log(`Task pass rate: ${results.filter(r => r.passed).length}/${results.length}`);
