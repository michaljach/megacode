import { randomUUID } from "node:crypto";
import type { Message } from "../core/conversation.ts";
import { readJsonAsync, writeJsonAsync } from "./storage.ts";

/** A conversation as saved after each turn, so `megacode --resume <id>` can continue it. */
export type SavedSession = { id: string; cwd: string; model: string; updated: string; messages: Message[] };

/** Ids megacode makes (UUIDs); anything else, like a path, is never looked up. */
const SESSION_ID = /^[\w-]{1,64}$/;

const file = (id: string) => `sessions/${id}.json`;

export const newSessionId = () => randomUUID();

/** Saves the conversation, readable only by you: it holds code and command output. */
export const saveSession = (session: Omit<SavedSession, "updated">) =>
  writeJsonAsync(file(session.id), { ...session, updated: new Date().toISOString() }, { secret: true });

/** The saved session with this id, or null if there's none. */
export async function loadSession(id: string): Promise<SavedSession | null> {
  if (!SESSION_ID.test(id)) return null;
  const session = await readJsonAsync<SavedSession | null>(file(id), null);
  return Array.isArray(session?.messages) ? session : null;
}

/** The command that continues a session; `worktree` when it ran in one that's kept. */
export const resumeCommand = (id: string, worktree?: string) => `megacode${worktree ? ` -w ${worktree}` : ""} --resume ${id}`;
