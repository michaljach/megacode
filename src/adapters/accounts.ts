import { withTimeout } from "../lib/async.ts";
import { removeCredentials, saveCredentials, type ChatGPTTokens } from "./auth/store.ts";
import { envKeyName, providerInfo } from "./providers/catalog.ts";
import { createProvider, resetProvider } from "./providers/registry.ts";

// Account use cases behind /login and /logout. The UI collects input; this decides what gets stored.

const VERIFY_TIMEOUT = 20_000;

/** Checks a key and/or endpoint by listing models, then saves it. Throws (saving nothing) if it doesn't work. */
export async function verifyAndSaveKey(name: string, input: { apiKey?: string; baseURL?: string }): Promise<void> {
  const apiKey = input.apiKey || undefined;
  const baseURL = input.baseURL || undefined;
  await withTimeout(createProvider(name, { apiKey, baseURL, source: "saved" }).listModels(), VERIFY_TIMEOUT);
  // Don't pin the default endpoint, so a later change to the default still applies.
  saveCredentials(name, { apiKey, baseURL: baseURL !== providerInfo(name).baseURL ? baseURL : undefined });
  resetProvider(name);
}

/** "Sign in with ChatGPT" replaces any saved OpenAI API key. */
export function saveChatGPTLogin(tokens: ChatGPTTokens) {
  saveCredentials("openai", { chatgpt: tokens });
  resetProvider("openai");
}

/** With credentials in place, how many models the provider offers. Throws if they don't work. */
export async function countModels(name: string): Promise<number> {
  resetProvider(name);
  return (await withTimeout(createProvider(name).listModels(), VERIFY_TIMEOUT)).length;
}

/** Removes saved credentials and says what happened, including an env var that still applies. */
export function logout(name: string): { ok: boolean; message: string } {
  if (!removeCredentials(name)) return { ok: false, message: `No saved credentials for ${name}.` };
  resetProvider(name);
  const info = providerInfo(name);
  const env = envKeyName(info);
  return { ok: true, message: `Removed saved credentials for ${info.label}${env ? ` ($${env} is still set in your environment)` : ""}.` };
}
