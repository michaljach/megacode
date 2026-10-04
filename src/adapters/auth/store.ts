import { readJson, writeJson } from "../storage.ts";

/** OAuth tokens from "Sign in with ChatGPT". */
export type ChatGPTTokens = { access: string; refresh: string; expires: number; accountId: string; email?: string; plan?: string };

type SavedCredentials = { apiKey?: string; baseURL?: string; chatgpt?: ChatGPTTokens };

/** Saved credentials per provider in ~/.megacode/auth.json. Environment variables take precedence. */
type AuthFile = Record<string, SavedCredentials>;

const FILE = "auth.json";
const load = () => readJson<AuthFile>(FILE, {});
const save = (auth: AuthFile) => writeJson(FILE, auth, { secret: true });

export const savedCredentials = (provider: string): SavedCredentials | undefined => load()[provider];

export const savedProviders = (): string[] => Object.keys(load());

/** Replaces a provider's saved credentials; empty credentials remove the entry. */
export function saveCredentials(provider: string, creds: SavedCredentials) {
  const auth = load();
  const entry = Object.fromEntries(Object.entries(creds).filter(([, v]) => v)) as SavedCredentials;
  if (Object.keys(entry).length) auth[provider] = entry;
  else delete auth[provider];
  save(auth);
}

/** Returns false if nothing was saved for the provider. */
export function removeCredentials(provider: string): boolean {
  const auth = load();
  if (!auth[provider]) return false;
  delete auth[provider];
  save(auth);
  return true;
}
