import { chatGPTUsage } from "./chatgpt.ts";
import { credentials, providerInfo, type Credentials } from "./index.ts";

const number = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};

/** Only display values actually returned by the provider; missing values aren't zero. */
export function formatChatGPTUsage(value: unknown): string[] {
  const data = object(value);
  const lines: string[] = [];
  if (typeof data.plan_type === "string") lines.push(`Plan: ${data.plan_type}`);
  for (const [key, label] of [["rate_limit", "Usage"], ["code_review_rate_limit", "Code review"]]) {
    const limit = object(data[key]);
    if (typeof limit.allowed === "boolean") lines.push(`${label}: ${limit.allowed ? "available" : "limit reached"}`);
    for (const [key, fallback] of [["primary_window", "Primary window"], ["secondary_window", "Secondary window"]]) {
      const window = object(limit[key]);
      if (!number(window.used_percent)) continue;
      const duration = window.limit_window_seconds;
      const labelWindow = number(duration) ? `${duration / 3600}-hour window` : fallback;
      let line = `${label} (${labelWindow}): ${window.used_percent}% used · ${Math.max(0, 100 - window.used_percent)}% remaining`;
      if (number(window.reset_at)) {
        const date = new Date(window.reset_at * 1000);
        if (!Number.isNaN(date.getTime())) line += ` · resets ${date.toLocaleString()}`;
      } else if (number(window.reset_after_seconds)) line += ` · resets in ${Math.ceil(window.reset_after_seconds / 60)} min`;
      lines.push(line);
    }
  }
  const credits = object(data.credits);
  if (credits.unlimited === true) lines.push("Credits: unlimited");
  else if (typeof credits.balance === "string" || number(credits.balance)) lines.push(`Credits remaining: ${credits.balance}`);
  return lines;
}

async function get(url: string, apiKey?: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Usage request failed (HTTP ${res.status}).${[401, 403].includes(res.status) ? " Run /login to update credentials." : ""}`);
  return res.json();
}

/** Fresh account data, using the same credential precedence as model requests. */
export async function providerUsage(name: string, creds: Credentials = credentials(name)): Promise<string> {
  const info = providerInfo(name);
  const heading = `${info.label} — account usage and limits`;
  if (!creds.source) return `${heading}\nNot configured. Run /login.`;
  let lines: string[] = [];
  if (name === "openai" && creds.source === "chatgpt") {
    lines = formatChatGPTUsage(await chatGPTUsage());
  } else if (name === "openrouter") {
    const data = object(object(await get(`${creds.baseURL!.replace(/\/$/, "")}/key`, creds.apiKey)).data);
    for (const [key, label] of [["usage", "Used (total)"], ["usage_daily", "Used (today)"], ["usage_weekly", "Used (this week)"], ["usage_monthly", "Used (this month)"], ["limit", "Key spending limit"], ["limit_remaining", "Remaining"]]) {
      if (number(data[key])) lines.push(`${label}: $${data[key]}`);
    }
    if (data.limit === null) lines.push("Key spending limit: unlimited");
    if (typeof data.limit_reset === "string") lines.push(`Limit reset: ${data.limit_reset}`);
  } else if (name === "deepseek") {
    const data = object(await get(`${creds.baseURL!.replace(/\/$/, "")}/user/balance`, creds.apiKey));
    if (Array.isArray(data.balance_infos)) for (const entry of data.balance_infos) {
      const balance = object(entry);
      if (typeof balance.currency === "string" && (typeof balance.total_balance === "string" || number(balance.total_balance)))
        lines.push(`Balance remaining: ${balance.total_balance} ${balance.currency}`);
    }
    lines.push("Usage totals and limits are not exposed by this provider's balance API.");
  } else {
    return `${heading}\n${info.local ? "Local provider: no account quota API." : "Account usage and limits are not available through this provider's configured authentication/API. Check the provider dashboard."}`;
  }
  return `${heading}\n${lines.length ? lines.join("\n") : "The provider returned no usage or limit data."}`;
}
