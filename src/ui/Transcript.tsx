import { Box, Text } from "ink";
import type { ReactNode } from "react";
import type { NoticeLevel } from "../core/agent.ts";
import type { ToolCall } from "../core/conversation.ts";
import { DIFF_COLORS, type DiffModel } from "./diff.ts";
import { DiffLines } from "./DiffLines.tsx";
import { callParts, previewOutput, previewPrompt, renderMarkdown, tildify } from "./format.ts";
import { Blink } from "./Spinner.tsx";

/** Claude Code's colors for a finished call and for secondary text. */
const DONE = "#4eba65";
const MUTED = DIFF_COLORS.muted;
const NOTICE_COLORS: Record<NoticeLevel, string | undefined> = { info: undefined, warn: "yellow", error: "red" };

/** One finished entry of the transcript, rendered once into <Static>. */
export type Item =
  | { kind: "banner" }
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; first: boolean }
  | { kind: "tool"; call: ToolCall; output: string; isError: boolean; diff?: DiffModel }
  | { kind: "notice"; text: string; level: NoticeLevel; bright?: boolean };

export function ItemView({ item, model }: { item: Item; model: string }) {
  switch (item.kind) {
    case "banner":
      return (
        <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" alignSelf="flex-start">
          <Text>
            <Text color="cyan">✻</Text> Welcome to <Text bold>megacode</Text>
          </Text>
          <Text dimColor>/help for commands · ? for shortcuts</Text>
          <Text dimColor>
            model: {model}
            {"\n"}cwd: {tildify(process.cwd())}
          </Text>
        </Box>
      );
    case "user":
      return (
        <Box marginTop={1}>
          <TranscriptRow prefix={<Text dimColor>{"> "}</Text>} width={2}>
            <Text wrap="wrap">{previewPrompt(item.text)}</Text>
          </TranscriptRow>
        </Box>
      );
    case "assistant":
      return <AssistantText text={item.text} first={item.first} />;
    case "tool":
      return (
        <Box flexDirection="column" marginTop={1}>
          <TranscriptRow prefix={<Text color={item.isError ? "red" : DONE}>⏺ </Text>} width={2}>
            <CallHeader call={item.call} />
          </TranscriptRow>
          <TranscriptRow prefix={<Text color={MUTED}>{"  ⎿  "}</Text>} width={5}>
            {item.diff ? (
              <Text>{item.output}</Text>
            ) : (
              <Text dimColor={!item.isError} color={item.isError ? "red" : undefined}>
                {previewOutput(item.output) || "(no output)"}
              </Text>
            )}
          </TranscriptRow>
          {item.diff && (
            // Claude Code's diff band: from the output column to 7 short of the right edge.
            <Box marginLeft={5} marginRight={7} flexDirection="column">
              <DiffLines model={item.diff} />
            </Box>
          )}
        </Box>
      );
    case "notice":
      return (
        <Box marginTop={1}>
          <TranscriptRow prefix={<Text dimColor>{"  ⎿  "}</Text>} width={5}>
            <Text color={NOTICE_COLORS[item.level]} dimColor={item.level === "info" && !item.bright}>
              {item.text}
            </Text>
          </TranscriptRow>
        </Box>
      );
  }
}

/** Assistant Markdown; `first` marks the start of a reply (also used for the live, still-streaming text). */
export function AssistantText({ text, first }: { text: string; first: boolean }) {
  return (
    <Box marginTop={first ? 1 : 0}>
      <TranscriptRow prefix={<Text>{first ? "⏺ " : "  "}</Text>} width={2}>
        <Text>{renderMarkdown(text)}</Text>
      </TranscriptRow>
    </Box>
  );
}

/** "Update(src/a.ts)" with only the tool name in bold. */
function CallHeader({ call }: { call: ToolCall }) {
  const { name, arg } = callParts(call);
  return (
    <Text>
      <Text bold>{name}</Text>({arg})
    </Text>
  );
}

/** The tool call in progress. While it waits for approval, just its header with a gray dot. */
export function RunningTool({ call, waiting = false }: { call: ToolCall; waiting?: boolean }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        {waiting ? <Text color={MUTED}>⏺</Text> : <Blink />} <CallHeader call={call} />
      </Text>
      {!waiting && <Text color={MUTED}>{"  ⎿  Running…"}</Text>}
    </Box>
  );
}

/** Keep prefixes out of the text's wrapping width, including on continuation lines. */
function TranscriptRow({ prefix, width, children }: { prefix: ReactNode; width: number; children: ReactNode }) {
  return (
    <Box width="100%">
      <Box width={width} flexShrink={0}>{prefix}</Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1} flexBasis={0} minWidth={0}>
        {children}
      </Box>
    </Box>
  );
}

