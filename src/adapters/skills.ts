import { execFile } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { parse } from "yaml";
import { pathExists } from "../lib/fs.ts";
import { configDir } from "./storage.ts";

export type Skill = { name: string; description: string; file: string };
export type SkillOptions = { cwd?: string; home?: string };
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ignored = new Set([".git", "node_modules", ".megacode"]);
const exec = promisify(execFile);

async function readSkill(directory: string): Promise<Skill> {
  const file = path.join(directory, "SKILL.md");
  const stat = await lstat(file);
  if (!stat.isFile() || stat.size > 128 * 1024) throw new Error(`Invalid or oversized SKILL.md: ${file}`);
  const text = (await readFile(file, "utf8")).replace(/^\uFEFF/, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) throw new Error(`Missing YAML frontmatter: ${file}`);
  const metadata = parse(match[1], { maxAliasCount: 0 });
  if (!metadata || typeof metadata.name !== "string" || !NAME.test(metadata.name) || metadata.name.length > 64)
    throw new Error(`Skill name must be lowercase letters/digits separated by hyphens (max 64): ${file}`);
  if (typeof metadata.description !== "string" || !metadata.description.trim() || metadata.description.length > 1024)
    throw new Error(`Skill needs a description of 1–1024 characters: ${file}`);
  return { name: metadata.name, description: metadata.description.trim(), file };
}

function roots({ cwd = process.cwd(), home }: SkillOptions) {
  const global = home ? path.join(home, ".megacode") : configDir();
  return [path.resolve(global, "skills"), path.resolve(cwd, ".megacode", "skills")];
}

/** Project skills override global skills with the same name. Broken skills don't prevent startup. */
export async function discoverSkills(options: SkillOptions = {}): Promise<{ skills: Skill[]; warnings: string[] }> {
  const skills = new Map<string, Skill>();
  const warnings: string[] = [];
  for (const root of roots(options)) {
    if (!(await pathExists(root))) continue;
    try {
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        try {
          const skill = await readSkill(path.join(root, entry.name));
          skills.set(skill.name, skill);
        } catch (error) { warnings.push(String(error)); }
      }
    } catch (error) { warnings.push(String(error)); }
  }
  return { skills: [...skills.values()].sort((a, b) => a.name.localeCompare(b.name)), warnings };
}

/** Only HTTPS GitHub repositories (or owner/repo shorthand), never arbitrary git transports. */
function githubUrl(source: string): string {
  const match = /^(?:https:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(source);
  if (!match || match[1] === "." || match[1] === ".." || match[2] === "." || match[2] === "..")
    throw new Error("Expected an existing local directory, owner/repo, or https://github.com/owner/repo (no branch/subdirectory URLs).");
  return `https://github.com/${match[1]}/${match[2]}.git`;
}

async function findSkills(directory: string): Promise<string[]> {
  const found: string[] = [];
  let visited = 0;
  async function walk(dir: string, depth: number) {
    if (++visited > 10000 || depth > 20) throw new Error("Skill source is too large or deeply nested.");
    if (!(await lstat(dir)).isDirectory()) throw new Error(`Expected a real directory: ${dir}`);
    if (await pathExists(path.join(dir, "SKILL.md"))) { found.push(dir); return; }
    for (const entry of await readdir(dir, { withFileTypes: true }))
      if (entry.isDirectory() && !ignored.has(entry.name)) await walk(path.join(dir, entry.name), depth + 1);
  }
  await walk(directory, 0);
  if (!found.length) throw new Error("No SKILL.md files found in the source.");
  return found;
}

async function validateTree(directory: string) {
  let bytes = 0;
  let files = 0;
  async function walk(file: string, depth: number) {
    const stat = await lstat(file);
    if (++files > 10000 || depth > 30 || (bytes += stat.size) > 50 * 1024 * 1024)
      throw new Error("Skill exceeds installation limits (50 MiB / 10000 entries / 30 levels).");
    if (stat.isDirectory()) {
      for (const name of await readdir(file)) if (!ignored.has(name)) await walk(path.join(file, name), depth + 1);
    } else if (!stat.isFile()) throw new Error(`Symlinks and special files are not supported: ${file}`);
  }
  await walk(directory, 0);
}

export async function installSkills(source: string, options: SkillOptions & { global?: boolean } = {}): Promise<Skill[]> {
  let temporary: string | undefined;
  try {
    let directory = path.resolve(source);
    if (!(await pathExists(directory))) {
      const url = githubUrl(source);
      temporary = await mkdtemp(path.join(os.tmpdir(), "megacode-skills-"));
      directory = path.join(temporary, "repo");
      await exec("git", ["-c", "core.hooksPath=/dev/null", "clone", "--depth", "1", "--", url, directory], {
        timeout: 120000, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
    }
    const sources = await findSkills(directory);
    const skills = await Promise.all(sources.map(readSkill));
    const root = roots(options)[options.global ? 0 : 1];
    const names = new Set<string>();
    for (const [i, skill] of skills.entries()) {
      if (names.has(skill.name)) throw new Error(`Duplicate skill name: ${skill.name}`);
      names.add(skill.name);
      if (await pathExists(path.join(root, skill.name))) throw new Error(`Skill already installed: ${skill.name}. Remove its directory before reinstalling.`);
      await validateTree(sources[i]);
    }
    await mkdir(root, { recursive: true });
    const created: string[] = [];
    try {
      for (const [i, skill] of skills.entries()) {
        const target = path.join(root, skill.name);
        await mkdir(target); // Exclusive reservation: never overwrite another installation.
        created.push(target);
        await cp(sources[i], target, { recursive: true, filter: (file) => !ignored.has(path.basename(file)) });
      }
    } catch (error) {
      for (const target of created) await rm(target, { recursive: true, force: true });
      throw error;
    }
    return skills.map((skill) => ({ ...skill, file: path.join(root, skill.name, "SKILL.md") }));
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}

export const SKILLS_HELP = "Usage: skills [list | install <local-directory|owner/repo|GitHub-URL> [--global]]";

/** Shared by the standalone CLI and /skills. */
export async function runSkillsCommand(args: string[], options: SkillOptions = {}): Promise<string> {
  if (!args.length || (args.length === 1 && args[0] === "list")) {
    const { skills, warnings } = await discoverSkills(options);
    return [skills.length ? skills.map((s) => `${s.name}: ${s.description}\n  ${s.file}`).join("\n") : "No skills installed.", ...warnings, SKILLS_HELP].join("\n");
  }
  if (args[0] !== "install") throw new Error(SKILLS_HELP);
  const global = args.includes("--global");
  const sources = args.slice(1).filter((arg) => arg !== "--global");
  if (sources.length !== 1 || sources[0].startsWith("--")) throw new Error(SKILLS_HELP);
  const installed = await installSkills(sources[0], { ...options, global });
  return installed.map((s) => `Installed ${s.name} at ${s.file}`).join("\n");
}
