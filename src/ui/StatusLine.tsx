import { Box, Text } from "ink";
import type { PermissionMode } from "../config.ts";
import { tildify } from "./format.ts";

/** Row under the prompt: permission mode and cwd on the left; model, worktree and tokens on the right. */
export function StatusLine({
  mode,
  model,
  loggedIn,
  exitArmed,
  usage,
  worktree,
}: {
  mode: PermissionMode;
  model: string;
  loggedIn: boolean;
  exitArmed: boolean;
  usage: { input: number; output: number };
  worktree?: string;
}) {
  // Give exit confirmation the whole row instead of competing with model/worktree metadata.
  if (exitArmed) {
    return (
      <Box paddingX={2}>
        <Text color="yellow">Press Ctrl-C again to exit</Text>
      </Box>
    );
  }
  // Bypass is the default, so only the other modes get a label.
  const modeLabel = mode === "accept-edits" ? <Text color="magenta">⏵⏵ accept edits </Text> : mode === "ask" ? <Text color="cyan">ask mode </Text> : null;
  const tokens = usage.input + usage.output;
  return (
    <Box paddingX={2} justifyContent="space-between" gap={2}>
      <Box flexShrink={1}>
        {modeLabel}
        <Text dimColor wrap="truncate-start">
          {tildify(process.cwd())}
        </Text>
      </Box>
      <Box flexShrink={0}>
        <Text dimColor={loggedIn} color={loggedIn ? undefined : "yellow"}>
          {model}
          {loggedIn ? "" : " · not logged in (/login)"}
          {worktree ? ` · ⎇ ${worktree}` : ""}
          {tokens ? ` · ${tokens < 1000 ? tokens : `${(tokens / 1000).toFixed(1)}k`} tokens` : ""}
        </Text>
      </Box>
    </Box>
  );
}
