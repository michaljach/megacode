import { Box, Text } from "ink";
import type { ReactNode } from "react";
import type { NoticeLevel } from "../core/agent.ts";
import type { ToolCall } from "../core/conversation.ts";
import { formatCall, previewOutput, previewPrompt, renderMarkdown } from "./format.ts";
import { Blink } from "./Spinner.tsx";

/** One finished entry of the transcript, rendered once into <Static>. */
export type Item =
  | { kind: "banner" }
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; first: boolean }
  | { kind: "tool"; call: ToolCall; output: string; isError: boolean; changePreview?: string }
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
            {"\n"}cwd: {process.cwd()}
          </Text>
        </Box>
      );
    case "user":
      return (
        <Box marginTop={1}>
          <Box width={2} flexShrink={0}><Text dimColor>{"> "}</Text></Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1} flexBasis={0} minWidth={0}>
            <Text wrap="wrap">{previewPrompt(item.text)}</Text>
          </Box>
        </Box>
      );
    case "assistant":
      return <AssistantText text={item.text} first={item.first} />;
    case "tool":
      return (
        <Box flexDirection="column" marginTop={1}>
          <TranscriptRow prefix={<Text color={item.isError ? "red" : "green"}>⏺ </Text>} width={2}>
            <Text bold>{formatCall(item.call)}</Text>
          </TranscriptRow>
          <TranscriptRow prefix={<Text dimColor>{"  ⎿  "}</Text>} width={5}>
            <Text dimColor={!item.isError} color={item.isError ? "red" : undefined}>
              {previewOutput(item.output) || "(no output)"}
            </Text>
          </TranscriptRow>
          {!item.isError && item.changePreview && (
            <Box marginLeft={5} flexDirection="column"><DiffPreview text={item.changePreview} /></Box>
          )}
        </Box>
      );
    case "notice":
      return (
        <Box marginTop={1}>
          <TranscriptRow prefix={<Text dimColor>{"  ⎿  "}</Text>} width={5}>
            <Text color={item.level === "error" ? "red" : item.level === "warn" ? "yellow" : undefined} dimColor={item.level === "info" && !item.bright}>
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

export function RunningTool({ call }: { call: ToolCall }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        <Blink /> <Text bold>{formatCall(call)}</Text>
      </Text>
      <Text dimColor>{"  ⎿  Running…"}</Text>
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

function DiffPreview({ text }: { text: string }) {
  return text.split("\n").map((line, i) => {
    // renderFileChange emits two padded line numbers and a sign, with an optional
    // ANSI style around the gutter. Keep its styling separate from highlighted code.
    const row = line.match(/^((?:\u001b\[[\d;]*m)*[ \d]{4,} [ \d]{4,} [ +\\-](?:\u001b\[[\d;]*m)* )([\s\S]*)$/);
    if (!row) return <Text key={i}>{line}</Text>;
    return (
      <TranscriptRow key={i} prefix={<Text>{row[1]}</Text>} width={row[1]!.replace(/\u001b\[[\d;]*m/g, "").length}>
        <Text>{row[2]}</Text>
      </TranscriptRow>
    );
  });
}
