import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { discoverSkills, installSkills, runSkillsCommand } from "../src/adapters/skills.ts";
import { buildSystemPrompt } from "../src/core/prompts.ts";

function fixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(os.tmpdir(), "skills-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const options = { cwd: path.join(root, "project"), home: path.join(root, "home") };
  mkdirSync(options.cwd);
  mkdirSync(options.home);
  return { root, options };
}
function skill(dir: string, name = "testing", description = "Test projects") {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\nSECRET BODY: Read references/guide.md.\n`);
  mkdirSync(path.join(dir, "references"));
  writeFileSync(path.join(dir, "references", "guide.md"), "Support file");
  return dir;
}

test("install local skills with support files, refuse overwrites, and discover metadata only", async (t) => {
  const { root, options } = fixture(t);
  const source = skill(path.join(root, "source folder"), "testing", ">\n  Test projects\n  carefully");
  const [installed] = await installSkills(source, options);
  assert.equal(installed.description, "Test projects carefully");
  assert.equal(readFileSync(path.join(path.dirname(installed.file), "references/guide.md"), "utf8"), "Support file");
  assert.deepEqual(discoverSkills(options).skills, [installed]);
  await assert.rejects(installSkills(source, options), /already installed/);
  const prompt = buildSystemPrompt({ cwd: options.cwd, platform: "test", instructions: [], skills: [installed] });
  assert.match(prompt, /read its SKILL.md/);
  assert.ok(prompt.includes(installed.file));
  assert.ok(!prompt.includes("SECRET BODY"));
  assert.match(await runSkillsCommand(["list"], options), /testing: Test projects carefully/);
});

test("project skills override global skills and malformed skills are reported", async (t) => {
  const { root, options } = fixture(t);
  await installSkills(skill(path.join(root, "global")), { ...options, global: true });
  const [local] = await installSkills(skill(path.join(root, "local"), "testing", "Local instructions"), options);
  assert.deepEqual(discoverSkills(options).skills, [local]);
  const broken = path.join(options.cwd, ".megacode/skills/broken");
  mkdirSync(broken);
  writeFileSync(path.join(broken, "SKILL.md"), "no metadata");
  assert.equal(discoverSkills(options).warnings.length, 1);
  assert.deepEqual(discoverSkills(options).skills, [local]);
});

test("repository installs validate every skill before writing", async (t) => {
  const { root, options } = fixture(t);
  const repo = path.join(root, "repo");
  skill(path.join(repo, "skills/first"), "first");
  skill(path.join(repo, "skills/second"), "../escape");
  await assert.rejects(installSkills(repo, options), /Skill name/);
  assert.equal(discoverSkills(options).skills.length, 0);
  assert.ok(!existsSync(path.join(options.cwd, ".megacode")));
});

test("symlinks are rejected and duplicate names cannot partially install", async (t) => {
  const { root, options } = fixture(t);
  const source = skill(path.join(root, "source"));
  symlinkSync("/etc/passwd", path.join(source, "link"));
  await assert.rejects(installSkills(source, options), /Symlinks/);
  const repo = path.join(root, "repo");
  skill(path.join(repo, "a"));
  skill(path.join(repo, "b"));
  await assert.rejects(installSkills(repo, options), /Duplicate skill name/);
  assert.equal(discoverSkills(options).skills.length, 0);
});

test("GitHub install clones a repository and copies its skills (offline URL rewrite)", async (t) => {
  const { root, options } = fixture(t);
  const repo = path.join(root, "repo");
  skill(path.join(repo, "skills/one"), "one");
  skill(path.join(repo, "skills/two"), "two");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
  git("init");
  git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "core.hooksPath=/dev/null", "commit", "-m", "skills");
  const config = path.join(root, "gitconfig");
  writeFileSync(config, `[url "file://${repo}"]\n  insteadOf = https://github.com/example/skills.git\n`);
  const previous = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = config;
  try {
    const result = await runSkillsCommand(["install", "https://github.com/example/skills", "--global"], options);
    assert.match(result, /Installed one/);
    assert.match(result, /Installed two/);
    assert.equal(discoverSkills(options).skills.length, 2);
    assert.ok(!existsSync(path.join(options.cwd, ".megacode")));
  } finally {
    if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previous;
  }
});

test("invalid sources and command arguments fail without installing", async (t) => {
  const { options } = fixture(t);
  for (const source of ["https://evil.example/repo", "git@github.com:owner/repo", "https://github.com/a/b/tree/main", "../missing"])
    await assert.rejects(installSkills(source, options), /Expected an existing local directory/);
  await assert.rejects(runSkillsCommand(["install"], options), /Usage/);
  await assert.rejects(runSkillsCommand(["install", "a", "b"], options), /Usage/);
  assert.match(await runSkillsCommand([], options), /No skills installed/);
});
