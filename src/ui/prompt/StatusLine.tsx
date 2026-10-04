import { Box, Text } from "ink";
import type { ContextUsage } from "../../core/agent.ts";
import type { PermissionMode } from "../../core/settings.ts";
import { formatTokens, tildify } from "../text/format.ts";

const MODE_LABELS: Partial<Record<PermissionMode, { text: string; color: string }>> = {
  "accept-edits": { text: "⏵⏵ accept edits", color: "magenta" },
  ask: { text: "ask mode", color: "cyan" },
};

const contextLabel = ({ tokens, window }: ContextUsage) =>
  window ? `${formatTokens(tokens)}/${formatTokens(window)} context (${Math.round((tokens / window) * 100)}%)` : `${formatTokens(tokens)} context`;

/**
 * Row under the prompt: permission mode and cwd on the left; model, worktree, tokens and, when turned on in /config,
 * context use and output speed on the right.
 */
export function StatusLine({
  mode,
  model,
  loggedIn,
  exitArmed,
  usage,
  worktree,
  context,
  speed,
}: {
  mode: PermissionMode;
  model: string;
  loggedIn: boolean;
  exitArmed: boolean;
  usage: { input: number; output: number };
  worktree?: string;
  /** Left out when the setting is off; null until a response reports usage. */
  context?: ContextUsage | null;
  speed?: number | null;
}) {
  // Give exit confirmation the whole row instead of competing with model/worktree metadata.
  if (exitArmed)
    return (
      <Box paddingX={2}>
        <Text color="yellow">Press Ctrl-C again to exit</Text>
      </Box>
    );
  // Bypass is the default, so only the other modes get a label.
  const modeLabel = MODE_LABELS[mode];
  const tokens = usage.input + usage.output;
  // When space runs out the path gives way first, then the details on the right; the mode never does.
  // A zero basis gives the path only the space the details leave; shrinking both would cost the details a column too.
  return (
    <Box paddingX={2} gap={2}>
      <Box flexGrow={1} flexBasis={0} minWidth={modeLabel ? modeLabel.text.length + 1 : 0}>
        {modeLabel && (
          <Box flexShrink={0} marginRight={1}>
            <Text color={modeLabel.color}>{modeLabel.text}</Text>
          </Box>
        )}
        <Box flexShrink={1} minWidth={0}>
          <Text dimColor wrap="truncate-start">{tildify(process.cwd())}</Text>
        </Box>
      </Box>
      <Box flexShrink={1} minWidth={0}>
        <Text dimColor={loggedIn} color={loggedIn ? undefined : "yellow"} wrap="truncate-end">
          {model}
          {loggedIn ? "" : " · not logged in (/login)"}
          {worktree ? ` · ⎇ ${worktree}` : ""}
          {tokens ? ` · ${formatTokens(tokens)} tokens` : ""}
          {context ? ` · ${contextLabel(context)}` : ""}
          {speed ? ` · ${speed.toFixed(1)} tok/s` : ""}
        </Text>
      </Box>
    </Box>
  );
}
