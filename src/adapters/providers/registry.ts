import { parseModelSpec, type ModelResolver, type Provider } from "../../core/provider.ts";
import { loadSettings } from "../settings.ts";
import { AnthropicProvider } from "./anthropic.ts";
import { PROVIDER_INFO, PROVIDERS, providerInfo, usesEndpoint } from "./catalog.ts";
import { ChatGPTProvider } from "./chatgpt.ts";
import { credentials, isConfigured, needsLogin, providerOf, type Credentials } from "./credentials.ts";
import { GeminiProvider } from "./gemini.ts";
import { OpenAIProvider } from "./openai.ts";

export function createProvider(name: string, creds: Credentials = credentials(name)): Provider {
  const info = providerInfo(name);
  if (creds.source === "chatgpt") return new ChatGPTProvider();
  switch (info.adapter) {
    case "anthropic":
      return new AnthropicProvider(creds.apiKey);
    case "gemini":
      return new GeminiProvider(creds.apiKey, info.filter);
    case "openai": {
      // Without an endpoint the SDK uses api.openai.com and reads $OPENAI_API_KEY itself.
      if (!usesEndpoint(info)) return new OpenAIProvider({ apiKey: creds.apiKey, filter: info.filter });
      if (!creds.baseURL) throw new Error(`No endpoint configured for ${info.label}. Run /login.`);
      // Local servers don't need a key, but the SDK requires a non-empty one.
      return new OpenAIProvider({ baseURL: creds.baseURL, apiKey: creds.apiKey ?? "none", filter: info.filter });
    }
  }
}

const providers = new Map<string, Provider>();
const modelLists = new Map<string, Promise<string[]>>();

/** Drop cached clients and model lists after credentials change. */
export function resetProvider(name: string) {
  providers.delete(name);
  modelLists.delete(name);
}

function getProvider(name: string): Provider {
  let provider = providers.get(name);
  if (!provider) providers.set(name, (provider = createProvider(name)));
  return provider;
}

/** Live model list for a provider, cached for the session. */
export function listModels(name: string): Promise<string[]> {
  let list = modelLists.get(name);
  if (!list) {
    list = getProvider(name).listModels();
    list.catch(() => modelLists.delete(name)); // retry next time
    modelLists.set(name, list);
  }
  return list;
}

/** Resolves "provider:model" (or a bare provider name, meaning its default model). */
export const resolveModel: ModelResolver = (spec) => {
  const { provider, model = providerInfo(provider).defaultModel } = parseModelSpec(spec);
  if (!model) throw new Error(`Specify a model, e.g. ${provider}:<model>, or pick one with /model`);
  return { provider: getProvider(provider), model };
};

/** $MEGACODE_MODEL, else the last model used, else the first configured provider's default. */
export function defaultModel(): string {
  if (process.env.MEGACODE_MODEL) return process.env.MEGACODE_MODEL;
  const last = loadSettings().model;
  if (last && PROVIDERS.includes(providerOf(last)) && !needsLogin(last)) return last;
  const p = PROVIDER_INFO.find((p) => p.defaultModel && isConfigured(p.name)) ?? PROVIDER_INFO[0]!;
  return `${p.name}:${p.defaultModel}`;
}
