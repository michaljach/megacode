import { readFile } from "node:fs/promises";
import os from "node:os";
import type { ProjectContext } from "../core/prompts.ts";
import { discoverSkills } from "./skills.ts";

const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md"];

const readInstructions = async (file: string) => ({ file, text: await readFile(file, "utf8").catch(() => "") });

/** The working directory as the system prompt describes it. */
export async function readProjectContext({ includeInstructions }: { includeInstructions: boolean }): Promise<ProjectContext> {
  const [{ skills }, instructions] = await Promise.all([
    discoverSkills(),
    Promise.all((includeInstructions ? INSTRUCTION_FILES : []).map(readInstructions)),
  ]);
  return { cwd: process.cwd(), platform: `${os.platform()} ${os.release()}`, skills, instructions: instructions.filter((i) => i.text) };
}
