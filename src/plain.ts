import { createInterface } from "node:readline/promises";
import { styleText } from "node:util";
import type { Agent } from "./agent.ts";
import type { PermissionMode } from "./config.ts";
import { isConfigured, PROVIDERS, providerInfo } from "./providers/index.ts";
import type { Approve } from "./tools.ts";
import { formatCall, previewOutput } from "./ui/format.ts";

/** Non-interactive mode for one-shot prompts and pipes: prints the transcript as plain text. */
export async function runPlain(agent: Agent, prompt: string, mode: PermissionMode): Promise<number> {
  const provider = agent.model.split(":")[0]!;
  if (PROVIDERS.includes(provider) && !isConfigured(provider)) {
    const info = providerInfo(provider);
    const env = info.env[0] ? ` or set $${info.env[0]}` : "";
    console.error(`Not logged in to ${info.label}. Run megacode and use /login${env}.`);
    return 1;
  }
  const rl = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  const approve: Approve = async ({ tool, title, body }) => {
    if (mode === "yolo" || (mode === "accept-edits" && (tool === "write_file" || tool === "edit_file"))) return true;
    if (!rl) return false;
    console.log(styleText("yellow", `${title}\n${body}`));
    return (await rl.question(styleText("yellow", "Allow? [y/N] "))).trim().toLowerCase() === "y";
  };

  const controller = new AbortController();
  process.on("SIGINT", () => controller.abort());
  let midLine = false;
  try {
    await agent.send(prompt, controller.signal, {
      approve,
      onText(d) {
        process.stdout.write(d);
        midLine = !d.endsWith("\n");
      },
      onStepEnd() {
        if (midLine) process.stdout.write("\n");
        midLine = false;
      },
      onToolStart: (call) => console.log(styleText("cyan", `⏺ ${formatCall(call)}`)),
      onToolEnd: (_, r) =>
        console.log(styleText(r.isError ? "red" : "dim", `  ⎿  ${previewOutput(r.output).replace(/\n/g, "\n     ")}`)),
      onNotice: (text, level) => console.log(styleText(level === "error" ? "red" : "yellow", text)),
    });
    return 0;
  } catch (e) {
    console.error(styleText("red", controller.signal.aborted ? "Interrupted." : `Error: ${(e as Error).message}`));
    return 1;
  } finally {
    rl?.close();
  }
}
