import { callbackServer, openBrowser, pkce } from "./oauth.ts";

/** OpenRouter's OAuth PKCE flow for apps: returns a regular OpenRouter API key. */
export async function loginOpenRouter(onUrl: (url: string) => void, signal: AbortSignal): Promise<string> {
  const { verifier, challenge } = pkce();
  const server = await callbackServer({ port: 0, path: "/callback", signal });
  try {
    const params = { callback_url: `http://localhost:${server.port}/callback`, code_challenge: challenge, code_challenge_method: "S256" };
    const url = `https://openrouter.ai/auth?${new URLSearchParams(params)}`;
    onUrl(url);
    openBrowser(url);
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
