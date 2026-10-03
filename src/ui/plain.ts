import { createInterface } from "node:readline/promises";
import { styleText } from "node:util";
import { providerInfo } from "../adapters/providers/catalog.ts";
import { needsLogin, providerOf } from "../adapters/providers/credentials.ts";
import type { Agent } from "../core/agent.ts";
import { autoApproved, type PermissionMode } from "../core/settings.ts";
import type { Approve } from "../core/tools.ts";
import { approvalBody, displayOutput, formatCall, previewOutput } from "./format.ts";

/** Non-interactive mode for one-shot prompts and pipes: prints the transcript as plain text. */
export async function runPlain(agent: Agent, prompt: string, mode: PermissionMode): Promise<number> {
  if (needsLogin(agent.model)) {
    const info = providerInfo(providerOf(agent.model));
    const env = info.env[0] ? ` or set $${info.env[0]}` : "";
    console.error(`Not logged in to ${info.label}. Run megacode and use /login${env}.`);
    return 1;
  }
  const controller = new AbortController();
  process.on("SIGINT", () => controller.abort());
  const rl = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  const approve: Approve = async (req) => {
    if (autoApproved(mode, req.tool)) return true;
    if (!rl) return false;
    console.log(`${styleText("yellow", req.title)}\n${approvalBody(req)}`);
    try {
      const answer = await rl.question(styleText("yellow", "Allow? [y/N] "), { signal: controller.signal });
      return answer.trim().toLowerCase() === "y";
    } catch {
      // Ctrl+C at the prompt: readline takes it (so SIGINT never fires) and rejects. Stop the whole run.
      controller.abort();
      return false;
    }
  };
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
      onToolEnd: (call, r) =>
        console.log(styleText(r.isError ? "red" : "dim", `  ⎿  ${previewOutput(displayOutput(call, r)).replace(/\n/g, "\n     ")}`)),
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
