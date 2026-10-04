import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";

const b64url = (buf: Buffer) => buf.toString("base64url");

export function pkce() {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()), state: b64url(randomBytes(16)) };
}

/** The command that opens a URL. $BROWSER is the usual override (and lets headless setups print or handle the URL). */
function browserCommand(url: string): [command: string, args: string[]] {
  if (process.env.BROWSER) return [process.env.BROWSER, [url]];
  if (process.platform === "darwin") return ["open", [url]];
  if (process.platform === "win32") return ["cmd", ["/c", "start", '""', url.replace(/&/g, "^&")]];
  return ["xdg-open", [url]];
}

export function openBrowser(url: string) {
  try {
    spawn(...browserCommand(url), { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {
    // the URL is also shown in the UI, so the user can open it by hand
  }
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]!);

const PAGE = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title><body style="font:16px system-ui;display:grid;place-items:center;height:90vh"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p></div>`;

/**
 * Local HTTP server that receives the OAuth redirect (`?code=…&state=…`) on 127.0.0.1.
 * Call `close()` when done; `code` rejects on error, state mismatch or abort.
 */
export async function callbackServer(opts: { port: number; path: string; state?: string; signal: AbortSignal }) {
  const { promise: code, resolve: resolveCode, reject: rejectCode } = Promise.withResolvers<string>();
  code.catch(() => {}); // handled by the caller

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== opts.path) return res.writeHead(404).end();
    const error = url.searchParams.get("error_description") ?? url.searchParams.get("error");
    const got = url.searchParams.get("code");
    if (error || !got || (opts.state && url.searchParams.get("state") !== opts.state)) {
      res.writeHead(400, { "content-type": "text/html" }).end(PAGE("Sign-in failed", error ?? "Invalid response. Try again from megacode."));
      return rejectCode(new Error(error ?? "Invalid OAuth callback"));
    }
    res.writeHead(200, { "content-type": "text/html" }).end(PAGE("Signed in ✔", "You can close this tab and return to megacode."));
    resolveCode(got);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", (e: NodeJS.ErrnoException) =>
      reject(e.code === "EADDRINUSE" ? new Error(`Port ${opts.port} is in use. Close other sign-in windows and retry.`) : e),
    );
    server.listen(opts.port, "127.0.0.1", resolve);
  });
  const port = (server.address() as { port: number }).port;
  const close = () => server.close();
  opts.signal.addEventListener("abort", () => rejectCode(new Error("Sign-in cancelled")), { once: true });
  return { port, code, close };
}

/** Decode a JWT payload without verifying it (we only read our own tokens' claims). */
export function jwtClaims(token: string): Record<string, any> {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}
