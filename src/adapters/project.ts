import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import { discoverSkills } from "./skills.ts";
import type { ProjectContext } from "../core/prompts.ts";

const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md"];

/** The working directory as the system prompt describes it. */
export function readProjectContext({ includeInstructions }: { includeInstructions: boolean }): ProjectContext {
  return {
    cwd: process.cwd(),
    platform: `${os.platform()} ${os.release()}`,
    skills: discoverSkills().skills,
    instructions: includeInstructions
      ? INSTRUCTION_FILES.filter((file) => existsSync(file)).map((file) => ({ file, text: readFileSync(file, "utf8") }))
      : [],
  };
}
