import { execFile } from "node:child_process";
import { mkdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const PACKAGE = "@megacode/cli";
const REGISTRY = "https://registry.npmjs.org";
const packageRoot = fileURLToPath(new URL("../../", import.meta.url));

/** Only stable releases; never downgrade or replace a prerelease build. */
export function isNewerRelease(latest: string, current: string): boolean {
  const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if (!stable.test(latest) || !stable.test(current)) return false;
  const a = latest.split(".").map(BigInt);
  const b = current.split(".").map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

async function npm(args: string[], timeout = 15_000): Promise<string> {
  const { stdout } = await exec("npm", args, {
    cwd: dirname(packageRoot),
    timeout,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, npm_config_update_notifier: "false" },
  });
  return stdout.trim();
}

type Installation = { version: string; prefix: string };
export type UpdateOperations = {
  installation(): Promise<Installation | null>;
  latest(): Promise<string>;
  lock(prefix: string): Promise<(() => Promise<void>) | null>;
  install(version: string, prefix: string): Promise<void>;
};

const operations: UpdateOperations = {
  async installation() {
    // Never change source checkouts, npm links, npx caches or local installs.
    // npm.cmd needs shell execution on Windows; leave those installs to npm itself.
    if (process.platform === "win32" || process.env.MEGACODE_DISABLE_AUTO_UPDATE === "1") return null;
    const metadata = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
    if (metadata.name !== PACKAGE || typeof metadata.version !== "string") return null;
    const root = await npm(["root", "--global"]);
    const installed = join(root, "@megacode", "cli");
    const resolved = await realpath(installed);
    if (resolved !== installed || resolved !== await realpath(packageRoot)) return null;
    return { version: metadata.version, prefix: await npm(["prefix", "--global"]) };
  },
  async latest() {
    return JSON.parse(await npm(["view", `${PACKAGE}@latest`, "version", "--json", `--registry=${REGISTRY}`]));
  },
  async lock(prefix) {
    // Outside the package directory: npm replaces that directory during installation.
    const path = join(prefix, ".megacode-update-lock");
    try {
      if (Date.now() - (await stat(path)).mtimeMs > 10 * 60_000) await rm(path, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      await mkdir(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return null;
      throw error;
    }
    return () => rm(path, { recursive: true, force: true });
  },
  async install(version, prefix) {
    await npm([
      "install", "--global", `--prefix=${prefix}`, `${PACKAGE}@${version}`,
      `--registry=${REGISTRY}`, "--ignore-scripts", "--no-audit", "--no-fund",
    ], 120_000);
  },
};

/** Best effort and silent on failure. A version is returned only after npm succeeds. */
export async function checkForUpdate(ops: UpdateOperations = operations): Promise<string | null> {
  let release: (() => Promise<void>) | null = null;
  try {
    const installed = await ops.installation();
    if (!installed) return null;
    release = await ops.lock(installed.prefix);
    if (!release) return null;
    const latest = await ops.latest();
    if (typeof latest !== "string" || !isNewerRelease(latest, installed.version)) return null;
    await ops.install(latest, installed.prefix);
    return latest;
  } catch {
    // Offline registry, permissions or missing npm must never interrupt a session.
    return null;
  } finally {
    await release?.().catch(() => {});
  }
}

// One task per process, including when the UI is remounted.
let update: Promise<string | null> | undefined;
export function autoUpdate(): Promise<string | null> {
  return update ??= checkForUpdate();
}
