import { loadAuth, loadSettings } from "../config.ts";
import { hasAntProfile } from "../login.ts";
import type { Provider } from "../types.ts";
import { AnthropicProvider } from "./anthropic.ts";
import { ChatGPTProvider } from "./chatgpt.ts";
import { GeminiProvider } from "./gemini.ts";
import { OpenAIProvider } from "./openai.ts";

/** Ways to sign in, in the order offered. */
export type LoginMethod = "chatgpt" | "openrouter-oauth" | "ant-cli" | "key" | "url";

export type ProviderInfo = {
  name: string;
  methods: LoginMethod[];
  label: string;
  adapter: "anthropic" | "openai" | "gemini";
  env: string[]; // API key env vars, first one is the canonical name
  baseURL?: string; // OpenAI-compatible endpoint
  baseURLEnv?: string;
  keyUrl?: string; // where to create a key
  local?: boolean; // no key needed
  defaultModel?: string;
  filter?: (id: string) => boolean; // hide non-chat models from the picker
};

export const PROVIDER_INFO: ProviderInfo[] = [
  {
    name: "anthropic",
    label: "Anthropic",
    methods: ["key", "ant-cli"],
    adapter: "anthropic",
    env: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"],
    keyUrl: "https://console.anthropic.com/settings/keys",
    defaultModel: "claude-opus-5",
  },
  {
    name: "openai",
    label: "OpenAI",
    methods: ["chatgpt", "key"],
    adapter: "openai",
    env: ["OPENAI_API_KEY"],
    keyUrl: "https://platform.openai.com/api-keys",
    defaultModel: "gpt-5",
    filter: (id) =>
      /^(gpt-|o\d|chatgpt|codex)/.test(id) && !/(audio|realtime|tts|transcribe|image|search|embedding|instruct)/.test(id),
  },
  {
    name: "gemini",
    label: "Google Gemini",
    methods: ["key"],
    adapter: "gemini",
    env: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    keyUrl: "https://aistudio.google.com/apikey",
    defaultModel: "gemini-2.5-pro",
    filter: (id) => /^gemini/.test(id) && !/(tts|image|embedding)/.test(id),
  },
  {
    name: "openrouter",
    label: "OpenRouter",
    methods: ["openrouter-oauth", "key"],
    adapter: "openai",
    env: ["OPENROUTER_API_KEY"],
    baseURL: "https://openrouter.ai/api/v1",
    keyUrl: "https://openrouter.ai/settings/keys",
  },
  {
    name: "groq",
    label: "Groq",
    methods: ["key"],
    adapter: "openai",
    env: ["GROQ_API_KEY"],
    baseURL: "https://api.groq.com/openai/v1",
    keyUrl: "https://console.groq.com/keys",
  },
  {
    name: "deepseek",
    label: "DeepSeek",
    methods: ["key"],
    adapter: "openai",
    env: ["DEEPSEEK_API_KEY"],
    baseURL: "https://api.deepseek.com",
    keyUrl: "https://platform.deepseek.com/api_keys",
  },
  { name: "ollama", label: "Ollama (local)", methods: ["url"], adapter: "openai", env: [], baseURL: "http://localhost:11434/v1", local: true },
  { name: "lmstudio", label: "LM Studio (local)", methods: ["url"], adapter: "openai", env: [], baseURL: "http://localhost:1234/v1", local: true },
  {
    name: "compat",
    label: "Custom OpenAI-compatible",
    methods: ["url"],
    adapter: "openai",
    env: ["OPENAI_COMPAT_API_KEY"],
    baseURLEnv: "OPENAI_COMPAT_BASE_URL",
  },
];

export const PROVIDERS = PROVIDER_INFO.map((p) => p.name);

export function providerInfo(name: string): ProviderInfo {
  const info = PROVIDER_INFO.find((p) => p.name === name);
  if (!info) throw new Error(`Unknown provider "${name}". Available: ${PROVIDERS.join(", ")}`);
  return info;
}

export type Credentials = {
  apiKey?: string;
  baseURL?: string;
  /** Where the credentials come from; undefined = not configured. */
  source?: "env" | "saved" | "chatgpt" | "ant-profile" | "local";
};

export function credentials(name: string): Credentials {
  const info = providerInfo(name);
  const saved = loadAuth()[name] ?? {};
  const envKey = info.env.map((k) => process.env[k]).find(Boolean);
  const baseURL = (info.baseURLEnv && process.env[info.baseURLEnv]) || saved.baseURL || info.baseURL;
  if (envKey) return { apiKey: envKey, baseURL, source: "env" };
  if (saved.chatgpt) return { source: "chatgpt" };
  if (saved.apiKey) return { apiKey: saved.apiKey, baseURL, source: "saved" };
  if (info.local) return { baseURL, source: "local" };
  // Credentials from `ant auth login`, which the Anthropic SDK picks up on its own.
  if (name === "anthropic" && hasAntProfile()) return { source: "ant-profile" };
  // A custom endpoint may not need a key at all.
  if (name === "compat" && baseURL) return { baseURL, source: info.baseURLEnv && process.env[info.baseURLEnv] ? "env" : "saved" };
  return { baseURL };
}

export const isConfigured = (name: string) => !!credentials(name).source;

/** Short human description of how a provider is authenticated. */
export function authStatus(name: string): string {
  const info = providerInfo(name);
  const c = credentials(name);
  switch (c.source) {
    case "env":
      return `via $${info.env.find((k) => process.env[k]) ?? info.baseURLEnv}`;
    case "saved":
      return c.apiKey ? `saved key ••••${c.apiKey.slice(-4)}` : `saved endpoint ${c.baseURL}`;
    case "chatgpt": {
      const t = loadAuth()[name]?.chatgpt;
      return ["ChatGPT", t?.plan, t?.email].filter(Boolean).join(" · ");
    }
    case "ant-profile":
      return "ant CLI profile";
    case "local":
      return c.baseURL!;
    default:
      return "not configured";
  }
}

export function createProvider(name: string, creds: Credentials = credentials(name)): Provider {
  const info = providerInfo(name);
  if (creds.source === "chatgpt") return new ChatGPTProvider();
  if (info.adapter === "anthropic") return new AnthropicProvider(creds.apiKey);
  if (info.adapter === "gemini") return new GeminiProvider(creds.apiKey, info.filter);
  if (!creds.baseURL && name !== "openai") throw new Error(`No endpoint configured for ${info.label}. Run /login.`);
  // Local servers don't need a key, but the SDK requires a non-empty one.
  const apiKey = creds.apiKey ?? (name === "openai" ? undefined : "none");
  return new OpenAIProvider({ baseURL: creds.baseURL, apiKey, filter: info.filter });
}

const cache = new Map<string, Provider>();
const modelLists = new Map<string, Promise<string[]>>();

/** Drop cached clients and model lists after credentials change. */
export function resetProvider(name: string) {
  cache.delete(name);
  modelLists.delete(name);
}

function getProvider(name: string): Provider {
  let provider = cache.get(name);
  if (!provider) cache.set(name, (provider = createProvider(name)));
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

/** Resolves "provider:model" (or a bare provider name) to a provider instance and model id. */
export function resolve(spec: string): { provider: Provider; providerName: string; model: string } {
  const i = spec.indexOf(":"); // split on the first colon only; ollama tags contain colons
  const providerName = i === -1 ? spec : spec.slice(0, i);
  const model = i === -1 ? providerInfo(providerName).defaultModel : spec.slice(i + 1);
  if (!model) throw new Error(`Specify a model, e.g. ${providerName}:<model>, or pick one with /model`);
  return { provider: getProvider(providerName), providerName, model };
}

/** $MEGACODE_MODEL, else the last model used, else the first configured provider's default. */
export function defaultModel(): string {
  if (process.env.MEGACODE_MODEL) return process.env.MEGACODE_MODEL;
  const last = loadSettings().model;
  if (last && PROVIDERS.includes(last.split(":")[0]!) && isConfigured(last.split(":")[0]!)) return last;
  const configured = PROVIDER_INFO.find((p) => p.defaultModel && isConfigured(p.name));
  return `${(configured ?? PROVIDER_INFO[0]!).name}:${(configured ?? PROVIDER_INFO[0]!).defaultModel}`;
}
