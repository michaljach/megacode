import { parseModelSpec } from "../../core/provider.ts";
import { hasAntProfile } from "../auth/anthropic.ts";
import { savedCredentials } from "../auth/store.ts";
import { envKeyName, PROVIDERS, providerInfo } from "./catalog.ts";

export type Credentials = {
  apiKey?: string;
  baseURL?: string;
  /** Where the credentials come from; undefined = not configured. */
  source?: "env" | "saved" | "chatgpt" | "ant-profile" | "local";
};

/** Resolves credentials in precedence order: environment, ChatGPT sign-in, saved key, local server, external profile. */
export function credentials(name: string): Credentials {
  const info = providerInfo(name);
  const saved = savedCredentials(name) ?? {};
  const envName = envKeyName(info);
  const envURL = info.baseURLEnv && process.env[info.baseURLEnv];
  const baseURL = envURL || saved.baseURL || info.baseURL;
  if (envName) return { apiKey: process.env[envName], baseURL, source: "env" };
  if (saved.chatgpt) return { source: "chatgpt" };
  if (saved.apiKey) return { apiKey: saved.apiKey, baseURL, source: "saved" };
  if (info.local) return { baseURL, source: "local" };
  // Credentials from `ant auth login`, which the Anthropic SDK picks up on its own.
  if (info.methods.includes("ant-cli") && hasAntProfile()) return { source: "ant-profile" };
  if (info.keyOptional && baseURL) return { baseURL, source: envURL ? "env" : "saved" };
  return { baseURL };
}

export const isConfigured = (name: string) => !!credentials(name).source;

/** The provider half of a "provider:model" spec. */
export const providerOf = (spec: string) => parseModelSpec(spec).provider;

/** True when the spec names a known provider that has no credentials yet. */
export function needsLogin(spec: string): boolean {
  const name = providerOf(spec);
  return PROVIDERS.includes(name) && !isConfigured(name);
}

/** Short human description of how a provider is authenticated. */
export function authStatus(name: string): string {
  const info = providerInfo(name);
  const c = credentials(name);
  switch (c.source) {
    case "env":
      return `via $${envKeyName(info) ?? info.baseURLEnv}`;
    case "saved":
      return c.apiKey ? `saved key ••••${c.apiKey.slice(-4)}` : `saved endpoint ${c.baseURL}`;
    case "chatgpt": {
      const t = savedCredentials(name)?.chatgpt;
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
