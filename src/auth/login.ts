import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { callbackServer, openBrowser, pkce } from "./oauth.ts";

export { loginChatGPT } from "../providers/chatgpt.ts";

/** OpenRouter's OAuth PKCE flow for apps: returns a regular OpenRouter API key. */
export async function loginOpenRouter(onUrl: (url: string) => void, signal: AbortSignal): Promise<string> {
  const { verifier, challenge } = pkce();
  const server = await callbackServer({ port: 0, path: "/callback", signal });
  try {
    const url = new URL("https://openrouter.ai/auth");
    url.searchParams.set("callback_url", `http://localhost:${server.port}/callback`);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    onUrl(url.toString());
    openBrowser(url.toString());
    const code = await server.code;
    const res = await fetch("https://openrouter.ai/api/v1/auth/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
      signal,
    });
    if (!res.ok) throw new Error(`OpenRouter key exchange failed (${res.status})`);
    return ((await res.json()) as { key: string }).key;
  } finally {
    server.close();
  }
}

const antConfigDir = () =>
  process.env.ANTHROPIC_CONFIG_DIR ??
  (process.platform === "win32" ? path.join(process.env.APPDATA ?? "", "Anthropic") : path.join(os.homedir(), ".config", "anthropic"));

/** True if `ant auth login` has stored credentials the Anthropic SDK will pick up. */
export function hasAntProfile(): boolean {
  const dir = path.join(antConfigDir(), "credentials");
  try {
    return existsSync(dir) && readdirSync(dir).some((f) => f.endsWith(".json"));
  } catch {
    return false;
  }
}

/**
 * Runs `ant auth login` (Anthropic CLI browser sign-in). The SDK reads the resulting profile,
 * so megacode stores nothing itself. Resolves with the CLI's output.
 */
export function loginAnthropicCLI(onOutput: (line: string) => void, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ant", ["auth", "login"], { stdio: ["ignore", "pipe", "pipe"], signal });
    const onData = (d: Buffer) => d.toString().split("\n").filter(Boolean).forEach(onOutput);
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (e: NodeJS.ErrnoException) =>
      reject(e.code === "ENOENT" ? new Error("ANT_NOT_INSTALLED") : e.name === "AbortError" ? new Error("Sign-in cancelled") : e),
    );
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ant auth login exited with code ${code}`))));
  });
}
