import { callbackServer, jwtClaims, openBrowser, pkce } from "./oauth.ts";
import { saveCredentials, savedCredentials, type ChatGPTTokens } from "./store.ts";

// "Sign in with ChatGPT": the OAuth client and backend used by OpenAI's Codex CLI
// (github.com/openai/codex, codex-rs/login). Requests are billed to the user's ChatGPT plan.
// This backend is not a documented public API and may change.
// The env overrides exist for testing against a local mock.
const ISSUER = process.env.MEGACODE_CHATGPT_ISSUER ?? "https://auth.openai.com";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const PORT = 1455; // the redirect URI registered for this client
const REDIRECT_URI = `http://127.0.0.1:${PORT}/auth/callback`;
export const CHATGPT_BASE_URL = process.env.MEGACODE_CHATGPT_BASE_URL ?? "https://chatgpt.com/backend-api/codex";
const ORIGINATOR = "codex_cli_rs";

type TokenResponse = { id_token?: string; access_token: string; refresh_token?: string; expires_in?: number };

/** Headers the ChatGPT backend expects on every request. */
export const chatGPTHeaders = (t: ChatGPTTokens) => ({ "ChatGPT-Account-ID": t.accountId, originator: ORIGINATOR });

function toTokens(res: TokenResponse, prev?: ChatGPTTokens): ChatGPTTokens {
  const id = res.id_token ? jwtClaims(res.id_token) : {};
  const access = jwtClaims(res.access_token);
  const auth = id["https://api.openai.com/auth"] ?? access["https://api.openai.com/auth"] ?? {};
  return {
    access: res.access_token,
    refresh: res.refresh_token ?? prev?.refresh ?? "",
    expires: access.exp ? access.exp * 1000 : Date.now() + (res.expires_in ?? 3600) * 1000,
    accountId: auth.chatgpt_account_id ?? prev?.accountId ?? "",
    email: id.email ?? id["https://api.openai.com/profile"]?.email ?? prev?.email,
    plan: auth.chatgpt_plan_type ?? prev?.plan,
  };
}

async function tokenRequest(body: Record<string, string>, format: "json" | "form"): Promise<TokenResponse> {
  const res = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "content-type": format === "json" ? "application/json" : "application/x-www-form-urlencoded" },
    body: format === "json" ? JSON.stringify(body) : new URLSearchParams(body).toString(),
  });
  if (!res.ok) throw new Error(`Token request failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<TokenResponse>;
}

function authorizeUrl(challenge: string, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "openid profile email offline_access",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    originator: ORIGINATOR,
  });
  return `${ISSUER}/oauth/authorize?${params}`;
}

/** Browser sign-in with a ChatGPT account. `onUrl` gets the URL in case the browser doesn't open. */
export async function loginChatGPT(onUrl: (url: string) => void, signal: AbortSignal): Promise<ChatGPTTokens> {
  const { verifier, challenge, state } = pkce();
  const server = await callbackServer({ port: PORT, path: "/auth/callback", state, signal });
  try {
    const url = authorizeUrl(challenge, state);
    onUrl(url);
    openBrowser(url);
    const code = await server.code;
    const body = { grant_type: "authorization_code", client_id: CLIENT_ID, code, redirect_uri: REDIRECT_URI, code_verifier: verifier };
    const tokens = toTokens(await tokenRequest(body, "form"));
    if (!tokens.accountId) throw new Error("This account has no ChatGPT workspace. Use an API key instead.");
    return tokens;
  } finally {
    server.close();
  }
}

/** Current tokens, refreshed (and re-saved) when they're about to expire or `force` is set. */
export async function chatGPTTokens(force = false): Promise<ChatGPTTokens> {
  const saved = savedCredentials("openai");
  const tokens = saved?.chatgpt;
  if (!tokens) throw new Error("Not signed in with ChatGPT. Run /login.");
  if (!force && tokens.expires > Date.now() + 60_000) return tokens;
  const refreshed = toTokens(await tokenRequest({ client_id: CLIENT_ID, grant_type: "refresh_token", refresh_token: tokens.refresh }, "json"), tokens);
  saveCredentials("openai", { ...saved, chatgpt: refreshed });
  return refreshed;
}

/** Live subscription limits from the same backend used by Codex. */
export async function chatGPTUsage(): Promise<unknown> {
  const signal = AbortSignal.timeout(15_000);
  const url = `${CHATGPT_BASE_URL.replace(/\/codex\/?$/, "")}/wham/usage`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const t = await chatGPTTokens(attempt > 0);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${t.access}`, ...chatGPTHeaders(t) }, signal });
    if (res.status === 401 && attempt === 0) continue; // token revoked early: refresh once
    if (!res.ok) throw new Error(`Usage request failed (HTTP ${res.status}).${res.status === 401 || res.status === 403 ? " Run /login to update credentials." : ""}`);
    return res.json();
  }
  throw new Error("Unable to fetch ChatGPT usage.");
}
