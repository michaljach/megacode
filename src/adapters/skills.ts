import { execFile } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { parse } from "yaml";
import { configDir } from "./storage.ts";

export type Skill = { name: string; description: string; file: string };
export type SkillOptions = { cwd?: string; home?: string };
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ignored = new Set([".git", "node_modules", ".megacode"]);
const exec = promisify(execFile);

function readSkill(directory: string): Skill {
  const file = path.join(directory, "SKILL.md");
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.size > 128 * 1024) throw new Error(`Invalid or oversized SKILL.md: ${file}`);
  const text = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
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
export function discoverSkills(options: SkillOptions = {}): { skills: Skill[]; warnings: string[] } {
  const skills = new Map<string, Skill>();
  const warnings: string[] = [];
  for (const root of roots(options)) {
    if (!existsSync(root)) continue;
    try {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        try {
          const skill = readSkill(path.join(root, entry.name));
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

function findSkills(directory: string): string[] {
  const found: string[] = [];
  let visited = 0;
  function walk(dir: string, depth: number) {
    if (++visited > 10000 || depth > 20) throw new Error("Skill source is too large or deeply nested.");
    if (!lstatSync(dir).isDirectory()) throw new Error(`Expected a real directory: ${dir}`);
    if (existsSync(path.join(dir, "SKILL.md"))) { found.push(dir); return; }
    for (const entry of readdirSync(dir, { withFileTypes: true }))
      if (entry.isDirectory() && !ignored.has(entry.name)) walk(path.join(dir, entry.name), depth + 1);
  }
  walk(directory, 0);
  if (!found.length) throw new Error("No SKILL.md files found in the source.");
  return found;
}

function validateTree(directory: string) {
  let bytes = 0;
  let files = 0;
  function walk(file: string, depth: number) {
    const stat = lstatSync(file);
    if (++files > 10000 || depth > 30 || (bytes += stat.size) > 50 * 1024 * 1024)
      throw new Error("Skill exceeds installation limits (50 MiB / 10000 entries / 30 levels).");
    if (stat.isDirectory()) {
      for (const name of readdirSync(file)) if (!ignored.has(name)) walk(path.join(file, name), depth + 1);
    } else if (!stat.isFile()) throw new Error(`Symlinks and special files are not supported: ${file}`);
  }
  walk(directory, 0);
}

export async function installSkills(source: string, options: SkillOptions & { global?: boolean } = {}): Promise<Skill[]> {
  let temporary: string | undefined;
  try {
    let directory = path.resolve(source);
    if (!existsSync(directory)) {
      const url = githubUrl(source);
      temporary = mkdtempSync(path.join(os.tmpdir(), "megacode-skills-"));
      directory = path.join(temporary, "repo");
      await exec("git", ["-c", "core.hooksPath=/dev/null", "clone", "--depth", "1", "--", url, directory], {
        timeout: 120000, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
    }
    const sources = findSkills(directory);
    const skills = sources.map(readSkill);
    const root = roots(options)[options.global ? 0 : 1];
    const names = new Set<string>();
    for (const [i, skill] of skills.entries()) {
      if (names.has(skill.name)) throw new Error(`Duplicate skill name: ${skill.name}`);
      names.add(skill.name);
      if (existsSync(path.join(root, skill.name))) throw new Error(`Skill already installed: ${skill.name}. Remove its directory before reinstalling.`);
      validateTree(sources[i]);
    }
    mkdirSync(root, { recursive: true });
    const created: string[] = [];
    try {
      for (const [i, skill] of skills.entries()) {
        const target = path.join(root, skill.name);
        mkdirSync(target); // Exclusive reservation: never overwrite another installation.
        created.push(target);
        cpSync(sources[i], target, { recursive: true, filter: (file) => !ignored.has(path.basename(file)) });
      }
    } catch (error) {
      for (const target of created) rmSync(target, { recursive: true, force: true });
      throw error;
    }
    return skills.map((skill) => ({ ...skill, file: path.join(root, skill.name, "SKILL.md") }));
  } finally {
    if (temporary) rmSync(temporary, { recursive: true, force: true });
  }
}

export const SKILLS_HELP = "Usage: skills [list | install <local-directory|owner/repo|GitHub-URL> [--global]]";

/** Shared by the standalone CLI and /skills. */
export async function runSkillsCommand(args: string[], options: SkillOptions = {}): Promise<string> {
  if (!args.length || (args.length === 1 && args[0] === "list")) {
    const { skills, warnings } = discoverSkills(options);
    return [skills.length ? skills.map((s) => `${s.name}: ${s.description}\n  ${s.file}`).join("\n") : "No skills installed.", ...warnings, SKILLS_HELP].join("\n");
  }
  if (args[0] !== "install") throw new Error(SKILLS_HELP);
  const global = args.includes("--global");
  const sources = args.slice(1).filter((arg) => arg !== "--global");
  if (sources.length !== 1 || sources[0].startsWith("--")) throw new Error(SKILLS_HELP);
  const installed = await installSkills(sources[0], { ...options, global });
  return installed.map((s) => `Installed ${s.name} at ${s.file}`).join("\n");
}
