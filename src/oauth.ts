import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";

const b64url = (buf: Buffer) => buf.toString("base64url");

export function pkce() {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()), state: b64url(randomBytes(16)) };
}

export function openBrowser(url: string) {
  // $BROWSER is the usual override (and lets headless setups print or handle the URL).
  const [cmd, args] = process.env.BROWSER
    ? [process.env.BROWSER, [url]]
    : process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", '""', url.replace(/&/g, "^&")]]
        : ["xdg-open", [url]];
  try {
    spawn(cmd, args as string[], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {
    // the URL is also shown in the UI, so the user can open it by hand
  }
}

const PAGE = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;display:grid;place-items:center;height:90vh"><div><h2>${title}</h2><p>${body}</p></div>`;

/**
 * Local HTTP server that receives the OAuth redirect (`?code=…&state=…`) on 127.0.0.1.
 * Call `close()` when done; `code` rejects on error, state mismatch or abort.
 */
export async function callbackServer(opts: { port: number; path: string; state?: string; signal: AbortSignal }) {
  let resolveCode!: (code: string) => void;
  let rejectCode!: (e: Error) => void;
  const code = new Promise<string>((res, rej) => ((resolveCode = res), (rejectCode = rej)));
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
