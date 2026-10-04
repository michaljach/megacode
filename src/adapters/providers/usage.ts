import { CHATGPT_BASE_URL, chatGPTFetchHeaders, chatGPTTokens } from "../auth/chatgpt.ts";
import { providerInfo } from "./catalog.ts";
import { credentials, type Credentials } from "./credentials.ts";

const number = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};

/** Only display values actually returned by the provider; missing values aren't zero. */
export function formatChatGPTUsage(value: unknown): string[] {
  const data = object(value);
  const lines: string[] = [];
  if (typeof data.plan_type === "string") lines.push(`Plan: ${data.plan_type}`);
  for (const [key, label] of [["rate_limit", "Usage"], ["code_review_rate_limit", "Code review"]] as const) {
    const limit = object(data[key]);
    if (typeof limit.allowed === "boolean") lines.push(`${label}: ${limit.allowed ? "available" : "limit reached"}`);
    for (const [key, fallback] of [["primary_window", "Primary window"], ["secondary_window", "Secondary window"]] as const) {
      const window = object(limit[key]);
      if (number(window.used_percent)) lines.push(formatWindow(label, fallback, window as Record<string, unknown> & { used_percent: number }));
    }
  }
  const credits = object(data.credits);
  if (credits.unlimited === true) lines.push("Credits: unlimited");
  else if (typeof credits.balance === "string" || number(credits.balance)) lines.push(`Credits remaining: ${credits.balance}`);
  return lines;
}

function formatWindow(label: string, fallback: string, window: Record<string, unknown> & { used_percent: number }): string {
  const duration = window.limit_window_seconds;
  const name = number(duration) ? `${duration / 3600}-hour window` : fallback;
  const used = window.used_percent;
  const filled = Math.round(Math.min(100, Math.max(0, used)) / 100 * 24);
  const bar = "█".repeat(filled) + "░".repeat(24 - filled);
  let line = `${label} (${name})\n  ${bar}  ${used}% used · ${Math.max(0, 100 - used)}% remaining`;
  if (number(window.reset_at)) {
    const date = new Date(window.reset_at * 1000);
    if (!Number.isNaN(date.getTime())) line += `\n  Resets ${date.toLocaleString()}`;
  } else if (number(window.reset_after_seconds)) line += `\n  Resets in ${Math.ceil(window.reset_after_seconds / 60)} min`;
  return line;
}

async function get(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  const hint = [401, 403].includes(res.status) ? " Run /login to update credentials." : "";
  if (!res.ok) throw Object.assign(new Error(`Usage request failed (HTTP ${res.status}).${hint}`), { status: res.status });
  return res.json();
}

const bearer = (apiKey?: string): Record<string, string> => (apiKey ? { Authorization: `Bearer ${apiKey}` } : {});

/** Subscription limits from the ChatGPT backend Codex uses. A token revoked before it expires is refreshed once. */
async function chatGPTUsage(): Promise<unknown> {
  const url = `${CHATGPT_BASE_URL.replace(/\/codex\/?$/, "")}/wham/usage`;
  const request = async (refresh: boolean) => get(url, chatGPTFetchHeaders(await chatGPTTokens(refresh)));
  return request(false).catch((e: Error & { status?: number }) => {
    if (e.status !== 401) throw e;
    return request(true);
  });
}

const endpoint = (creds: Credentials, path: string) => `${creds.baseURL!.replace(/\/$/, "")}${path}`;

const OPENROUTER_FIELDS = [
  ["usage", "Used (total)"], ["usage_daily", "Used (today)"], ["usage_weekly", "Used (this week)"],
  ["usage_monthly", "Used (this month)"], ["limit", "Key spending limit"], ["limit_remaining", "Remaining"],
] as const;

/** Per-provider usage lookups. Returning undefined means this credential type has no usage API. */
const FETCHERS: Record<string, (creds: Credentials) => Promise<string[] | undefined>> = {
  async openai(creds) {
    return creds.source === "chatgpt" ? formatChatGPTUsage(await chatGPTUsage()) : undefined;
  },
  async openrouter(creds) {
    const data = object(object(await get(endpoint(creds, "/key"), bearer(creds.apiKey))).data);
    const lines = OPENROUTER_FIELDS.flatMap(([key, label]) => (number(data[key]) ? [`${label}: $${data[key]}`] : []));
    if (data.limit === null) lines.push("Key spending limit: unlimited");
    if (typeof data.limit_reset === "string") lines.push(`Limit reset: ${data.limit_reset}`);
    return lines;
  },
  async deepseek(creds) {
    const data = object(await get(endpoint(creds, "/user/balance"), bearer(creds.apiKey)));
    const lines: string[] = [];
    for (const entry of Array.isArray(data.balance_infos) ? data.balance_infos : []) {
      const balance = object(entry);
      if (typeof balance.currency === "string" && (typeof balance.total_balance === "string" || number(balance.total_balance)))
        lines.push(`Balance remaining: ${balance.total_balance} ${balance.currency}`);
    }
    lines.push("Usage totals and limits are not exposed by this provider's balance API.");
    return lines;
  },
};

/** Fresh account data, using the same credential precedence as model requests. */
export async function providerUsage(name: string, creds: Credentials = credentials(name)): Promise<string> {
  const info = providerInfo(name);
  const heading = `${info.label} — account usage and limits`;
  if (!creds.source) return `${heading}\nNot configured. Run /login.`;
  const lines = await FETCHERS[name]?.(creds);
  if (!lines)
    return `${heading}\n${info.local ? "Local provider: no account quota API." : "Account usage and limits are not available through this provider's configured authentication/API. Check the provider dashboard."}`;
  return `${heading}\n${lines.length ? lines.join("\n") : "The provider returned no usage or limit data."}`;
}
