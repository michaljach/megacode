import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { loadAuth, saveAuth, type ChatGPTTokens } from "../config.ts";
import { callbackServer, jwtClaims, openBrowser, pkce } from "../oauth.ts";
import type { Message, Provider, StopReason, ToolCall, TurnRequest, TurnResult } from "../types.ts";

// "Sign in with ChatGPT": the OAuth client and backend used by OpenAI's Codex CLI
// (github.com/openai/codex, codex-rs/login). Requests are billed to the user's ChatGPT plan.
// This backend is not a documented public API and may change.
// The env overrides exist for testing against a local mock.
const ISSUER = process.env.MEGACODE_CHATGPT_ISSUER ?? "https://auth.openai.com";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const PORT = 1455; // the redirect URI registered for this client
const BASE_URL = process.env.MEGACODE_CHATGPT_BASE_URL ?? "https://chatgpt.com/backend-api/codex";
const ORIGINATOR = "codex_cli_rs";
const FALLBACK_MODELS = ["gpt-5", "gpt-5-codex"];

function toTokens(res: { id_token?: string; access_token: string; refresh_token?: string; expires_in?: number }, prev?: ChatGPTTokens): ChatGPTTokens {
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

async function tokenRequest(body: Record<string, string>, json: boolean) {
  const res = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "content-type": json ? "application/json" : "application/x-www-form-urlencoded" },
    body: json ? JSON.stringify(body) : new URLSearchParams(body).toString(),
  });
  if (!res.ok) throw new Error(`Token request failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<{ id_token?: string; access_token: string; refresh_token?: string; expires_in?: number }>;
}

/** Browser sign-in with a ChatGPT account. `onUrl` gets the URL in case the browser doesn't open. */
export async function loginChatGPT(onUrl: (url: string) => void, signal: AbortSignal): Promise<ChatGPTTokens> {
  const { verifier, challenge, state } = pkce();
  const server = await callbackServer({ port: PORT, path: "/auth/callback", state, signal });
  try {
    const redirectUri = `http://127.0.0.1:${PORT}/auth/callback`;
    const url = new URL(`${ISSUER}/oauth/authorize`);
    for (const [k, v] of Object.entries({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
      scope: "openid profile email offline_access",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      id_token_add_organizations: "true",
      codex_cli_simplified_flow: "true",
      originator: ORIGINATOR,
    }))
      url.searchParams.set(k, v);
    onUrl(url.toString());
    openBrowser(url.toString());
    const code = await server.code;
    const tokens = toTokens(
      await tokenRequest(
        { grant_type: "authorization_code", client_id: CLIENT_ID, code, redirect_uri: redirectUri, code_verifier: verifier },
        false,
      ),
    );
    if (!tokens.accountId) throw new Error("This account has no ChatGPT workspace. Use an API key instead.");
    return tokens;
  } finally {
    server.close();
  }
}

/** Current access token, refreshed (and re-saved) when it's about to expire. */
async function currentTokens(force = false): Promise<ChatGPTTokens> {
  const auth = loadAuth();
  const saved = auth.openai?.chatgpt;
  if (!saved) throw new Error("Not signed in with ChatGPT. Run /login.");
  if (!force && saved.expires > Date.now() + 60_000) return saved;
  const refreshed = toTokens(await tokenRequest({ client_id: CLIENT_ID, grant_type: "refresh_token", refresh_token: saved.refresh }, true), saved);
  auth.openai = { ...auth.openai, chatgpt: refreshed };
  saveAuth(auth);
  return refreshed;
}

/** OpenAI models through a ChatGPT subscription, via the Responses API. */
export class ChatGPTProvider implements Provider {
  sessionId = randomUUID();

  private async client(force = false) {
    const t = await currentTokens(force);
    return new OpenAI({
      apiKey: t.access,
      baseURL: BASE_URL,
      defaultHeaders: { "ChatGPT-Account-ID": t.accountId, originator: ORIGINATOR, session_id: this.sessionId },
    });
  }

  async listModels(): Promise<string[]> {
    const t = await currentTokens();
    try {
      const res = await fetch(`${BASE_URL}/models?client_version=1.0.0`, {
        headers: { authorization: `Bearer ${t.access}`, "ChatGPT-Account-ID": t.accountId, originator: ORIGINATOR },
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { models?: { slug?: string; id?: string; visibility?: string }[] };
      const ids = (body.models ?? []).filter((m) => m.visibility !== "hide").map((m) => m.slug ?? m.id).filter(Boolean) as string[];
      return ids.length ? ids : FALLBACK_MODELS;
    } catch {
      return FALLBACK_MODELS;
    }
  }

  async turn(req: TurnRequest): Promise<TurnResult> {
    const params: OpenAI.Responses.ResponseCreateParamsStreaming = {
      model: req.model,
      instructions: req.system,
      input: toResponses(req.messages),
      tools: req.tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters, strict: false })),
      tool_choice: "auto",
      parallel_tool_calls: true,
      reasoning: { effort: "medium", summary: "auto" },
      store: false,
      stream: true,
      include: ["reasoning.encrypted_content"],
      prompt_cache_key: this.sessionId,
    };
    let stream;
    try {
      stream = await (await this.client()).responses.create(params, { signal: req.signal });
    } catch (e) {
      if ((e as { status?: number }).status !== 401) throw e;
      stream = await (await this.client(true)).responses.create(params, { signal: req.signal }); // token revoked early
    }

    let text = "";
    let stop: StopReason = "end";
    let usage: TurnResult["usage"];
    const items: OpenAI.Responses.ResponseOutputItem[] = [];
    const toolCalls: ToolCall[] = [];

    for await (const ev of stream) {
      if (ev.type === "response.output_text.delta") {
        text += ev.delta;
        req.onText(ev.delta);
      } else if (ev.type === "response.output_item.done") {
        items.push(ev.item);
        if (ev.item.type === "function_call") {
          let input: Record<string, unknown>;
          try {
            input = JSON.parse(ev.item.arguments || "{}");
          } catch {
            input = { _invalid_json: ev.item.arguments };
          }
          toolCalls.push({ id: ev.item.call_id, name: ev.item.name, input });
        }
      } else if (ev.type === "response.completed" || ev.type === "response.incomplete") {
        const u = ev.response.usage;
        if (u) usage = { input: u.input_tokens, output: u.output_tokens };
        if (ev.type === "response.incomplete")
          stop = ev.response.incomplete_details?.reason === "content_filter" ? "refusal" : "max_tokens";
      } else if (ev.type === "response.failed") {
        throw new Error(ev.response.error?.message ?? "Response failed");
      } else if (ev.type === "error") {
        throw new Error(ev.message);
      }
    }
    if (stop === "end" && toolCalls.length) stop = "tool_use";
    return { message: { role: "assistant", text, toolCalls, raw: { provider: "openai-responses", content: items } }, stop, usage };
  }
}

function toResponses(messages: Message[]): OpenAI.Responses.ResponseInputItem[] {
  return messages.flatMap((m): OpenAI.Responses.ResponseInputItem[] => {
    if (m.role === "user") return [{ role: "user", content: m.text }];
    if (m.role === "tool") return m.results.map((r) => ({ type: "function_call_output", call_id: r.id, output: r.output }));
    if (m.raw?.provider === "openai-responses")
      // With store: false the server keeps nothing, so item ids can't be referenced; resend items without them.
      return (m.raw.content as Record<string, unknown>[]).map(({ id: _id, ...item }) => item as unknown as OpenAI.Responses.ResponseInputItem);
    return [
      ...(m.text ? [{ role: "assistant" as const, content: m.text }] : []),
      ...m.toolCalls.map((c) => ({ type: "function_call" as const, call_id: c.id, name: c.name, arguments: JSON.stringify(c.input) })),
    ];
  });
}
