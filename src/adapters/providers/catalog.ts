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
  local?: boolean; // a server on this machine; no key needed
  keyOptional?: boolean; // a custom endpoint that may not need a key
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
    keyOptional: true,
  },
];

export const PROVIDERS = PROVIDER_INFO.map((p) => p.name);

export function providerInfo(name: string): ProviderInfo {
  const info = PROVIDER_INFO.find((p) => p.name === name);
  if (!info) throw new Error(`Unknown provider "${name}". Available: ${PROVIDERS.join(", ")}`);
  return info;
}

/** Providers reached through a custom endpoint rather than the vendor's default one. */
export const usesEndpoint = (info: ProviderInfo) => !!(info.baseURL || info.baseURLEnv);

/** The first env var that's set for this provider's key, if any. */
export const envKeyName = (info: ProviderInfo) => info.env.find((k) => process.env[k]);
